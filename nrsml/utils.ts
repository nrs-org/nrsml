import { XMLBuilder, XMLParser } from "../deps.ts";
import { ProcessOptions } from "./parse.ts";
import { dirname, resolve } from "https://deno.land/std@0.182.0/path/mod.ts";
import { existsSync } from "https://deno.land/std@0.182.0/fs/mod.ts";

let parser: XMLParser | null = null;
let builder: XMLBuilder | null = null;
export function standardParser(): XMLParser {
    // lazy initialization
    return (parser =
        parser ||
        new XMLParser({
            // attributes are important
            ignoreAttributes: false,
            // default prefixes, in case something changes
            // attributeNamePrefix: "@_",
            // attributesGroupName: ":@",
            // keep the comments to preserve the document structure
            commentPropName: "#comment",
            textNodeName: "#text",
            // boolean attributes are not supported in standard xml,
            // so there is no need to enable it
            allowBooleanAttributes: false,
            // ordering is important, e.g. there are many best girl elements
            // (only the last one is used, but i like baiting :tf)
            preserveOrder: true,
            // keep the pi tags to preserve the document structure
            ignorePiTags: false,
            // always turn things into arrays
            // this makes things a lot more predictable
            isArray: () => true,
            // no auto parsing because there may be names that is a number
            // example: https://myanimelist.net/manga/40813/
            parseAttributeValue: false,
            parseTagValue: false,
            // this is not used
            processEntities: false,
            // no namespace is used either way
            removeNSPrefix: false,
            // no stop nodes, no unpaired tags,

            // disable trimming values
            // since there may be some weird-ass names with leading or trailing spaces,
            // and more importantly, it preserves the document structure
            trimValues: false,

            tagValueProcessor: (_, tagValue) => processValue(tagValue),
            attributeValueProcessor: (_, value) => processValue(value),
        }));
}

function processValue(value: string): string {
    return value
        .replace(/&lt;/g, "<")
        .replace(/&amp;/g, "&")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'");
}

export function standardBuilder(): XMLBuilder {
    return (builder =
        builder ||
        new XMLBuilder({
            // attributes are important
            ignoreAttributes: false,
            // default prefixes, in case something changes
            // attributeNamePrefix: "@_",
            // attributesGroupName: ":@",
            // keep the comments to preserve the document structure
            commentPropName: "#comment",
            textNodeName: "#text",
            // ordering is important, e.g. there are many best girl elements
            // (only the last one is used, but i like baiting :tf)
            preserveOrder: true,
            suppressEmptyNode: true,
        }));
}

export function isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && !Array.isArray(value) && value !== null;
}

export function isElement<S extends string>(
    node: unknown,
    name: S
): node is Record<string, unknown> & { S: unknown } {
    return isObject(node) && name in node;
}

export function assert(condition: boolean, msg?: string): asserts condition {
    if (!condition) {
        throw new Error(msg);
    }
}

export function deepFreeze(object: unknown) {
    // Retrieve the property names defined on object
    // deno-lint-ignore ban-types
    const propNames = Reflect.ownKeys(object as object);

    // Freeze properties before freezing self
    for (const name of propNames) {
        // deno-lint-ignore no-explicit-any
        const value = (object as any)[name];

        if ((value && typeof value === "object") || typeof value === "function") {
            deepFreeze(value as Record<string | symbol, unknown>);
        }
    }

    return Object.freeze(object);
}

export class FileResolver {
    includeDirectories: string[] = [];
    scriptDirectories: string[] = [];
    warnNotFound: (searchDirectories: string[], scriptPath: string) => void = () => {};
    optionsTransformer?(options: ProcessOptions): void;

    addResolveDirectory(path: string) {
        this.addIncludeDirectory(path);
        this.addScriptDirectory(path);
    }

    addIncludeDirectory(path: string) {
        this.includeDirectories.push(path);
    }

    addScriptDirectory(path: string) {
        this.scriptDirectories.push(path);
    }

    getProcessOptions(documentPath?: string): ProcessOptions {
        const options = {
            freeze: true,
            includeResolver: this.includeResolver(documentPath),
            scriptResolver: this.scriptResolver(documentPath),
        };

        if (this.optionsTransformer !== undefined) {
            this.optionsTransformer(options);
        }

        return options;
    }

    findPath(
        searchDirectories: string[],
        documentPath: string | undefined,
        referencePath: string
    ): string | undefined {
        if (documentPath !== undefined) {
            searchDirectories = [dirname(documentPath), ...searchDirectories];
        }

        for (let i = 0; i < searchDirectories.length; i++) {
            const path = resolve(searchDirectories[i], referencePath);
            if (existsSync(path)) {
                return path;
            }
        }

        return undefined;
    }

    scriptResolver(documentPath?: string): (p: string) => string | undefined {
        return (referencePath) => {
            const path = this.findPath(this.scriptDirectories, documentPath, referencePath);
            if (path === undefined) {
                return undefined;
            }

            return Deno.readTextFileSync(path);
        };
    }

    includeResolver(documentPath?: string): (p: string) => [string, ProcessOptions] | undefined {
        return (referencePath) => {
            const path = this.findPath(this.includeDirectories, documentPath, referencePath);
            if (path === undefined) {
                return undefined;
            }

            return [Deno.readTextFileSync(path), this.getProcessOptions(path)];
        };
    }
}
