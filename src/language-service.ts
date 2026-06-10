import type { Diagnostic, Expression, Span } from "./ast.js";
import { evaluateExpression, type EvaluationContext } from "./evaluator.js";
import { inspectExpression, type ExpressionInspection } from "./inspect.js";
import {
  filePropertyMetadata,
  functionAppliesToReceiver,
  functionsForReceiver,
  getFileProperty,
  getGlobalFunction,
  getMethodFunction,
  globalFunctionMetadata,
  methodFunctionMetadata,
  type FormulaValueType,
  type FunctionMetadata,
  type PropertyMetadata,
} from "./metadata.js";
import { parseExpression } from "./parser.js";

export interface PropertyCompletion {
  name: string;
  type?: FormulaValueType | string;
  source?: "note" | "file" | "formula" | "this" | "object";
  detail?: string;
  documentation?: string;
}

export interface ObjectPropertyCompletion extends PropertyCompletion {
  properties?: ObjectPropertyCompletion[];
}

export interface ObjectCompletion extends ObjectPropertyCompletion {
  source?: "object";
}

export interface FunctionCompletion {
  name: string;
  receiver?: FormulaValueType | "any" | "string|list" | string;
  parameters?: string[];
  returns?: FormulaValueType | string;
  signature: string;
  detail?: string;
  documentation?: string;
}

export interface CompletionItem {
  label: string;
  kind: "property" | "function" | "keyword" | "operator";
  insertText: string;
  detail?: string;
  documentation?: string;
}

export interface FormulaLanguageSchema {
  properties?: PropertyCompletion[];
  formulas?: PropertyCompletion[];
  objects?: ObjectCompletion[];
  functions?: FunctionCompletion[];
  propertyTypes?: Record<string, FormulaValueType>;
}

export interface ExpressionDependencies {
  noteProperties: string[];
  fileProperties: string[];
  formulaProperties: string[];
  objectProperties: string[];
  functions: string[];
  hasThisReference: boolean;
}

export interface ValidationOptions {
  context?: EvaluationContext;
  runEvaluation?: boolean;
}

export interface ExpressionValidationResult {
  source: string;
  ast: Expression | null;
  diagnostics: Diagnostic[];
  dependencies: ExpressionDependencies;
  inspection: ExpressionInspection;
  valid: boolean;
}

export interface HoverInfo {
  kind: "property" | "function" | "keyword";
  span: Span;
  label: string;
  detail?: string;
  documentation?: string;
}

export interface SignatureHelp {
  name: string;
  signature: string;
  activeParameter: number;
  parameters: string[];
  span: Span;
}

export interface CodeMirrorCompletion {
  label: string;
  type: "property" | "function" | "keyword" | "operator";
  apply: string;
  detail?: string;
  info?: string;
}

export interface CodeMirrorDiagnostic {
  from: number;
  to: number;
  severity: Diagnostic["severity"];
  message: string;
  source: "obsidian-bases-expression";
}

interface Reference {
  kind: "note-property" | "file-property" | "formula-property" | "object-property" | "global-function" | "method";
  name: string;
  span: Span;
  path?: string;
  receiverType?: FormulaValueType | "any";
}

const keywords = ["true", "false", "null", "file", "note", "formula", "this"];
const localNames = new Set(["value", "index", "acc"]);

export function validateExpression(
  source: string,
  schema: FormulaLanguageSchema = {},
  context?: EvaluationContext,
): Diagnostic[] {
  const options: ValidationOptions = { runEvaluation: Boolean(context) };
  if (context) options.context = context;
  return validateExpressionDetailed(source, schema, options).diagnostics;
}

