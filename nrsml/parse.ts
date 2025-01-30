import { Macro, substituteMacro } from "./macro.ts";
import { assert, deepFreeze, isElement, isObject, standardParser } from "./utils.ts";

import {
    DateTime,
    Duration,
    Matrix,
    YoutubeSource,
    Data,
    Entry,
    Impact,
    Relation,
    HasMeta,
    Vector,
    Context,
    newZeroVector,
    FactorScore,
    AU,
    AP,
    CP,
    CU,
    MP,
    MU,
    Additional,
    AL,
    AM,
    AV,
    Boredom,
    WeightedEmotions,
    EmotionFactor,
    DatePeriod,
    Sign,
    VisualType,
    EntryStatus,
    AdditionalSources,
    ifDefined,
    Meta,
    ScalarMatrix,
    identityMatrix,
    EntryType,
    StandardEntryType,
    EntryMeta,
} from "../deps.ts";

type Scope = DocumentScope | EntryScope | ImpactScope | RelationScope | ContainsScope;

interface Document {
    data: Data;
}

export interface ProcessOptions {
    today?: DateTime;
    includeResolver?(path: string): [string, ProcessOptions] | undefined;
    scriptResolver?(path: string): string | undefined;
    containFactorEvaluator?(script: string): number;
    rootScope?: DocumentScope;
    ignoreNodes?: unknown[];
    freeze?: boolean;
    macros?: Map<string, Macro>;
    includeOnlyMacros?: boolean;
    DAH_obj_location?: unknown,
}

interface DocumentScope {
    type: "document";
    context: Context;
    value: Document;
    document: DocumentScope;
    root: DocumentScope;
    entry: undefined;
    config: Required<Omit<ProcessOptions, "rootScope" | "freeze" | "DAH_obj_location">> & ProcessOptions;
    global: unknown;
    local: unknown;
    macros: Map<string, Macro>;
    publicMacros: Map<string, Macro>;
}

interface EntryScope {
    type: "entry";
    document: DocumentScope;
    root: DocumentScope;
    entry: EntryScope;
    parent: DocumentScope | ContainsScope | EntryScope;
    value: Entry;
    local: unknown;
    multipliedFactor: ScalarMatrix;
    macros: Map<string, Macro>;
}

interface ImpactScope {
    type: "impact";
    document: DocumentScope;
    root: DocumentScope;
    entry: EntryScope | undefined;
    parent: DocumentScope | ContainsScope | EntryScope;
    value: Impact[];
    local: unknown;
    macros: Map<string, Macro>;
}

interface RelationScope {
    type: "relation";
    document: DocumentScope;
    root: DocumentScope;
    entry: EntryScope | undefined;
    parent: DocumentScope | ContainsScope | EntryScope;
    value: Relation[];
    local: unknown;
    macros: Map<string, Macro>;
}

interface ContainsScope {
    type: "contains";
    document: DocumentScope;
    root: DocumentScope;
    entry: EntryScope;
    parent: EntryScope | ContainsScope;
    factor: Matrix;
    multipliedFactor: Matrix;
    local: unknown;
    macros: Map<string, Macro>;
}

interface URLScope {
    value: HasMeta<Meta>;
}

export interface Result {
    nrsData: Data;
    xmlModel: unknown;
    publicMacros: Map<string, Macro>;
}

export function processNRSXML(
    context: Context,
    content: string,
    options: ProcessOptions = {}
): Result {
    return processRoot(context, standardParser().parse(content), options);
}

function processRoot(context: Context, document: unknown, options: ProcessOptions): Result {
    if (options.freeze ?? true) {
        document = deepFreeze(document);
    }
    const partialScope: Partial<DocumentScope> = {
        type: "document",
        value: {
            data: {
                entries: new Map(),
                impacts: [],
                relations: [],
            },
        },
        context,
        config: {
            today: DateTime.now(),
            includeResolver: () => undefined,
            scriptResolver: () => undefined,
            containFactorEvaluator: (expression) => {
                const f = new Function("return " + expression);
                const value = f.apply(undefined);
                if (typeof value === "number") {
                    return value;
                }

                throw new Error(expression);
            },
            rootScope: null!,
            ignoreNodes: [],
            freeze: false,
            macros: new Map(),
            includeOnlyMacros: false,
            ...options,
        },
        macros: new Map(options.macros ?? new Map()),
        publicMacros: new Map(),
        root: options.rootScope,
        global: options.rootScope?.global ?? {},
        local: {},
    };

    if (partialScope.global === undefined) {
        partialScope.global = partialScope.local;
    }

    if (partialScope.root === undefined) {
        partialScope.root = partialScope as DocumentScope;
    }

    const scope = partialScope as DocumentScope;
    partialScope.document = scope;
    assert(document instanceof Array);
    const documentNodes = document as Array<unknown>;
    for (const node of documentNodes) {
        if (processDocument(scope, node)) {
            continue;
        }

        scope.config.ignoreNodes.push(node);
    }

    return {
        nrsData: scope.value.data,
        xmlModel: document,
        publicMacros: scope.publicMacros,
    };
}

function processDocument(scope: DocumentScope, node: unknown): boolean {
    if (!isObject(node) || !("document" in node)) {
        return false;
    }

    const childNodes = node["document"] as Array<unknown>;
    preprocessMacros(scope, childNodes);
    for (const node of childNodes) {
        if (!processDirective(scope, node) && !processInclude(scope, node)) {
            scope.config.ignoreNodes.push(node);
        }
    }

    return true;
}

