import { processNRSXML, ProcessOptions } from "./nrsml/parse.ts";
import { newContext, processContext } from "https://raw.githubusercontent.com/ngoduyanh/nrs-lib-ts/a93ea18ab3fa4f732fb7822038680235c6485d03/mod.ts";
import { writableStreamFromWriter } from "https://deno.land/std@0.181.0/streams/mod.ts";
import { dirname, resolve } from "https://deno.land/std@0.181.0/path/mod.ts";

const bulk = Deno.openSync("bulk.json", { create: true, write: true });
bulk.truncateSync(0);

const stream = writableStreamFromWriter(bulk);
const context = newContext({
    extensions: {
        DAH_combine_pow: {},
        DAH_entry_progress: {},
        DAH_factors: {},
        DAH_overall_score: {},
        DAH_standards: {},
        DAH_serialize: {},
        DAH_serialize_json: {
            bulk: stream,
            indent: 4,
        },
    },
});

function getOptions(path: string): ProcessOptions {
    return {
        includeResolver: (relativePath) => {
            const newPath = resolve(dirname(path), relativePath);
            return [Deno.readTextFileSync(newPath), getOptions(newPath)];
        },
        scriptResolver: (relativePath) => {
            const newPath = resolve(dirname(path), relativePath);
            return Deno.readTextFileSync(newPath);
        },
        ignoreNodes: [],
        freeze: true,
    };
}

const filename = "/home/torani/dev/nrs-impl-kt/impl/src/main/kotlin/com/dah/nrs/NRSImplMain.xml";
const options = getOptions(filename);

const { nrsData, publicMacros } = processNRSXML(context, Deno.readTextFileSync(filename), options);

processContext(context, nrsData);

Deno.writeTextFileSync("ignore.json", JSON.stringify(options.ignoreNodes, undefined, 4));
