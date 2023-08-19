export {
    type Data,
    type Entry,
    type Impact,
    type Relation,
    type HasMeta,
    type Vector,
    type Context,
    type Meta,
    newZeroVector,
    newContext,
    processContext,
    type FactorScore,
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
    type WeightedEmotions,
    type EmotionFactor,
    type DatePeriod,
    type AdditionalSources,
    type EntryMeta,
    Sign,
    VisualType,
    EntryStatus,
    ifDefined,
} from "https://raw.githubusercontent.com/btmxh/nrs-lib-ts/v1.1.1/mod.ts";

export { XMLBuilder, XMLParser } from "npm:fast-xml-parser@4";

// @deno-types="npm:@types/luxon"
export { DateTime, Duration } from "npm:luxon@3.2.0";