function expandMacros(scope: Scope, node: unknown): unknown[] {
    if (isElement(node, "def") || scope.root.config.includeOnlyMacros) {
        // already preprocessed
        return [];
    }

    const pending = [node];
    const directives = [];
    while (pending.length > 0) {
        const node = pending.shift();
        const expandedMacro = processReference(scope, node);
        if (expandedMacro === undefined) {
            directives.push(node);
        } else {
            pending.push(...expandedMacro);
        }
    }

    return directives;
}

function processDirective(
    scope: DocumentScope | EntryScope | ContainsScope,
    node: unknown
): boolean {
    const directives = expandMacros(scope, node);
    for (const directive of directives) {
        const result = processSimpleDirective(scope, directive);
        if (directives.length == 1) {
            return result;
        }
    }

    return true;
}

function processSimpleDirective(
    scope: DocumentScope | EntryScope | ContainsScope,
    node: unknown
): boolean {
    return (
        !scope.root.config.includeOnlyMacros &&
        (processEntry(scope, node) ||
            processImpact(scope, node) ||
            processRelation(scope, node) ||
            processScript(scope, node))
    );
}

function guessEntryTypeFromId(id: string): EntryType {
    const prefix = id[0];
    if (prefix === "A") {
        return StandardEntryType.Anime;
    } else if (prefix === "L") {
        return StandardEntryType.LightNovelGeneric;
    } else if (prefix === "V") {
        return StandardEntryType.VisualNovel;
    } else if (prefix === "F") {
        return StandardEntryType.Franchise;
    } else if (prefix === "G") {
        return StandardEntryType.Game;
    } else if (prefix === "M") {
        if (id.startsWith("M-VGMDB-AR")) {
            return StandardEntryType.MusicArtist;
        }

        const numTokens = id.split("-").length;
        if (id.startsWith("M-VGMDB-AL")) {
            return numTokens === 4 ? StandardEntryType.MusicAlbum : StandardEntryType.MusicTrack;
        }

        if (numTokens === 3) {
            return StandardEntryType.MusicTrack;
        }

        return StandardEntryType.MusicGeneric;
    }

    return "Other";
}

function processEntry(scope: DocumentScope | EntryScope | ContainsScope, node: unknown): boolean {
    if (!(isObject(node) && "entry" in node)) {
        return false;
    }

    const attrs = getAttributes(node);
    const id = transformId(scope, attrs["id"]!);
    let entryType = guessEntryTypeFromId(id);
    if ("entrytype" in attrs) {
        entryType = attrs["entrytype"] as EntryType;
    }
    const entry: Entry = {
        id,
        children: new Map(),
        DAH_meta: {
            DAH_entry_title: attrs["title"]!,
            DAH_entry_type: entryType,
            DAH_obj_location: Object.assign({}, scope.document.config.DAH_obj_location),
        } as EntryMeta
    };

    if ("multipliedFactor" in scope) {
        const children = scope.entry.value.children;
        const newFactor = scope.multipliedFactor.copy();
        if (children.has(entry.id)) {
            newFactor.add(children.get(entry.id)!);
        }

        newFactor.clamp01();
        children.set(entry.id, newFactor);
    }

    const partialEntryScope: Partial<EntryScope> = {
        parent: scope,
        document: scope.document,
        root: scope.root,
        type: "entry",
        value: entry,
        multipliedFactor: identityMatrix,
        local: Object.assign({}, scope.local),
        macros: new Map(scope.macros),
    };

    partialEntryScope.entry = partialEntryScope as EntryScope;
    const entryScope = partialEntryScope as EntryScope;

    assert(!scope.root.value.data.entries.has(entry.id), `duplicate entry id ${entry.id}`);
    scope.root.value.data.entries.set(entry.id, entry);

    const childNodes = node["entry"] as Array<unknown>;
    preprocessMacros(entryScope, childNodes);
    for (const childNode of childNodes) {
        if (
            !processDirective(entryScope, childNode) &&
            !processEntryMeta(entryScope, childNode) &&
            !processCommonMeta(entryScope, childNode) &&
            !processContains(entryScope, childNode) &&
            !processRole(entryScope, childNode)
        ) {
            scope.root.config.ignoreNodes.push(childNode);
        }
    }

    return true;
}

function processImpact(scope: DocumentScope | EntryScope | ContainsScope, node: unknown): boolean {
    // or better: use a lookup table
    const processes = [
        processRegularImpact,
        processCry,
        processPADS,
        processMaxAEIPADS,
        processCryPADS,
        processNEI,
        processAEI,
        processWaifu,
        processEHI,
        processEPI,
        processJumpscare,
        processSleeplessNight,
        processPolitics,
        processInterestField,
        processConsumed,
        processDropped,
        processMeme,
        processMusic,
        processAdditional,
        processVisual,
        processOsuSong,
    ];

    for (const process of processes) {
        if (process(scope, node)) {
            return true;
        }
    }

    return false;
}

