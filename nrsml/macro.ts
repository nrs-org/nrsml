// deno-lint-ignore-file no-explicit-any
import { assert, isElement } from "./utils.ts";

export interface Macro {
    name: string;
    variables: string[];
    template: unknown[];
}

type ReplacementFn = (value: any, key: string | number | undefined) => any[];

function transform(o: any, replace: ReplacementFn): any {
    if (Array.isArray(o)) {
        // handle array first, because array is an object too
        const result: any[] = [];
        for (let i = 0; i < o.length; i++) {
            const value = o[i];
            const replacement = replace(value, i).map((value) => transform(value, replace));
            result.push(...replacement);
        }
        return result;
    } else if (typeof o === "object" && o !== null) {
        // handle object
        const result: Record<string, unknown> = {};
        for (const key in o) {
            const value = o[key];
            replace(value, key)
                .map(([value, key]) => [transform(value, replace), key])
                .forEach(([value, key]) => (result[key] = value));
        }
        return result;
    } else if (typeof o === "string") {
        const replacedValue = replace(o, undefined);
        assert(replacedValue.length == 1);
        return replacedValue[0];
    }
    return o; // no-op for other types
}

function replace(string: string, replacements: Map<string, string>): string {
    for (const [search, replacement] of replacements) {
        string = string.replace(search, replacement);
    }
    return string;
}

export function substituteMacro(
    macro: Macro,
    variables: Map<string, string>,
    macroChildNodes: unknown[]
): unknown[] {
    return transform(macro.template, (value, key) => {
        if (typeof value === "string") {
            value = replace(value, variables);
        }
        if (isElement(value, "children")) {
            return macroChildNodes;
        }
        if (typeof key === "string") {
            key = replace(key, variables);
        }
        if (typeof key === "number") {
            key = undefined;
        }

        return [key === undefined ? value : [value, key]];
    });
}