export function validateExpressionDetailed(
  source: string,
  schema: FormulaLanguageSchema = {},
  options: ValidationOptions = {},
): ExpressionValidationResult {
  const parsed = parseExpression(source);
  const diagnostics = [...parsed.diagnostics];
  const inspection = parsed.ast ? inspectExpression(parsed.ast) : inspectExpression("");
  const references = parsed.ast ? collectReferences(parsed.ast, schema) : [];
  const dependencies = dependenciesFromInspection(
    inspection,
    unique(references.filter((ref) => ref.kind === "object-property").map((ref) => ref.path ?? ref.name)),
    schema,
  );

  if (parsed.ast && !diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
    diagnostics.push(...semanticDiagnostics(references, schema));
    if (options.runEvaluation && options.context) {
      const result = evaluateExpression(parsed.ast, options.context);
      if (result.value.type === "Error") {
        diagnostics.push({
          code: "evaluation-error",
          message: result.value.value.message,
          severity: "warning",
          span: parsed.ast.span,
        });
      }
    }
  }

  return {
    source,
    ast: parsed.ast,
    diagnostics,
    dependencies,
    inspection,
    valid: !diagnostics.some((diagnostic) => diagnostic.severity === "error"),
  };
}

export function getExpressionDependencies(sourceOrAst: string | Expression): ExpressionDependencies {
  return dependenciesFromInspection(inspectExpression(sourceOrAst));
}

export function completeExpression(
  source: string,
  position: number,
  schema: FormulaLanguageSchema = {},
): CompletionItem[] {
  const prefix = getPrefix(source, position);
  const receiverExpression = getReceiverExpression(source, position);
  const items: CompletionItem[] = [];

  if (receiverExpression) {
    const receiverType = inferReceiverExpressionType(receiverExpression, schema);
    if (receiverType === "file") items.push(...filePropertyMetadata.map(propertyToCompletion));
    if (receiverType === "object" && receiverExpression === "formula") items.push(...(schema.formulas ?? []).map(propertyToCompletion));
    if (receiverType === "object" && receiverExpression === "note") items.push(...(schema.properties ?? []).map(propertyToCompletion));
    items.push(...(objectPropertiesForReceiver(receiverExpression, schema) ?? []).map(propertyToCompletion));
    if (receiverExpression === "this") items.push(propertyToCompletion({ name: "file", type: "file", source: "this" }));
    items.push(...functionsForReceiver(receiverType).map(functionToCompletion));
  } else {
    items.push(...keywords.map(keywordToCompletion));
    items.push(...(schema.properties ?? []).map(propertyToCompletion));
    items.push(...(schema.objects ?? []).map(propertyToCompletion));
    items.push(...globalFunctionMetadata.map(functionToCompletion));
    items.push(...(schema.functions ?? []).map(functionToCompletion));
  }

  return dedupe(items)
    .filter((item) => item.label.startsWith(prefix))
    .sort((a, b) => a.label.localeCompare(b.label));
}

export function getHoverInfo(source: string, position: number, schema: FormulaLanguageSchema = {}): HoverInfo | null {
  const word = wordAt(source, position);
  if (!word) return null;
  const receiverExpression = getReceiverExpression(source, word.span.start);
  if (receiverExpression) {
    const receiverType = inferReceiverExpressionType(receiverExpression, schema);
    const property = receiverType === "file" ? getFileProperty(word.text) : propertyByName(receiverType === "object" ? receiverExpression : "", word.text, schema);
    if (property) return hoverFromProperty(property, word.span);
    const method = getMethodFunction(word.text, receiverType);
    if (method) return hoverFromFunction(method, word.span);
  }

  const global = getGlobalFunction(word.text) ?? schema.functions?.find((fn) => fn.name === word.text);
  if (global) return hoverFromFunction(global, word.span);
  const property = schema.properties?.find((item) => item.name === word.text);
  if (property) return hoverFromProperty(property, word.span);
  const object = schema.objects?.find((item) => item.name === word.text);
  if (object) return hoverFromProperty(object, word.span);
  if (keywords.includes(word.text)) return { kind: "keyword", span: word.span, label: word.text };
  return null;
}