function processImpactBase<S extends string>(
    scope: DocumentScope | EntryScope | ContainsScope,
    node: unknown,
    name: S,
    impactInitCallbacks?: (
        attributes: Record<string, string>,
        childNodes: Array<unknown>
    ) => Impact[],
    childNodeCallback?: (impactScope: ImpactScope, childNode: unknown) => boolean
): boolean {
    if (!isElement(node, name)) {
        return false;
    }

    childNodeCallback = childNodeCallback ?? (() => false);
    impactInitCallbacks =
        impactInitCallbacks ??
        (() => {
            return [
                {
                    contributors: new Map(),
                    score: newZeroVector(scope.root.context),
                    DAH_meta: {},
                },
            ];
        });

    const childNodes = node[name] as Array<unknown>;
    const impacts = impactInitCallbacks(getAttributes(node), childNodes);
    const impactScope: ImpactScope = {
        type: "impact",
        parent: scope,
        document: scope.document,
        entry: scope.entry,
        root: scope.root,
        value: impacts,
        local: Object.assign({}, scope.local),
        macros: new Map(scope.macros),
    };

    preprocessMacros(impactScope, childNodes);
    for (const childNode of childNodes.flatMap((node) => expandMacros(impactScope, node))) {
        if (isElement(childNode, "contributor")) {
            const attrs = getAttributes(childNode);
            const id = transformId(scope, attrs["id"]!);
            const factor = new ScalarMatrix(
                scope.root.config.containFactorEvaluator(attrs["factor"] ?? "1.0")
            );
            if (impacts[0].contributors.has(id)) {
                factor.add(impacts[0].contributors.get(id)!);
            }

            factor.clamp01();
            impacts[0].contributors.set(id, factor);
        } else if (
            !processScript(impactScope, childNode) &&
            !processCommonMeta(impactScope, childNode) &&
            !processImpactMeta(impactScope, childNode) &&
            !processRole(impactScope, childNode) &&
            !childNodeCallback(impactScope, childNode)
        ) {
            scope.root.config.ignoreNodes.push(childNode);
        }
    }

    for (const impact of impacts) {
        acceptImpact(scope, impact);
    }

    return true;
}

function acceptImpact(scope: Scope, impact: Impact) {
    if(!("DAH_obj_location" in impact.DAH_meta)) {
        (impact.DAH_meta as Record<string, unknown>).DAH_obj_location = Object.assign({}, scope.document.config.DAH_obj_location);
    }
    scope.root.value.data.impacts.push(impact);
    if (impact.contributors.size == 0) {
        if (scope.entry !== undefined) {
            impact.contributors.set(scope.entry.value.id, identityMatrix);
        }
    }
}

function processRegularImpact(scope: DocumentScope | EntryScope | ContainsScope, node: unknown) {
    return processImpactBase(scope, node, "regularImpact", undefined, (impactScope, childNode) => {
        const score = processScore(impactScope, childNode);
        if (score !== undefined) {
            impactScope.value[0].score = score;
        }

        return score !== undefined;
    });
}

function processScore(scope: Scope, node: unknown): Vector | undefined {
    if (!isElement(node, "score")) {
        return undefined;
    }

    const vector =
        getAttributes(node)["vector"]?.split(",")?.map(parseFloat) ??
        newZeroVector(scope.root.context).data;
    for (const childNode of node["score"] as Array<unknown>) {
        if (!isElement(childNode, "component")) {
            scope.root.config.ignoreNodes.push(childNode);
            continue;
        }

        const attrs = getAttributes(childNode);
        const value = parseFloat(attrs["value"]!);
        const factor = parseFactor(attrs["factor"]!)!;
        vector[factor.factorIndex] = value;
    }

    return new Vector(vector);
}

function processCry(scope: DocumentScope | EntryScope | ContainsScope, node: unknown) {
    return processEmotionImpactBase(scope, node, "cry", (emotions) => [
        scope.root.context.extensions.DAH_standards!.cry(scope.root.context, new Map(), emotions),
    ]);
}

function processEmotionImpactBase<S extends string>(
    scope: DocumentScope | EntryScope | ContainsScope,
    node: unknown,
    name: S,
    impactInitCallbacks: (
        emotions: WeightedEmotions,
        attributes: Record<string, string>
    ) => Impact[],
    childNodeCallback?: (impactScope: ImpactScope, childNode: unknown) => boolean
) {
    return processImpactBase(
        scope,
        node,
        name,
        (attrs) => impactInitCallbacks(parseEmotions(attrs["emotions"]!), attrs),
        childNodeCallback
    );
}

function processBaseScoredEmotionImpactBase<S extends string>(
    scope: DocumentScope | EntryScope | ContainsScope,
    node: unknown,
    name: S,
    impactInitCallbacks: (
        base: number,
        emotions: WeightedEmotions,
        attributes: Record<string, string>
    ) => Impact
) {
    return processEmotionImpactBase(scope, node, name, (emotions, attrs) => [
        impactInitCallbacks(parseFloat(attrs["base"]!), emotions, attrs),
    ]);
}

function processLengthImpactBase<S extends string>(
    scope: DocumentScope | EntryScope | ContainsScope,
    node: unknown,
    name: S,
    impactInitCallbacks: (
        periods: DatePeriod[],
        attrs: Record<string, string>,
        children: Array<unknown>
    ) => Impact[]
) {
    return processImpactBase(scope, node, name, (attrs, children) => {
        const periods = ((): DatePeriod[] => {
            if (("from" in attrs && "to" in attrs) || "length" in attrs) {
                return [parsePeriod(scope, node)!];
            } else {
                return children
                    .filter((childNode) => isElement(childNode, "period"))
                    .map((p) => parsePeriod(scope, p)!);
            }
        })();

        return impactInitCallbacks(periods, attrs, children);
    });
}

function processLengthEmotionImpactBase<S extends string>(
    scope: DocumentScope | EntryScope | ContainsScope,
    node: unknown,
    name: S,
    impactInitCallbacks: (
        emotions: WeightedEmotions,
        periods: DatePeriod[],
        attrs: Record<string, string>,
        children: Array<unknown>
    ) => Impact[]
) {
    return processLengthImpactBase(scope, node, name, (periods, attrs, children) =>
        impactInitCallbacks(parseEmotions(attrs["emotions"]!), periods, attrs, children)
    );
}

