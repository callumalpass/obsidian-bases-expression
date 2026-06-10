import type { Diagnostic } from "./ast.js";
import { evaluateExpression, type EvaluationContext } from "./evaluator.js";
import { inspectExpression, type ExpressionInspection } from "./inspect.js";
import { parseExpression } from "./parser.js";

export interface PropertyCompletion {
  name: string;
  type?: string;
  source?: "note" | "file" | "formula" | "this";
  detail?: string;
}

export interface FunctionCompletion {
  name: string;
  receiver?: string;
  signature: string;
  detail?: string;
}

export interface CompletionItem {
  label: string;
  kind: "property" | "function" | "keyword" | "operator";
  insertText: string;
  detail?: string;
}

export interface FormulaLanguageSchema {
  properties?: PropertyCompletion[];
  formulas?: PropertyCompletion[];
  functions?: FunctionCompletion[];
}

const fileProperties: PropertyCompletion[] = [
  { name: "name", type: "string", source: "file" },
  { name: "basename", type: "string", source: "file" },
  { name: "path", type: "string", source: "file" },
  { name: "folder", type: "string", source: "file" },
  { name: "ext", type: "string", source: "file" },
  { name: "size", type: "number", source: "file" },
  { name: "properties", type: "object", source: "file" },
  { name: "tags", type: "list", source: "file" },
  { name: "links", type: "list", source: "file" },
  { name: "ctime", type: "date", source: "file" },
  { name: "mtime", type: "date", source: "file" },
];

const builtInFunctions: FunctionCompletion[] = [
  { name: "escapeHTML", signature: "escapeHTML(html: string): string" },
  { name: "date", signature: "date(date: string): date" },
  { name: "duration", signature: "duration(value: string): duration" },
  { name: "file", signature: "file(path: string | file | url): file" },
  { name: "html", signature: "html(html: string): html" },
  { name: "if", signature: "if(condition: any, trueResult: any, falseResult?: any): any" },
  { name: "image", signature: "image(path: string | file | url): image" },
  { name: "icon", signature: "icon(name: string): icon" },
  { name: "link", signature: "link(path: string | file, display?: value): link" },
  { name: "list", signature: "list(element: any): list" },
  { name: "max", signature: "max(value1: number, value2: number...): number" },
  { name: "min", signature: "min(value1: number, value2: number...): number" },
  { name: "now", signature: "now(): date" },
  { name: "number", signature: "number(input: any): number" },
  { name: "today", signature: "today(): date" },
  { name: "random", signature: "random(): number" },
  { name: "contains", receiver: "string|list", signature: "contains(value): boolean" },
  { name: "containsAll", receiver: "string|list", signature: "containsAll(...values): boolean" },
  { name: "containsAny", receiver: "string|list", signature: "containsAny(...values): boolean" },
  { name: "isEmpty", receiver: "any", signature: "isEmpty(): boolean" },
  { name: "isTruthy", receiver: "any", signature: "isTruthy(): boolean" },
  { name: "isType", receiver: "any", signature: "isType(type: string): boolean" },
  { name: "toString", receiver: "any", signature: "toString(): string" },
  { name: "format", receiver: "date", signature: "format(format: string): string" },
  { name: "relative", receiver: "date", signature: "relative(): string" },
  { name: "lower", receiver: "string", signature: "lower(): string" },
  { name: "replace", receiver: "string", signature: "replace(pattern, replacement): string" },
  { name: "split", receiver: "string", signature: "split(separator, n?: number): list" },
  { name: "map", receiver: "list", signature: "map(expression): list" },
  { name: "filter", receiver: "list", signature: "filter(expression): list" },
  { name: "reduce", receiver: "list", signature: "reduce(expression, acc): any" },
  { name: "asLink", receiver: "file", signature: "asLink(display?: string): link" },
  { name: "hasTag", receiver: "file", signature: "hasTag(...values: string): boolean" },
];

export function validateExpression(
  source: string,
  schema: FormulaLanguageSchema = {},
  context?: EvaluationContext,
): Diagnostic[] {
  const parsed = parseExpression(source);
  const diagnostics = [...parsed.diagnostics];
  if (!parsed.ast || diagnostics.some((diagnostic) => diagnostic.severity === "error")) return diagnostics;

  const inspection = inspectExpression(parsed.ast);
  const allowedNoteProperties = new Set(schema.properties?.map((property) => property.name));
  if (allowedNoteProperties.size) {
    for (const property of inspection.noteProperties) {
      if (!allowedNoteProperties.has(property)) {
        diagnostics.push({
          code: "unknown-property",
          message: `Unknown note property ${property}`,
          severity: "warning",
          span: parsed.ast.span,
        });
      }
    }
  }

  if (context) {
    const result = evaluateExpression(parsed.ast, context);
    if (result.value.type === "Error") {
      diagnostics.push({
        code: "evaluation-error",
        message: result.value.value.message,
        severity: "warning",
        span: parsed.ast.span,
      });
    }
  }
  return diagnostics;
}

export function completeExpression(
  source: string,
  position: number,
  schema: FormulaLanguageSchema = {},
): CompletionItem[] {
  const prefix = getPrefix(source, position);
  const before = source.slice(0, position);
  const receiver = before.match(/([A-Za-z_$][\w$]*)\.\w*$/)?.[1];
  const items: CompletionItem[] = [];

  if (receiver === "file" || receiver === "this") {
    items.push(...fileProperties.map(propertyToCompletion));
  } else if (receiver === "formula") {
    items.push(...(schema.formulas ?? []).map(propertyToCompletion));
  } else if (receiver === "note") {
    items.push(...(schema.properties ?? []).map(propertyToCompletion));
  } else if (receiver) {
    items.push(...builtInFunctions.filter((fn) => fn.receiver).map(functionToCompletion));
  } else {
    items.push(...["true", "false", "null", "file", "note", "formula", "this"].map((keyword) => ({
      label: keyword,
      kind: "keyword" as const,
      insertText: keyword,
    })));
    items.push(...(schema.properties ?? []).map(propertyToCompletion));
    items.push(...builtInFunctions.filter((fn) => !fn.receiver).map(functionToCompletion));
    items.push(...(schema.functions ?? []).map(functionToCompletion));
  }

  return dedupe(items)
    .filter((item) => item.label.startsWith(prefix))
    .sort((a, b) => a.label.localeCompare(b.label));
}

export function createFormulaLanguageService(schema: FormulaLanguageSchema = {}) {
  return {
    parse: parseExpression,
    validate: (source: string, context?: EvaluationContext) => validateExpression(source, schema, context),
    complete: (source: string, position: number) => completeExpression(source, position, schema),
    inspect: (source: string): ExpressionInspection => inspectExpression(source),
    evaluate: (source: string, context?: EvaluationContext) => evaluateExpression(source, context),
  };
}

function propertyToCompletion(property: PropertyCompletion): CompletionItem {
  const item: CompletionItem = {
    label: property.name,
    kind: "property",
    insertText: property.name,
  };
  const detail = property.detail ?? property.type;
  if (detail) item.detail = detail;
  return item;
}

function functionToCompletion(fn: FunctionCompletion): CompletionItem {
  return {
    label: fn.name,
    kind: "function",
    insertText: `${fn.name}()`,
    detail: fn.signature,
  };
}

function getPrefix(source: string, position: number): string {
  const match = source.slice(0, position).match(/[A-Za-z_$][\w$]*$/);
  return match?.[0] ?? "";
}

function dedupe(items: CompletionItem[]): CompletionItem[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = `${item.kind}:${item.label}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