export function getSignatureHelp(source: string, position: number, schema: FormulaLanguageSchema = {}): SignatureHelp | null {
  const before = source.slice(0, position);
  const match = before.match(/([A-Za-z_$][\w$]*)\s*\([^()]*$/);
  if (!match || match.index === undefined) return null;
  const name = match[1]!;
  const fn = getGlobalFunction(name) ?? getMethodFunction(name) ?? schema.functions?.find((item) => item.name === name);
  if (!fn) return null;
  const argsText = before.slice(match.index + match[0].indexOf("(") + 1);
  return {
    name,
    signature: fn.signature,
    activeParameter: argsText.trim() ? argsText.split(",").length - 1 : 0,
    parameters: fn.parameters ?? [],
    span: { start: match.index, end: position },
  };
}

export function toCodeMirrorCompletions(items: CompletionItem[]): CodeMirrorCompletion[] {
  return items.map((item) => ({
    label: item.label,
    type: item.kind,
    apply: item.insertText,
    ...(item.detail ? { detail: item.detail } : {}),
    ...(item.documentation ? { info: item.documentation } : {}),
  }));
}

export function toCodeMirrorDiagnostics(diagnostics: Diagnostic[]): CodeMirrorDiagnostic[] {
  return diagnostics.map((diagnostic) => ({
    from: diagnostic.span.start,
    to: diagnostic.span.end,
    severity: diagnostic.severity,
    message: diagnostic.message,
    source: "obsidian-bases-expression",
  }));
}

export function createFormulaLanguageService(schema: FormulaLanguageSchema = {}) {
  return {
    parse: parseExpression,
    validate: (source: string, context?: EvaluationContext) => validateExpression(source, schema, context),
    validateDetailed: (source: string, options?: ValidationOptions) => validateExpressionDetailed(source, schema, options),
    complete: (source: string, position: number) => completeExpression(source, position, schema),
    hover: (source: string, position: number) => getHoverInfo(source, position, schema),
    signatureHelp: (source: string, position: number) => getSignatureHelp(source, position, schema),
    inspect: (source: string): ExpressionInspection => inspectExpression(source),
    dependencies: getExpressionDependencies,
    evaluate: (source: string, context?: EvaluationContext) => evaluateExpression(source, context),
  };
}

function semanticDiagnostics(refs: Reference[], schema: FormulaLanguageSchema): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const noteProperties = new Map((schema.properties ?? []).map((property) => [property.name, property]));
  const formulaProperties = new Map((schema.formulas ?? []).map((formula) => [formula.name, formula]));
  const customFunctions = new Set((schema.functions ?? []).map((fn) => fn.name));

  for (const ref of refs) {
    if (ref.kind === "note-property" && noteProperties.size && !noteProperties.has(ref.name)) {
      diagnostics.push(warning("unknown-property", `Unknown note property ${ref.name}`, ref.span));
    } else if (ref.kind === "file-property" && !getFileProperty(ref.name)) {
      diagnostics.push(warning("unknown-file-property", `Unknown file property ${ref.name}`, ref.span));
    } else if (ref.kind === "formula-property" && formulaProperties.size && !formulaProperties.has(ref.name)) {
      diagnostics.push(warning("unknown-formula", `Unknown formula ${ref.name}`, ref.span));
    } else if (ref.kind === "object-property" && ref.path && unknownObjectPath(ref.path, schema)) {
      diagnostics.push(warning("unknown-object-property", `Unknown object property ${ref.path}`, ref.span));
    } else if (ref.kind === "global-function" && !getGlobalFunction(ref.name) && !customFunctions.has(ref.name)) {
      diagnostics.push(warning("unknown-function", `Unknown function ${ref.name}`, ref.span));
    } else if (ref.kind === "method" && !getMethodFunction(ref.name, ref.receiverType)) {
      const receiver = ref.receiverType === "any" || !ref.receiverType ? "this value" : `${ref.receiverType} values`;
      diagnostics.push(warning("method-not-available", `Function ${ref.name} is not available on ${receiver}`, ref.span));
    }
  }
  return diagnostics;
}

