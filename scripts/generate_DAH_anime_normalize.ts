// this script is used to generate this file:
// https://github.com/ngoduyanh/nrs-lib-ts/blob/master/src/exts/DAH_anime_normalize_bulk.json
import { processNRSXML } from "../mod.ts";
import {
    newContext,
    processContext,
} from "https://raw.githubusercontent.com/ngoduyanh/nrs-lib-ts/a93ea18ab3fa4f732fb7822038680235c6485d03/mod.ts";
import { writableStreamFromWriter } from "https://deno.land/std@0.181.0/streams/mod.ts";

if (Deno.args.length == 0) {
    console.error(
        "Usage: [deno run --allow-all] scripts/generate_DAH_anime_normalize.json [output path]"
    );
    Deno.exit(1);
}
const bulkFile = Deno.openSync(Deno.args[0], { create: true, write: true });
bulkFile.truncateSync(0);

const document = "xml/DAH_anime_normalize.xml";
const content = Deno.readTextFileSync(document);
const context = newContext({
    extensions: {
        DAH_entry_progress: {},
        DAH_serialize: {},
        DAH_serialize_json: {
            bulk: writableStreamFromWriter(bulkFile),
            indent: 4,
        },
        DAH_standards: {},
        DAH_factors: {},
        DAH_combine_pp: {},
        DAH_overall_score: {},
    },
});

// includes not supported
const { nrsData } = processNRSXML(context, content, { freeze: true });
processContext(context, nrsData);
