export type FormulaValueType =
  | "any"
  | "null"
  | "boolean"
  | "number"
  | "string"
  | "date"
  | "duration"
  | "list"
  | "object"
  | "file"
  | "link"
  | "regexp"
  | "html"
  | "image"
  | "icon"
  | "error";

export interface PropertyMetadata {
  name: string;
  type: FormulaValueType;
  source?: "note" | "file" | "formula" | "this";
  detail?: string;
  documentation?: string;
}

export interface FunctionMetadata {
  name: string;
  receiver?: FormulaValueType | "any" | "string|list";
  parameters: string[];
  returns: FormulaValueType;
  signature: string;
  detail?: string;
  documentation?: string;
}

export const filePropertyMetadata: PropertyMetadata[] = [
  { name: "name", type: "string", source: "file", documentation: "The file basename without extension." },
  { name: "basename", type: "string", source: "file", documentation: "The file basename without extension." },
  { name: "path", type: "string", source: "file", documentation: "The vault-relative file path." },
  { name: "folder", type: "string", source: "file", documentation: "The vault-relative containing folder." },
  { name: "ext", type: "string", source: "file", documentation: "The file extension without a leading dot." },
  { name: "size", type: "number", source: "file", documentation: "The file size in bytes." },
  { name: "properties", type: "object", source: "file", documentation: "The note frontmatter/properties object." },
  { name: "tags", type: "list", source: "file", documentation: "The tags found on the file." },
  { name: "links", type: "list", source: "file", documentation: "Internal links from the file, including frontmatter and embeds." },
  { name: "embeds", type: "list", source: "file", documentation: "Embedded internal links from the file." },
  { name: "backlinks", type: "list", source: "file", documentation: "Files that link to this file." },
  { name: "ctime", type: "date", source: "file", documentation: "The file creation time." },
  { name: "mtime", type: "date", source: "file", documentation: "The file modification time." },
  { name: "file", type: "file", source: "file", documentation: "The file value itself." },
];

export const globalFunctionMetadata: FunctionMetadata[] = [
  { name: "escapeHTML", parameters: ["html: string"], returns: "string", signature: "escapeHTML(html: string): string" },
  { name: "date", parameters: ["date: string"], returns: "date", signature: "date(date: string): date" },
  { name: "duration", parameters: ["value: string"], returns: "duration", signature: "duration(value: string): duration" },
  { name: "file", parameters: ["path: string | file | link"], returns: "file", signature: "file(path: string | file | link): file" },
  { name: "html", parameters: ["html: string"], returns: "html", signature: "html(html: string): html" },
  { name: "if", parameters: ["condition: any", "trueResult: any", "falseResult?: any"], returns: "any", signature: "if(condition: any, trueResult: any, falseResult?: any): any" },
  { name: "image", parameters: ["path: string | file | link"], returns: "image", signature: "image(path: string | file | link): image" },
  { name: "icon", parameters: ["name: string"], returns: "icon", signature: "icon(name: string): icon" },
  { name: "link", parameters: ["path: string | file", "display?: value"], returns: "link", signature: "link(path: string | file, display?: value): link" },
  { name: "list", parameters: ["element: any"], returns: "list", signature: "list(element: any): list" },
  { name: "max", parameters: ["...values: number[]"], returns: "number", signature: "max(value1: number, value2: number...): number" },
  { name: "min", parameters: ["...values: number[]"], returns: "number", signature: "min(value1: number, value2: number...): number" },
  { name: "now", parameters: [], returns: "date", signature: "now(): date" },
  { name: "number", parameters: ["input: any"], returns: "number", signature: "number(input: any): number" },
  { name: "today", parameters: [], returns: "date", signature: "today(): date" },
  { name: "random", parameters: [], returns: "number", signature: "random(): number" },
];