function collectReferences(ast: Expression, schema: FormulaLanguageSchema): Reference[] {
  const refs: Reference[] = [];
  const schemaObjects = new Set((schema.objects ?? []).map((object) => object.name));
  const visit = (expr: Expression): void => {
    switch (expr.type) {
      case "Identifier":
        if (!keywords.includes(expr.name) && !localNames.has(expr.name) && !schemaObjects.has(expr.name)) {
          refs.push({ kind: "note-property", name: expr.name, span: expr.span });
        }
        break;
      case "Array":
        expr.elements.forEach(visit);
        break;
      case "Object":
        expr.properties.forEach((property) => visit(property.value));
        break;
      case "Unary":
        visit(expr.argument);
        break;
      case "Binary":
        visit(expr.left);
        visit(expr.right);
        break;
      case "Member":
        {
          const objectPath = objectPathFromExpression(expr);
          if (objectPath && schemaObjects.has(objectPath[0]!)) {
            refs.push({
              kind: "object-property",
              name: objectPath[objectPath.length - 1]!,
              path: objectPath.join("."),
              span: propertySpan(expr),
            });
          }
        }
        if (!expr.computed && typeof expr.property === "string" && expr.object.type === "Identifier") {
          if (expr.object.name === "note") refs.push({ kind: "note-property", name: expr.property, span: propertySpan(expr) });
          else if (expr.object.name === "file") refs.push({ kind: "file-property", name: expr.property, span: propertySpan(expr) });
          else if (expr.object.name === "formula") refs.push({ kind: "formula-property", name: expr.property, span: propertySpan(expr) });
        }
        visit(expr.object);
        if (expr.computed && typeof expr.property !== "string") visit(expr.property);
        break;
      case "Call":
        if (expr.callee.type === "Identifier") {
          refs.push({ kind: "global-function", name: expr.callee.name, span: expr.callee.span });
        } else if (expr.callee.type === "Member" && !expr.callee.computed && typeof expr.callee.property === "string") {
          refs.push({
            kind: "method",
            name: expr.callee.property,
            receiverType: inferExpressionType(expr.callee.object, schema),
            span: propertySpan(expr.callee),
          });
          visit(expr.callee.object);
        } else {
          visit(expr.callee);
        }
        expr.args.forEach(visit);
        break;
      case "Literal":
      case "Regex":
        break;
    }
  };
  visit(ast);
  return refs;
}

function inferReceiverExpressionType(source: string, schema: FormulaLanguageSchema): FormulaValueType | "any" {
  const parsed = parseExpression(source);
  return parsed.ast ? inferExpressionType(parsed.ast, schema) : "any";
}