function processPADS(scope: DocumentScope | EntryScope | ContainsScope, node: unknown): boolean {
    return processLengthEmotionImpactBase(scope, node, "pads", (emotions, periods) => [
        scope.root.context.extensions.DAH_standards!.pads(
            scope.root.context,
            new Map(),
            periods,
            emotions
        ),
    ]);
}

function processMaxAEIPADS(
    scope: DocumentScope | EntryScope | ContainsScope,
    node: unknown
): boolean {
    return processLengthEmotionImpactBase(scope, node, "maxAEIPADS", (emotions, periods) =>
        scope.root.context.extensions.DAH_standards!.maxAEIPADS(
            scope.root.context,
            new Map(),
            periods,
            emotions
        )
    );
}

function processCryPADS(scope: DocumentScope | EntryScope | ContainsScope, node: unknown): boolean {
    return processLengthEmotionImpactBase(scope, node, "cryPADS", (emotions, periods) =>
        scope.root.context.extensions.DAH_standards!.cryPADS(
            scope.root.context,
            new Map(),
            periods,
            emotions
        )
    );
}

function processAEI(scope: DocumentScope | EntryScope | ContainsScope, node: unknown): boolean {
    return processBaseScoredEmotionImpactBase(scope, node, "aei", (base, emotions) =>
        scope.root.context.extensions.DAH_standards!.aei(
            scope.root.context,
            new Map(),
            base,
            base >= 0.0 ? Sign.Positive : Sign.Negative,
            emotions
        )
    );
}

function processNEI(scope: DocumentScope | EntryScope | ContainsScope, node: unknown): boolean {
    return processBaseScoredEmotionImpactBase(scope, node, "nei", (base, emotions) =>
        scope.root.context.extensions.DAH_standards!.nei(
            scope.root.context,
            new Map(),
            base,
            base >= 0.0 ? Sign.Positive : Sign.Negative,
            emotions
        )
    );
}

function processWaifu(scope: DocumentScope | EntryScope | ContainsScope, node: unknown): boolean {
    return processLengthImpactBase(scope, node, "waifu", (periods, attrs) => [
        scope.root.context.extensions.DAH_standards!.waifu(
            scope.root.context,
            new Map(),
            attrs["name"]!,
            periods
        ),
    ]);
}

function processEHI(scope: DocumentScope | EntryScope | ContainsScope, node: unknown): boolean {
    return processImpactBase(scope, node, "ehi", () => [
        scope.root.context.extensions.DAH_standards!.ehi(scope.root.context, new Map()),
    ]);
}

function processEPI(scope: DocumentScope | EntryScope | ContainsScope, node: unknown): boolean {
    return processImpactBase(scope, node, "epi", (attrs) => [
        scope.root.context.extensions.DAH_standards!.epi(
            scope.root.context,
            new Map(),
            parseFloat(attrs["base"]!)
        ),
    ]);
}

function processJumpscare(
    scope: DocumentScope | EntryScope | ContainsScope,
    node: unknown
): boolean {
    return processImpactBase(scope, node, "jumpscare", () => [
        scope.root.context.extensions.DAH_standards!.jumpscare(scope.root.context, new Map()),
    ]);
}

function processSleeplessNight(
    scope: DocumentScope | EntryScope | ContainsScope,
    node: unknown
): boolean {
    return processImpactBase(scope, node, "sleeplessNight", () => [
        scope.root.context.extensions.DAH_standards!.sleeplessNight(scope.root.context, new Map()),
    ]);
}

function processPolitics(
    scope: DocumentScope | EntryScope | ContainsScope,
    node: unknown
): boolean {
    return processImpactBase(scope, node, "politics", () => [
        scope.root.context.extensions.DAH_standards!.politics(scope.root.context, new Map()),
    ]);
}

function processInterestField(
    scope: DocumentScope | EntryScope | ContainsScope,
    node: unknown
): boolean {
    return processImpactBase(scope, node, "interestField", (attrs) => [
        scope.root.context.extensions.DAH_standards!.interestField(
            scope.root.context,
            new Map(),
            attrs["new"] === "true"
        ),
    ]);
}

function processConsumed(
    scope: DocumentScope | EntryScope | ContainsScope,
    node: unknown
): boolean {
    return processImpactBase(scope, node, "consumed", (attrs) => [
        scope.root.context.extensions.DAH_standards!.consumed(
            scope.root.context,
            new Map(),
            parseFloat(attrs["boredom"]),
            parseDuration(attrs["length"])
        ),
    ]);
}

function processDropped(scope: DocumentScope | EntryScope | ContainsScope, node: unknown): boolean {
    return processImpactBase(scope, node, "dropped", () => [
        scope.root.context.extensions.DAH_standards!.dropped(scope.root.context, new Map()),
    ]);
}

function processMeme(scope: DocumentScope | EntryScope | ContainsScope, node: unknown): boolean {
    return processLengthImpactBase(scope, node, "meme", (periods, attrs) => [
        scope.root.context.extensions.DAH_standards!.meme(
            scope.root.context,
            new Map(),
            parseFloat(attrs["strength"]!),
            periods
        ),
    ]);
}

function processMusic(scope: DocumentScope | EntryScope | ContainsScope, node: unknown): boolean {
    return processImpactBase(scope, node, "music", (attrs) => [
        scope.root.context.extensions.DAH_standards!.music(
            scope.root.context,
            new Map(),
            parseFloat(attrs["base"]!)
        ),
    ]);
}

function processAdditional(
    scope: DocumentScope | EntryScope | ContainsScope,
    node: unknown
): boolean {
    return processImpactBase(scope, node, "additional", (attrs) => [
        scope.root.context.extensions.DAH_standards!.additional(
            scope.root.context,
            new Map(),
            parseFloat(attrs["value"]!),
            attrs["note"] ?? ""
        ),
    ]);
}

