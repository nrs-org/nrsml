import { NRSMLData } from "./data.ts";
import { XMLParser } from "npm:fast-xml-parser@4";

type NoLintObject = Record<string, unknown>;

export function processNRSXML(content: string): NRSMLData {
  const document = new XMLParser({
    allowBooleanAttributes: true,
    ignoreAttributes: false,
    ignoreDeclaration: false,
    preserveOrder: true,
  }).parse(content);

  // parsed document should be an object
  assert(document instanceof Object);
  return transform(document);
}

function assert(condition: boolean, msg?: string): asserts condition {
  if (!condition) {
    throw new Error(msg);
  }
}

function transform(document: NoLintObject): NRSMLData {
  interface DocumentNode extends NoLintObject {
    document: unknown,
  }

  const documentNodes = Object.values(document).filter(
    (node): node is DocumentNode => node instanceof Object && "document" in node
  );
  
  // one xml file must only have one document element
  assert(documentNodes.length === 1);

  const documentNode = documentNodes[0];
  return {};
}
