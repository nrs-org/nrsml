import { XMLParser } from "npm:fast-xml-parser@4";
import { standardParser } from "./nrsml/utils.ts";

const json = JSON.stringify(
    standardParser().parse(Deno.readTextFileSync("xml/impl/BlueArchive.xml"))
);
Deno.writeTextFileSync("out.json", json, { create: true });