function processVisual(scope: DocumentScope | EntryScope | ContainsScope, node: unknown): boolean {
    return processImpactBase(scope, node, "visual", (attrs) => [
        scope.root.context.extensions.DAH_standards!.visual(
            scope.root.context,
            new Map(),
            parseVisualType(attrs["type"]!)!,
            parseFloat(attrs["base"]),
            parseFloat(attrs["unique"])
        ),
    ]);
}

function processOsuSong(scope: DocumentScope | EntryScope | ContainsScope, node: unknown): boolean {
    return processImpactBase(scope, node, "osuSong", (attrs) => [
        scope.root.context.extensions.DAH_standards!.osuSong(
            scope.root.context,
            new Map(),
            parseFloat(attrs["personal"] ?? "0.0"),
            parseFloat(attrs["community"] ?? "0.0")
        ),
    ]);
}

function processWriting(scope: DocumentScope | EntryScope | ContainsScope, node: unknown): boolean {
    return processImpactBase(scope, node, "writing", (attrs) => [
        scope.root.context.extensions.DAH_standards!.writing(
            scope.root.context,
            new Map(),
            parseFloat(attrs["character"]!),
            parseFloat(attrs["story"]!),
            parseFloat(attrs["pacing"]!),
            parseFloat(attrs["originality"]!)
        ),
    ]);
}

function processRelationBase<S extends string>(
    scope: DocumentScope | EntryScope | ContainsScope,
    node: unknown,
    name: S,
    relationInitCallbacks?: (
        attributes: Record<string, string>,
        childNodes: Array<unknown>
    ) => Relation[],
    childNodeCallback?: (relationScope: RelationScope, childNode: unknown) => boolean
): boolean {
    if (!isElement(node, name)) {
        return false;
    }

    childNodeCallback = childNodeCallback ?? (() => false);
    relationInitCallbacks =
        relationInitCallbacks ??
        (() => {
            return [
                {
                    contributors: new Map(),
                    references: new Map(),
                    DAH_meta: {},
                },
            ];
        });

    const childNodes = node[name] as Array<unknown>;
    const relations = relationInitCallbacks(getAttributes(node), childNodes);
    const relationScope: RelationScope = {
        type: "relation",
        parent: scope,
        document: scope.document,
        entry: scope.entry,
        root: scope.root,
        value: relations,
        local: Object.assign({}, scope.local),
        macros: new Map(scope.macros),
    };

    preprocessMacros(relationScope, childNodes);
    for (const childNode of childNodes.flatMap((node) => expandMacros(relationScope, node))) {
        if (isElement(childNode, "contributor")) {
            const attrs = getAttributes(childNode);
            const id = transformId(scope, attrs["id"]!);
            const factor = parseFloat(attrs["factor"]);

            for (const impact of relations) {
                const factorMatrix = new ScalarMatrix(factor);
                if (impact.contributors.has(id)) {
                    factorMatrix.add(impact.contributors.get(id)!);
                }

                factorMatrix.clamp01();
                impact.contributors.set(id, factorMatrix);
            }
        } else if (
            !processScript(relationScope, childNode) &&
            !processCommonMeta(relationScope, childNode) &&
            !processRelationMeta(relationScope, childNode) &&
            !processRole(relationScope, childNode) &&
            !childNodeCallback(relationScope, childNode)
        ) {
            scope.root.config.ignoreNodes.push(childNode);
        }
    }

    for (const relation of relations) {
        scope.root.value.data.relations.push(relation);
        if(!("DAH_obj_location" in relation.DAH_meta)) {
            (relation.DAH_meta as Record<string, unknown>).DAH_obj_location = Object.assign({}, scope.document.config.DAH_obj_location);
        }
        if (relation.contributors.size == 0) {
            if (scope.entry !== undefined) {
                relation.contributors.set(scope.entry.value.id, identityMatrix);
            }
        }
    }

    return true;
}

function processRemix(scope: DocumentScope | EntryScope | ContainsScope, node: unknown): boolean {
    return processRelationBase(scope, node, "remix", (attrs) => [
        scope.root.context.extensions.DAH_standards!.remix(
            scope.root.context,
            new Map(),
            transformId(scope, attrs["id"]!)
        ),
    ]);
}

function processFeatureMusic(
    scope: DocumentScope | EntryScope | ContainsScope,
    node: unknown
): boolean {
    return processRelationBase(scope, node, "featureMusic", (attrs) => [
        scope.root.context.extensions.DAH_standards!.featureMusic(
            scope.root.context,
            new Map(),
            transformId(scope, attrs["id"]!)
        ),
    ]);
}

function processKilledBy(
    scope: DocumentScope | EntryScope | ContainsScope,
    node: unknown
): boolean {
    return processRelationBase(scope, node, "killedBy", (attrs) => [
        scope.root.context.extensions.DAH_standards!.killedBy(
            scope.root.context,
            new Map(),
            transformId(scope, attrs["id"]!),
            parseFloat(attrs["potential"]),
            parseFloat(attrs["effect"])
        ),
    ]);
}

function parseVisualType(visualType: string): VisualType | undefined {
    return {
        animated: VisualType.Animated,
        rpg3dGame: VisualType.RPG3DGame,
        animatedShort: VisualType.AnimatedShort,
        animatedMV: VisualType.AnimatedMV,
        visualNovel: VisualType.VisualNovel,
        manga: VisualType.Manga,
        animatedGachaCardArt: VisualType.AnimatedGachaCardArt,
        gachaCardArt: VisualType.GachaCardArt,
        lightNovel: VisualType.LightNovel,
        semiAnimatedMV: VisualType.SemiAnimatedMV,
        staticMV: VisualType.StaticMV,
        albumArt: VisualType.AlbumArt,
    }[visualType];
}