function inferExpressionType(expr: Expression, schema: FormulaLanguageSchema): FormulaValueType | "any" {
  switch (expr.type) {
    case "Literal":
      return expr.value === null ? "null" : typeof expr.value === "boolean" ? "boolean" : typeof expr.value === "number" ? "number" : "string";
    case "Regex":
      return "regexp";
    case "Array":
      return "list";
    case "Object":
      return "object";
    case "Identifier":
      if (expr.name === "file") return "file";
      if (schema.objects?.some((object) => object.name === expr.name)) return "object";
      if (expr.name === "note" || expr.name === "formula" || expr.name === "this") return "object";
      return schemaTypeForProperty(expr.name, schema) ?? "any";
    case "Member": {
      if (!expr.computed && typeof expr.property === "string") {
        const objectProperty = objectPropertyForExpression(expr, schema);
        if (objectProperty) return (objectProperty.type as FormulaValueType | undefined) ?? "object";
        if (expr.object.type === "Identifier" && expr.object.name === "file") return getFileProperty(expr.property)?.type ?? "any";
        if (expr.object.type === "Identifier" && expr.object.name === "note") return schemaTypeForProperty(expr.property, schema) ?? "any";
        if (expr.object.type === "Identifier" && expr.object.name === "formula") return schema.formulas?.find((formula) => formula.name === expr.property)?.type as FormulaValueType ?? "any";
        const objectType = inferExpressionType(expr.object, schema);
        if (objectType === "list" && expr.property === "length") return "number";
        if (objectType === "string" && expr.property === "length") return "number";
        if (expr.object.type === "Member" && !expr.object.computed && expr.object.property === "file" && expr.property === "path") return "string";
        if (expr.object.type === "Identifier" && expr.object.name === "this" && expr.property === "file") return "file";
      }
      return "any";
    }
    case "Call": {
      if (expr.callee.type === "Identifier") {
        const name = expr.callee.name;
        return (getGlobalFunction(name)?.returns ?? schema.functions?.find((fn) => fn.name === name)?.returns ?? "any") as FormulaValueType | "any";
      }
      if (expr.callee.type === "Member" && !expr.callee.computed && typeof expr.callee.property === "string") {
        const receiverType = inferExpressionType(expr.callee.object, schema);
        return getMethodFunction(expr.callee.property, receiverType)?.returns ?? "any";
      }
      return "any";
    }
    case "Binary":
      if (["==", "!=", ">", "<", ">=", "<=", "&&", "||"].includes(expr.operator)) return "boolean";
      if (expr.operator === "+" && (inferExpressionType(expr.left, schema) === "string" || inferExpressionType(expr.right, schema) === "string")) return "string";
      return "number";
    case "Unary":
      return expr.operator === "!" ? "boolean" : "number";
  }
}

function schemaTypeForProperty(name: string, schema: FormulaLanguageSchema): FormulaValueType | undefined {
  return (schema.propertyTypes?.[name] ?? schema.properties?.find((property) => property.name === name)?.type) as FormulaValueType | undefined;
}

function dependenciesFromInspection(
  inspection: ExpressionInspection,
  objectProperties: string[] = [],
  schema: FormulaLanguageSchema = {},
): ExpressionDependencies {
  const objectRoots = new Set((schema.objects ?? []).map((object) => object.name));
  return {
    noteProperties: inspection.noteProperties.filter((property) => !objectRoots.has(property)),
    fileProperties: inspection.fileProperties,
    formulaProperties: inspection.formulaProperties,
    objectProperties,
    functions: inspection.functions,
    hasThisReference: inspection.hasThisReference,
  };
}

function propertyByName(receiverExpression: string, name: string, schema: FormulaLanguageSchema): PropertyCompletion | undefined {
  if (receiverExpression === "note") return schema.properties?.find((property) => property.name === name);
  if (receiverExpression === "formula") return schema.formulas?.find((property) => property.name === name);
  return objectPropertiesForReceiver(receiverExpression, schema)?.find((property) => property.name === name);
}

function objectPropertiesForReceiver(receiverExpression: string, schema: FormulaLanguageSchema): ObjectPropertyCompletion[] | undefined {
  const path = receiverExpression.split(".").filter(Boolean);
  if (!path.length) return undefined;
  if (path.length === 1) return schema.objects?.find((object) => object.name === path[0])?.properties;
  return objectPropertyByPath(path, schema)?.properties;
}

function objectPropertyForExpression(expr: Expression, schema: FormulaLanguageSchema): ObjectPropertyCompletion | undefined {
  const path = objectPathFromExpression(expr);
  return path ? objectPropertyByPath(path, schema) : undefined;
}

function objectPropertyByPath(path: string[], schema: FormulaLanguageSchema): ObjectPropertyCompletion | undefined {
  const [rootName, ...properties] = path;
  if (!rootName) return undefined;
  let current: ObjectPropertyCompletion | undefined = schema.objects?.find((object) => object.name === rootName);
  for (const property of properties) {
    current = current?.properties?.find((item) => item.name === property);
  }
  return current;
}