export const methodFunctionMetadata: FunctionMetadata[] = [
  { name: "isEmpty", receiver: "any", parameters: [], returns: "boolean", signature: "isEmpty(): boolean" },
  { name: "isTruthy", receiver: "any", parameters: [], returns: "boolean", signature: "isTruthy(): boolean" },
  { name: "isType", receiver: "any", parameters: ["type: string"], returns: "boolean", signature: "isType(type: string): boolean" },
  { name: "toString", receiver: "any", parameters: [], returns: "string", signature: "toString(): string" },
  { name: "contains", receiver: "string|list", parameters: ["value: any"], returns: "boolean", signature: "contains(value): boolean" },
  { name: "containsAll", receiver: "string|list", parameters: ["...values: any[]"], returns: "boolean", signature: "containsAll(...values): boolean" },
  { name: "containsAny", receiver: "string|list", parameters: ["...values: any[]"], returns: "boolean", signature: "containsAny(...values): boolean" },
  { name: "endsWith", receiver: "string", parameters: ["suffix: string"], returns: "boolean", signature: "endsWith(suffix: string): boolean" },
  { name: "lower", receiver: "string", parameters: [], returns: "string", signature: "lower(): string" },
  { name: "replace", receiver: "string", parameters: ["pattern: string | regexp", "replacement: string"], returns: "string", signature: "replace(pattern, replacement): string" },
  { name: "repeat", receiver: "string", parameters: ["count: number"], returns: "string", signature: "repeat(count: number): string" },
  { name: "reverse", receiver: "string", parameters: [], returns: "string", signature: "reverse(): string" },
  { name: "slice", receiver: "string", parameters: ["start: number", "end?: number"], returns: "string", signature: "slice(start: number, end?: number): string" },
  { name: "split", receiver: "string", parameters: ["separator: string | regexp", "limit?: number"], returns: "list", signature: "split(separator, limit?: number): list" },
  { name: "startsWith", receiver: "string", parameters: ["prefix: string"], returns: "boolean", signature: "startsWith(prefix: string): boolean" },
  { name: "title", receiver: "string", parameters: [], returns: "string", signature: "title(): string" },
  { name: "trim", receiver: "string", parameters: [], returns: "string", signature: "trim(): string" },
  { name: "abs", receiver: "number", parameters: [], returns: "number", signature: "abs(): number" },
  { name: "ceil", receiver: "number", parameters: [], returns: "number", signature: "ceil(): number" },
  { name: "floor", receiver: "number", parameters: [], returns: "number", signature: "floor(): number" },
  { name: "round", receiver: "number", parameters: ["digits?: number"], returns: "number", signature: "round(digits?: number): number" },
  { name: "toFixed", receiver: "number", parameters: ["digits: number"], returns: "string", signature: "toFixed(digits: number): string" },
  { name: "date", receiver: "date", parameters: [], returns: "date", signature: "date(): date" },
  { name: "format", receiver: "date", parameters: ["format: string"], returns: "string", signature: "format(format: string): string" },
  { name: "time", receiver: "date", parameters: [], returns: "string", signature: "time(): string" },
  { name: "relative", receiver: "date", parameters: [], returns: "string", signature: "relative(): string" },
  { name: "filter", receiver: "list", parameters: ["expression: any"], returns: "list", signature: "filter(expression): list" },
  { name: "flat", receiver: "list", parameters: [], returns: "list", signature: "flat(): list" },
  { name: "join", receiver: "list", parameters: ["separator: string"], returns: "string", signature: "join(separator: string): string" },
  { name: "map", receiver: "list", parameters: ["expression: any"], returns: "list", signature: "map(expression): list" },
  { name: "reduce", receiver: "list", parameters: ["expression: any", "acc: any"], returns: "any", signature: "reduce(expression, acc): any" },
  { name: "sort", receiver: "list", parameters: [], returns: "list", signature: "sort(): list" },
  { name: "sum", receiver: "list", parameters: [], returns: "number", signature: "sum(): number" },
  { name: "mean", receiver: "list", parameters: [], returns: "number", signature: "mean(): number" },
  { name: "unique", receiver: "list", parameters: [], returns: "list", signature: "unique(): list" },
  { name: "keys", receiver: "object", parameters: [], returns: "list", signature: "keys(): list" },
  { name: "values", receiver: "object", parameters: [], returns: "list", signature: "values(): list" },
  { name: "matches", receiver: "regexp", parameters: ["input: string"], returns: "boolean", signature: "matches(input: string): boolean" },
  { name: "asLink", receiver: "file", parameters: ["display?: string"], returns: "link", signature: "asLink(display?: string): link" },
  { name: "hasLink", receiver: "file", parameters: ["target: file | link | string"], returns: "boolean", signature: "hasLink(target: file | link | string): boolean" },
  { name: "hasProperty", receiver: "file", parameters: ["name: string"], returns: "boolean", signature: "hasProperty(name: string): boolean" },
  { name: "hasTag", receiver: "file", parameters: ["...values: string[]"], returns: "boolean", signature: "hasTag(...values: string): boolean" },
  { name: "inFolder", receiver: "file", parameters: ["folder: string"], returns: "boolean", signature: "inFolder(folder: string): boolean" },
  { name: "asFile", receiver: "link", parameters: [], returns: "file", signature: "asFile(): file" },
  { name: "linksTo", receiver: "link", parameters: ["target: file | link | string"], returns: "boolean", signature: "linksTo(target: file | link | string): boolean" },
];

export const allFunctionMetadata: FunctionMetadata[] = [...globalFunctionMetadata, ...methodFunctionMetadata];

export function getGlobalFunction(name: string): FunctionMetadata | undefined {
  return globalFunctionMetadata.find((fn) => fn.name === name);
}

export function getMethodFunction(name: string, receiver?: FormulaValueType | "any"): FunctionMetadata | undefined {
  return methodFunctionMetadata.find((fn) => fn.name === name && (!receiver || functionAppliesToReceiver(fn, receiver)));
}

export function getFileProperty(name: string): PropertyMetadata | undefined {
  return filePropertyMetadata.find((property) => property.name === name);
}

export function functionsForReceiver(receiver?: FormulaValueType | "any"): FunctionMetadata[] {
  if (!receiver || receiver === "any") return methodFunctionMetadata;
  return methodFunctionMetadata.filter((fn) => functionAppliesToReceiver(fn, receiver));
}

export function functionAppliesToReceiver(fn: FunctionMetadata, receiver: FormulaValueType | "any"): boolean {
  if (!fn.receiver || fn.receiver === "any" || receiver === "any") return true;
  if (fn.receiver === "string|list") return receiver === "string" || receiver === "list";
  return fn.receiver === receiver;
}