function parseDuration(duration: string): Duration {
    const [seconds, minutes, hours] = duration
        .split(":")
        .reverse()
        .map((x) => parseInt(x));
    return Duration.fromObject({ hours, minutes, seconds });
}

function parsePeriod(scope: Scope, node: unknown): DatePeriod | undefined {
    const attrs = getAttributes(node);
    if ("from" in attrs && "to" in attrs) {
        const from = parseDate(scope, attrs["from"]);
        const to = parseDate(scope, attrs["to"]);
        return {
            type: "fromto",
            from,
            to,
        };
    } else if ("length" in attrs) {
        return {
            type: "duration",
            length: Duration.fromObject({ days: parseInt(attrs["length"]) }),
        };
    }

    return undefined;
}

function parseDate(scope: Scope, dateString: string): DateTime {
    if (dateString === "today") {
        return scope.root.config.today;
    } else if (dateString.startsWith("epoch")) {
        const offset = parseInt(dateString.substring(6));
        return DateTime.fromSeconds(offset * 86400);
    } else {
        return DateTime.fromISO(dateString);
    }
}

function parseEmotions(emotions: string): WeightedEmotions {
    if (emotions.length === 2) {
        return [[parseEmotion(emotions)!, 1.0]];
    }

    return emotions
        .split(":")
        .map((token) => token.split("-"))
        .map(([emotion, factor]) => [parseEmotion(emotion)!, parseFloat(factor)]);
}

function parseEmotion(emotion: string): EmotionFactor | undefined {
    const map: Record<string, EmotionFactor> = {
        AP: AP,
        AU: AU,
        MP: MP,
        MU: MU,
        CP: CP,
        CU: CU,
    };

    return map[emotion];
}

function parseFactor(name: string): FactorScore | undefined {
    return {
        "Emotion.AU": AU,
        "Emotion.AP": AP,
        "Emotion.MU": MU,
        "Emotion.MP": MP,
        "Emotion.CU": CU,
        "Emotion.CP": CP,
        "Art.Language": AL,
        "Art.Visual": AV,
        "Art.Music": AM,
        Boredom: Boredom,
        Additional: Additional,
    }[name];
}

function processRelation(
    scope: DocumentScope | EntryScope | ContainsScope,
    node: unknown
): boolean {
    return (
        processRemix(scope, node) ||
        processFeatureMusic(scope, node) ||
        processKilledBy(scope, node)
    );
}

function processContains(scope: EntryScope | ContainsScope, node: unknown): boolean {
    if (!isElement(node, "contains")) {
        return false;
    }

    const attrs = getAttributes(node);
    const factor = new ScalarMatrix(
        scope.root.config.containFactorEvaluator(attrs["factor"] ?? "1.0")
    );

    let id = attrs["id"];
    const multipliedFactor = scope.multipliedFactor.mul(factor);
    if (id !== undefined) {
        id = transformId(scope, id);
        scope.entry.value.children.set(id, multipliedFactor);
    }

    const containsScope: ContainsScope = {
        type: "contains",
        parent: scope,
        document: scope.document,
        entry: scope.entry,
        root: scope.root,
        factor,
        multipliedFactor,
        local: Object.assign({}, scope.local),
        macros: new Map(scope.macros),
    };

    let warned = false;

    const childNodes = node["contains"] as Array<unknown>;
    preprocessMacros(containsScope, childNodes);
    for (const childNode of childNodes) {
        if (
            processDirective(containsScope, childNode) ||
            processContains(containsScope, childNode)
        ) {
            if (id !== undefined && !warned) {
                console.warn(
                    "the `id` attribute of `contains` elements should only be used in the simple context" +
                        " (no child elements should be processed this way), but child elements were found." +
                        " Fallback behavior: respect both child elements and the id attribute" +
                        " (this may not work in the future)."
                );
                warned = true;
            }
        } else {
            scope.root.config.ignoreNodes.push(childNode);
        }
    }

    return true;
}

function processRole(scope: EntryScope | ImpactScope | RelationScope, node: unknown): boolean {
    if (!isElement(node, "role")) {
        return false;
    }

    ifDefined(scope.root.context.extensions.DAH_entry_roles, (e) => {
        const attrs = getAttributes(node);
        const id = attrs["id"]!;
        const roleString = attrs["roles"];
        const roles = e.parseRoleExpressionString(roleString);

        const value = scope.value;
        if (value instanceof Array) {
            for (const ir of value) {
                e.addRole(ir, id, roles);
            }
        } else {
            e.addRole(value, id, roles);
        }
    });

    return true;
}

// expand the macro, if this is not a `ref` element, return undefined
function processReference(scope: Scope, node: unknown): unknown[] | undefined {
    if (!(isObject(node) && "ref" in node)) {
        return undefined;
    }

    const attrs = getAttributes(node);
    const name = attrs["name"]!;
    const macro = scope.macros.get(name);
    if (macro === undefined) {
        console.warn(`macro ${name} not found`);
        return undefined;
    }

    delete attrs["name"];
    return substituteMacro(macro, new Map(Object.entries(attrs)), node["ref"] as unknown[]);
}

// scripts too
function processScript(
    scope: DocumentScope | EntryScope | ContainsScope | ImpactScope | RelationScope,
    node: unknown
): boolean {
    if (!isElement(node, "script")) {
        return false;
    }

    const attrs = getAttributes(node);
    if ("src" in attrs) {
        const src = attrs["src"];
        const script = scope.root.config.scriptResolver(src);
        if (script === undefined) {
            return false;
        }
        executeScript(scope, script, attrs["entryPoint"]);
    } else {
        const script = (node["script"] as unknown[])
            .flatMap((node) => (isElement(node, "#text") ? [node["#text"] as string] : []))
            .join("\n");
        executeScript(scope, script, attrs["entryPoint"]);
    }

    return true;
}