function unknownObjectPath(pathText: string, schema: FormulaLanguageSchema): boolean {
  const path = pathText.split(".");
  const [rootName, ...properties] = path;
  if (!rootName) return false;
  let current: ObjectPropertyCompletion | undefined = schema.objects?.find((object) => object.name === rootName);
  if (!current) return false;
  for (const property of properties) {
    const currentProperties: ObjectPropertyCompletion[] | undefined = current.properties;
    if (!currentProperties) return false;
    const next: ObjectPropertyCompletion | undefined = currentProperties.find((item) => item.name === property);
    if (!next) return true;
    current = next;
  }
  return false;
}

function objectPathFromExpression(expr: Expression): string[] | null {
  if (expr.type === "Identifier") return [expr.name];
  if (expr.type !== "Member" || expr.computed || typeof expr.property !== "string") return null;
  const parent = objectPathFromExpression(expr.object);
  return parent ? [...parent, expr.property] : null;
}

function propertyToCompletion(property: PropertyCompletion | PropertyMetadata): CompletionItem {
  const item: CompletionItem = {
    label: property.name,
    kind: "property",
    insertText: property.name,
  };
  const detail = property.detail ?? property.type;
  if (detail) item.detail = String(detail);
  if (property.documentation) item.documentation = property.documentation;
  return item;
}

function functionToCompletion(fn: FunctionCompletion | FunctionMetadata): CompletionItem {
  return {
    label: fn.name,
    kind: "function",
    insertText: `${fn.name}()`,
    detail: fn.signature,
    ...(fn.documentation ? { documentation: fn.documentation } : {}),
  };
}

function keywordToCompletion(keyword: string): CompletionItem {
  return { label: keyword, kind: "keyword", insertText: keyword };
}

function hoverFromProperty(property: PropertyCompletion | PropertyMetadata, span: Span): HoverInfo {
  const hover: HoverInfo = {
    kind: "property",
    span,
    label: property.name,
  };
  const detail = property.detail ?? property.type;
  if (detail) hover.detail = String(detail);
  if (property.documentation) hover.documentation = property.documentation;
  return hover;
}

function hoverFromFunction(fn: FunctionCompletion | FunctionMetadata, span: Span): HoverInfo {
  const hover: HoverInfo = {
    kind: "function",
    span,
    label: fn.name,
    detail: fn.signature,
  };
  if (fn.documentation) hover.documentation = fn.documentation;
  return hover;
}

function getPrefix(source: string, position: number): string {
  const match = source.slice(0, position).match(/[A-Za-z_$][\w$]*$/);
  return match?.[0] ?? "";
}

function getReceiverExpression(source: string, position: number): string | null {
  const before = source.slice(0, position);
  const match = before.match(/([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\.\w*$/);
  return match?.[1] ?? null;
}

function wordAt(source: string, position: number): { text: string; span: Span } | null {
  let start = position;
  let end = position;
  while (start > 0 && /[A-Za-z0-9_$]/.test(source[start - 1]!)) start--;
  while (end < source.length && /[A-Za-z0-9_$]/.test(source[end]!)) end++;
  if (start === end) return null;
  return { text: source.slice(start, end), span: { start, end } };
}

function propertySpan(expr: { span: Span; property: string | Expression }): Span {
  if (typeof expr.property !== "string") return expr.property.span;
  return { start: expr.span.end - expr.property.length, end: expr.span.end };
}

function warning(code: string, message: string, span: Span): Diagnostic {
  return { code, message, severity: "warning", span };
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

function unique(values: string[]): string[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

export {
  filePropertyMetadata,
  functionAppliesToReceiver,
  functionsForReceiver,
  globalFunctionMetadata,
  methodFunctionMetadata,
};
