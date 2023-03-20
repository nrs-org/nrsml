// import { parse } from "https://deno.land/x/xml@2.1.0/mod.ts"
// import { parse } from "https://deno.land/x/ts_xml_parser@1.0.0/mod.ts";
import { XMLParser, XMLBuilder, XMLValidator } from "npm:fast-xml-parser@4";
import { standardParser } from "./nrsml/utils.ts";

const source = await Deno.readTextFile("./xml/impl/BlueArchive.xml");
const document = standardParser().parse(source);

const builder = new XMLBuilder({
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
})

console.log(JSON.stringify(document));
await Deno.writeTextFile('xml/impl/BlueArchive2.xml', builder.build(document));

// import { processNRSXML } from "./nrsml/parse.ts";
// const source = await Deno.readTextFile("./xml/impl/Cue.xml");
// processNRSXML(source);

// const source = await Deno.readTextFile("./xml/impl/BlueArchive.xml");
// const document = standardParser().parse(source);