function executeScript(scope: Scope, script: string, entryPoint: string | undefined): void {
    new Function("global", "local", "scope", script).apply(scope, [
        scope.root.global,
        scope.local,
        scope,
    ]);
    if (entryPoint !== undefined) {
        (scope.local as Record<string, () => void>)[entryPoint]();
    }
}

function processEntryMeta(scope: EntryScope, node: unknown): boolean {
    return (
        processSource(scope, node) ||
        processProgress(scope, node) ||
        processAnimeProgress(scope, node) ||
        processConsumedProgress(scope, node) ||
        processAnimeConsumedProgress(scope, node) ||
        processMusicConsumedProgress(scope, node) ||
        processBestGirl(scope, node) ||
        processEntryQueue(scope, node)
    );
}

function processSource(scope: EntryScope, node: unknown): boolean {
    if (!isElement(node, "source")) {
        return false;
    }
    const childNodes = node["source"] as Array<unknown>;
    const DAH_additional_sources: AdditionalSources = {};
    scope.value.DAH_meta["DAH_additional_sources"] = DAH_additional_sources;

    outer: for (const childNode of childNodes) {
        if (!isObject(childNode)) {
            scope.root.config.ignoreNodes.push(childNode);
            continue;
        }

        const simpleDatabases: Record<
            string,
            "id_MyAnimeList" | "id_AniList" | "id_AniDB" | "id_Kitsu" | "id_VNDB"
        > = {
            mal: "id_MyAnimeList",
            al: "id_AniList",
            adb: "id_AniDB",
            ks: "id_Kitsu",
            vndb: "id_VNDB",
        };
        for (const [attrKey, metaKey] of Object.entries(simpleDatabases)) {
            if (attrKey in childNode) {
                DAH_additional_sources[metaKey] = parseInt(getAttributes(childNode)["id"]!);
                continue outer;
            }
        }

        if ("vgmdb" in childNode) {
            DAH_additional_sources.vgmdb = getAttributes(childNode);
        } else if ("youtube" in childNode) {
            DAH_additional_sources.youtube = {
                ...getAttributes(childNode),
                DAH_meta: {},
            } as YoutubeSource;
        } else if ("spotify" in childNode) {
            DAH_additional_sources.spotify = {
                ...getAttributes(childNode),
                DAH_meta: {},
            } as typeof DAH_additional_sources.spotify;
        } else if ("urls" in childNode) {
            const urlObjects = (DAH_additional_sources.urls ??= []);

            for (const urlNode of childNode["urls"] as Array<unknown>) {
                if (!isElement(urlNode, "url")) {
                    scope.root.config.ignoreNodes.push(urlNode);
                    continue;
                }
                const attrs = getAttributes(urlNode) as Record<"name" | "src", string>;
                const urlScope: URLScope = {
                    value: {
                        DAH_meta: {},
                    },
                };
                for (const metaNode of urlNode["url"] as Array<unknown>) {
                    if (!processMeta(urlScope, metaNode)) {
                        scope.root.config.ignoreNodes.push(metaNode);
                    }
                }

                const urlObject = {
                    ...attrs,
                    ...urlScope.value,
                };

                urlObjects.push(urlObject);
            }
        } else {
            scope.root.config.ignoreNodes.push(childNode);
        }
    }

    return true;
}

function processProgress(scope: EntryScope, node: unknown): boolean {
    if (!isElement(node, "progress")) {
        return false;
    }

    const attrs = getAttributes(node);
    scope.root.context.extensions.DAH_entry_progress!.progress(
        scope.root.context,
        scope.value,
        parseStatus(attrs["status"]!)!,
        parseDuration(attrs["length"]!)!
    );
    return true;
}

function processAnimeProgress(scope: EntryScope, node: unknown): boolean {
    if (!isElement(node, "animeProgress")) {
        return false;
    }

    const attrs = getAttributes(node);
    scope.root.context.extensions.DAH_entry_progress!.animeProgress(
        scope.root.context,
        scope.value,
        parseStatus(attrs["status"]!)!,
        parseInt(attrs["episodes"]),
        parseDuration(attrs["episodeDuration"]!)!
    );
    return true;
}

function processConsumedProgress(scope: EntryScope, node: unknown): boolean {
    if (!isElement(node, "consumedProgress")) {
        return false;
    }

    const attrs = getAttributes(node);
    acceptImpact(
        scope,
        scope.root.context.extensions.DAH_entry_progress!.consumedProgress(
            scope.root.context,
            scope.value,
            parseStatus(attrs["status"]!)!,
            parseFloat(attrs["boredom"]!)!,
            parseDuration(attrs["duration"]!)!
        )
    );
    return true;
}

function processAnimeConsumedProgress(scope: EntryScope, node: unknown): boolean {
    if (!isElement(node, "animeConsumedProgress")) {
        return false;
    }

    const attrs = getAttributes(node);
    acceptImpact(
        scope,
        scope.root.context.extensions.DAH_entry_progress!.animeConsumedProgress(
            scope.root.context,
            scope.value,
            parseStatus(attrs["status"]!)!,
            parseFloat(attrs["boredom"]),
            parseInt(attrs["episodes"]),
            parseDuration(attrs["episodeDuration"] ?? "20:00")
        )
    );
    return true;
}

function processMusicConsumedProgress(scope: EntryScope, node: unknown): boolean {
    if (!isElement(node, "musicConsumedProgress")) {
        return false;
    }

    const attrs = getAttributes(node);
    acceptImpact(
        scope,
        scope.root.context.extensions.DAH_entry_progress!.musicConsumedProgress(
            scope.root.context,
            scope.value,
            parseDuration(attrs["length"]!)!
        )
    );
    return true;
}

function processBestGirl(scope: EntryScope, node: unknown): boolean {
    if (!isElement(node, "bestGirl")) {
        return false;
    }

    const bestGirl = getAttributes(node)["name"]!;
    scope.value.DAH_meta.DAH_entry_bestGirl = bestGirl;
    return true;
}

function parseStatus(statusString: string): EntryStatus | undefined {
    return statusString as EntryStatus;
}

function processImpactMeta(_scope: ImpactScope, _node: unknown): boolean {
    return false;
}

function processRelationMeta(_scope: RelationScope, _node: unknown): boolean {
    return false;
}

function processCommonMeta(
    scope: EntryScope | ImpactScope | RelationScope,
    node: unknown
): boolean {
    return processMeta(scope, node) || processValidatorSuppress(scope, node);
    // scope.value.DAH_meta
}

function preprocessMacros(scope: Scope, childNodes: unknown[]) {
    for (const node of childNodes) {
        if (processInclude(scope as DocumentScope, node, true)) {
            continue;
        }
        if (!isElement(node, "def")) {
            continue;
        }
        const attrs = getAttributes(node);
        const name = attrs["name"];
        const variables = attrs["vars"]
            .split(",")
            .map((x) => x.trim())
            .map((x) => x.split(":")[0]);
        const macro = {
            name,
            variables,
            template: node["def"] as unknown[],
        };
        scope.macros.set(name, macro);
        if (attrs["visibility"] === "public" && "publicMacros" in scope) {
            scope.publicMacros.set(name, macro);
        }
    }
}

// only supporting one-layer meta for now

function unsafeSetMeta(
    scope: EntryScope | ImpactScope | RelationScope | URLScope,
    key: string,
    value: unknown
) {
    (Array.isArray(scope.value) ? scope.value : [scope.value]).forEach((ir) =>
        unsafeSetMetaSingle(ir, key, value)
    );
}

function unsafeSetMetaSingle<M extends Meta>(hasMeta: HasMeta<M>, key: string, value: unknown) {
    (hasMeta.DAH_meta as Record<string, unknown>)[key] = value;
}

function processMeta(
    scope: EntryScope | ImpactScope | RelationScope | URLScope,
    node: unknown
): boolean {
    if (!(isObject(node) && "meta" in node)) {
        return false;
    }

    const attrs = getAttributes(node);
    const key = attrs["key"]!;
    const value = attrs["value"]!;
    unsafeSetMeta(scope, key, value);
    return true;
}

function processValidatorSuppress(
    scope: EntryScope | ImpactScope | RelationScope,
    node: unknown
): boolean {
    if (!(isObject(node) && "validatorSuppress" in node)) {
        return false;
    }

    const rules = getAttributes(node)["rules"]!.split(";");
    ifDefined(scope.root.context.extensions.DAH_validator_suppress, (e) => {
        const value = Array.isArray(scope.value) ? scope.value : [scope.value];

        for (const elem of value) {
            for (const rule of rules) {
                e.suppressRule<Meta>(elem, rule);
            }
        }
    });
    return true;
}

function processEntryQueue(scope: EntryScope, node: unknown): boolean {
    if (!(isObject(node) && "queue" in node)) {
        return false;
    }

    const rules = getAttributes(node)["queues"]!.split(";");
    ifDefined(scope.root.context.extensions.DAH_validator_suppress, (e) => {
        for (const rule of rules) {
            e.suppressRule<Meta>(scope.value, rule);
        }
    });
    return true;
}

function processInclude(scope: DocumentScope, node: unknown, includeOnlyMacros = false): boolean {
    if (!(isObject(node) && "include" in node)) {
        return false;
    }

    const attrs = getAttributes(node);
    const src = attrs["src"];

    if (src !== undefined) {
        const included = scope.root.config.includeResolver(src);
        if (included === undefined) {
            return true;
        }

        const [includedContent, includedOptions] = included;
        includedOptions.macros ??= new Map();
        includedOptions.includeOnlyMacros = includeOnlyMacros;
        for (const [name, macro] of scope.publicMacros) {
            if (!includedOptions.macros.has(name)) {
                includedOptions.macros.set(name, macro);
            }
        }
        const { nrsData, publicMacros } = processNRSXML(
            scope.context,
            includedContent,
            includedOptions
        );
        const data = scope.value.data;
        if (!includeOnlyMacros) {
            nrsData.entries.forEach((value, key) => data.entries.set(key, value));
            nrsData.impacts.forEach((x) => data.impacts.push(x));
            nrsData.relations.forEach((x) => data.relations.push(x));
        }

        for (const [name, macro] of publicMacros) {
            scope.macros.set(name, macro);
            scope.publicMacros.set(name, macro);
        }
    }

    return true;
}

function getAttributes(node: unknown): Record<string, string> {
    const rawAttrs = (() => {
        if (isObject(node)) {
            return (node[":@"] ?? {}) as Record<string, string>;
        }

        return {};
    })();

    // remove prefixes
    return Object.fromEntries(Object.entries(rawAttrs).map(([k, v]) => [k.substring(2), v]));
}

function transformId(scope: Scope, id: string): string {
    if (scope.entry !== undefined) {
        id = id.replaceAll("$", scope.entry.value.id);
    }
    return id;
}
