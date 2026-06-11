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
import { tokenize, type Token } from "./lexer.js";
import { parseExpression } from "./parser.js";

export interface PropertyCompletion {
  name: string;
  type?: FormulaValueType | string;
  source?: "note" | "file" | "formula" | "this" | "object";
  detail?: string;
  documentation?: string;
  values?: PropertyValueCompletion[];
}

export interface PropertyValueCompletion {
  value: unknown;
  label?: string;
  insertText?: string;
  type?: FormulaValueType | string;
  detail?: string;
  documentation?: string;
  count?: number;
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
  kind: "property" | "function" | "keyword" | "operator" | "value";
  insertText: string;
  from?: number;
  to?: number;
  detail?: string;
  documentation?: string;
  value?: unknown;
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
  type: "property" | "function" | "keyword" | "operator" | "value";
  apply: string;
  from?: number;
  to?: number;
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
  kind: "note-property" | "file-property" | "formula-property" | "object-property" | "global-function" | "method" | "member";
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
    diagnostics.push(...typeDiagnostics(parsed.ast, schema));
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
  const context = getCompletionContext(source, position, schema);
  const items: CompletionItem[] = [];

  if (context.kind === "value") {
    if (context.property?.values?.length) {
      items.push(...completePropertyValues(context.property, {
        prefix: context.prefix,
        quoted: context.quoted,
      }));
    } else {
      items.push(...expectedTypeCompletions(context.expectedTypes, schema, context.quoted));
    }
  } else if (context.kind === "member") {
    const receiverExpression = context.receiverExpression ?? "";
    const receiverType = inferReceiverExpressionType(receiverExpression, schema);
    if (receiverType === "file") items.push(...filePropertyMetadata.map(propertyToCompletion));
    if (receiverType === "object" && receiverExpression === "formula") items.push(...(schema.formulas ?? []).map(propertyToCompletion));
    if (receiverType === "object" && receiverExpression === "note") items.push(...(schema.properties ?? []).map(propertyToCompletion));
    items.push(...(objectPropertiesForReceiver(receiverExpression, schema) ?? []).map(propertyToCompletion));
    if (receiverExpression === "this") items.push(propertyToCompletion({ name: "file", type: "file", source: "this" }));
    items.push(...functionsForReceiver(receiverType).map(functionToCompletion));
  } else if (context.kind === "none") {
    return [];
  } else {
    if (context.expectedTypes.length) {
      items.push(...expectedTypeCompletions(context.expectedTypes, schema, false));
    }
    if (!context.expectedTypes.length || context.prefix) {
      items.push(...keywords.map(keywordToCompletion));
      items.push(...(schema.properties ?? []).map(propertyToCompletion));
      items.push(...(schema.objects ?? []).map(propertyToCompletion));
      items.push(...globalFunctionMetadata.map(functionToCompletion));
      items.push(...(schema.functions ?? []).map(functionToCompletion));
    }
  }

  return withCompletionRange(dedupe(items), context.from, context.to)
    .map((item) => ({ item, score: scoreCompletion(item, context.prefix, context.expectedTypes) }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score || a.item.label.localeCompare(b.item.label))
    .map(({ item }) => item);
}

export interface PropertyValueCompletionOptions {
  prefix?: string;
  quoted?: boolean;
}

export function completePropertyValues(
  property: PropertyCompletion | undefined,
  options: PropertyValueCompletionOptions = {},
): CompletionItem[] {
  if (!property?.values?.length) return [];
  const prefix = (options.prefix ?? "").trim().toLowerCase();
  const quoted = options.quoted ?? false;
  return dedupe(property.values.map((value) => propertyValueToCompletion(value, property, quoted)))
    .map((item) => ({ item, score: scoreCompletionValue(item, prefix) }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score || a.item.label.localeCompare(b.item.label))
    .map(({ item }) => item);
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
  return items.map((item) => {
    const completion: CodeMirrorCompletion = {
      label: item.label,
      type: item.kind,
      apply: item.insertText,
    };
    if (item.from !== undefined) completion.from = item.from;
    if (item.to !== undefined) completion.to = item.to;
    if (item.detail) completion.detail = item.detail;
    if (item.documentation) completion.info = item.documentation;
    return completion;
  });
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

type CompletionContextKind = "global" | "member" | "none" | "value";

interface CompletionContextInfo {
  kind: CompletionContextKind;
  prefix: string;
  from: number;
  to: number;
  receiverExpression?: string;
  property?: PropertyCompletion;
  expectedTypes: string[];
  quoted: boolean;
}

interface ValuePrefixInfo {
  beforeValue: string;
  prefix: string;
  quoted: boolean;
  from: number;
  to: number;
}

interface ActiveCallContext {
  calleeExpression: string;
  argumentIndex: number;
}

function getCompletionContext(source: string, position: number, schema: FormulaLanguageSchema): CompletionContextInfo {
  const valuePrefix = valuePrefixBeforeCursor(source, position);
  const propertyExpression = propertyExpressionBeforeValue(valuePrefix.beforeValue);
  const property = propertyExpression ? propertyForValueExpression(propertyExpression, schema) : undefined;
  const callContext = activeCallContext(source, valuePrefix.from);
  const expectedTypes = uniqueStrings([
    ...expectedTypesForComparisonProperty(property),
    ...expectedTypesForCallArgument(callContext, schema),
  ]);

  if (property || expectedTypes.length || valuePrefix.quoted) {
    const context: CompletionContextInfo = {
      kind: "value",
      prefix: valuePrefix.prefix,
      from: valuePrefix.from,
      to: valuePrefix.to,
      expectedTypes,
      quoted: valuePrefix.quoted,
    };
    if (property) context.property = property;
    return context;
  }

  const member = memberCompletionContext(source, position);
  if (member) {
    return {
      kind: "member",
      prefix: member.prefix,
      from: member.from,
      to: position,
      receiverExpression: member.receiverExpression,
      expectedTypes: [],
      quoted: false,
    };
  }

  const identifier = identifierCompletionRange(source, position);
  if (isInvalidOpenParenCompletionContext(source, identifier.from)) {
    return {
      kind: "none",
      prefix: "",
      from: position,
      to: position,
      expectedTypes: [],
      quoted: false,
    };
  }
  return {
    kind: "global",
    prefix: identifier.prefix,
    from: identifier.from,
    to: position,
    expectedTypes: expectedTypesForCallArgument(activeCallContext(source, position), schema),
    quoted: false,
  };
}

function isInvalidOpenParenCompletionContext(source: string, position: number): boolean {
  const tokens = tokenize(source.slice(0, position)).tokens.filter((token) => token.type !== "eof");
  const openParen = tokens[tokens.length - 1];
  const previous = tokens[tokens.length - 2];
  if (openParen?.value !== "(" || !previous) return false;
  return previous.type === "string"
    || previous.type === "number"
    || previous.type === "regex"
    || [")", "]", "}"].includes(previous.value);
}

function memberCompletionContext(source: string, position: number): { receiverExpression: string; prefix: string; from: number } | null {
  const before = source.slice(0, position);
  const tokens = tokenize(before).tokens.filter((token) => token.type !== "eof");
  const last = tokens[tokens.length - 1];
  const previous = tokens[tokens.length - 2];
  let dot: Token | undefined;
  let prefix = "";
  let from = position;

  if (last?.value === ".") {
    dot = last;
  } else if (last?.type === "identifier" && previous?.value === ".") {
    dot = previous;
    prefix = before.slice(last.start, position);
    from = last.start;
  }
  if (!dot) return null;

  const receiverExpression = receiverExpressionBeforeDot(source, dot.start);
  if (!receiverExpression) return null;
  return {
    receiverExpression,
    prefix,
    from,
  };
}

function receiverExpressionBeforeDot(source: string, dotPosition: number): string | null {
  const tokens = tokenize(source.slice(0, dotPosition)).tokens.filter((token) => token.type !== "eof");
  const startIndex = expressionStartBefore(tokens, tokens.length - 1);
  if (startIndex === null) return null;
  return source.slice(tokens[startIndex]!.start, dotPosition).trim();
}

function expressionStartBefore(tokens: Token[], endIndex: number): number | null {
  if (endIndex < 0) return null;
  const token = tokens[endIndex];
  if (!token) return null;

  let start: number | null = null;
  if (token.value === ")") {
    const openIndex = matchingOpenTokenIndex(tokens, endIndex, "(", ")");
    if (openIndex === null) return null;
    start = openIndex > 0 && canEndExpression(tokens[openIndex - 1]!)
      ? expressionStartBefore(tokens, openIndex - 1)
      : openIndex;
  } else if (token.value === "]") {
    const openIndex = matchingOpenTokenIndex(tokens, endIndex, "[", "]");
    if (openIndex === null) return null;
    start = openIndex > 0 && canEndExpression(tokens[openIndex - 1]!)
      ? expressionStartBefore(tokens, openIndex - 1)
      : openIndex;
  } else if (canStartPrimaryExpression(token)) {
    start = endIndex;
  }

  if (start === null) return null;
  while (start > 1 && tokens[start - 1]?.value === ".") {
    const objectStart = expressionStartBefore(tokens, start - 2);
    if (objectStart === null) return null;
    start = objectStart;
  }
  return start;
}

function matchingOpenTokenIndex(tokens: Token[], closeIndex: number, openValue: string, closeValue: string): number | null {
  let depth = 0;
  for (let index = closeIndex; index >= 0; index -= 1) {
    const value = tokens[index]?.value;
    if (value === closeValue) depth += 1;
    else if (value === openValue) {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return null;
}

function canStartPrimaryExpression(token: Token): boolean {
  return token.type === "identifier"
    || token.type === "number"
    || token.type === "string"
    || token.type === "regex";
}

function canEndExpression(token: Token): boolean {
  return canStartPrimaryExpression(token) || [")", "]", "}"].includes(token.value);
}

function identifierCompletionRange(source: string, position: number): { prefix: string; from: number } {
  const prefix = getPrefix(source, position);
  return {
    prefix,
    from: position - prefix.length,
  };
}

function expectedTypesForComparisonProperty(property: PropertyCompletion | undefined): string[] {
  if (!property?.type || property.type === "any") return [];
  return [String(property.type)];
}

function expectedTypesForCallArgument(callContext: ActiveCallContext | null, schema: FormulaLanguageSchema): string[] {
  if (!callContext) return [];
  const fn = functionForCalleeExpression(callContext.calleeExpression, schema);
  if (!fn) return [];
  const parameter = fn.parameters?.[Math.min(callContext.argumentIndex, Math.max(0, fn.parameters.length - 1))];
  return expectedTypesFromParameter(parameter);
}

function activeCallContext(source: string, position: number): ActiveCallContext | null {
  const tokens = tokenize(source.slice(0, position)).tokens.filter((token) => token.type !== "eof");
  const stack: Array<{ token: Token; calleeExpression: string | null; argumentIndex: number }> = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]!;
    if (token.value === "(") {
      stack.push({
        token,
        calleeExpression: calleeExpressionBeforeToken(source, tokens, index),
        argumentIndex: 0,
      });
    } else if (token.value === ")") {
      stack.pop();
    } else if (token.value === "," && stack.length) {
      stack[stack.length - 1]!.argumentIndex += 1;
    }
  }
  const call = [...stack].reverse().find((item) => item.calleeExpression);
  return call && call.calleeExpression
    ? { calleeExpression: call.calleeExpression, argumentIndex: call.argumentIndex }
    : null;
}

function calleeExpressionBeforeToken(source: string, tokens: Token[], openParenIndex: number): string | null {
  const openParen = tokens[openParenIndex];
  if (!openParen) return null;
  const before = source.slice(0, openParen.start);
  return before.match(/([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\s*$/)?.[1] ?? null;
}

function functionForCalleeExpression(calleeExpression: string, schema: FormulaLanguageSchema): FunctionCompletion | FunctionMetadata | undefined {
  const parts = calleeExpression.split(".");
  const name = parts.pop();
  if (!name) return undefined;
  if (!parts.length) return getGlobalFunction(name) ?? schema.functions?.find((fn) => fn.name === name);
  const receiverExpression = parts.join(".");
  const receiverType = inferReceiverExpressionType(receiverExpression, schema);
  return getMethodFunction(name, receiverType);
}

function expectedTypesFromParameter(parameter: string | undefined): string[] {
  if (!parameter) return [];
  const typeText = parameter.split(":").slice(1).join(":").replace(/[?()[\].]/g, " ").trim();
  if (!typeText) return [];
  return uniqueStrings(typeText
    .split("|")
    .map((part) => part.replace(/\binput\b|\belement\b|\btarget\b|\bdisplay\b|\bpath\b|\bname\b|\bhtml\b|\bformat\b|\bfolder\b|\bseparator\b|\blimit\b|\bpattern\b|\breplacement\b|\bstart\b|\bend\b|\bdigits\b|\bcondition\b|\btrueResult\b|\bfalseResult\b/g, "").trim())
    .flatMap((part) => part.split(/\s+/))
    .map((part) => part.replace(/^\.\.\./, "").replace(/\[\]$/, "").trim())
    .filter((part) => Boolean(part) && part !== "optional"));
}

function expectedTypeCompletions(expectedTypes: string[], schema: FormulaLanguageSchema, quoted: boolean): CompletionItem[] {
  if (!expectedTypes.length || expectedTypes.includes("any") || expectedTypes.includes("value")) return [];
  if (quoted) return [];
  const items: CompletionItem[] = [];
  const expected = new Set(expectedTypes);
  if (expected.has("boolean")) {
    items.push(keywordToCompletion("true"), keywordToCompletion("false"));
  }
  const properties = [
    ...(schema.properties ?? []),
    ...(schema.formulas ?? []).map((formula) => ({ ...formula, name: `formula.${formula.name}` })),
  ];
  items.push(...properties
    .filter((property) => property.type && expected.has(String(property.type)))
    .map(propertyToCompletion));
  items.push(...globalFunctionMetadata
    .filter((fn) => expected.has(fn.returns))
    .map(functionToCompletion));
  items.push(...(schema.functions ?? [])
    .filter((fn) => fn.returns && expected.has(String(fn.returns)))
    .map(functionToCompletion));
  return items;
}

function withCompletionRange(items: CompletionItem[], from: number, to: number): CompletionItem[] {
  return items.map((item) => ({ ...item, from, to }));
}

function scoreCompletion(item: CompletionItem, prefix: string, expectedTypes: string[]): number {
  const normalizedPrefix = prefix.toLowerCase();
  const label = item.label.toLowerCase();
  const insertText = item.insertText.toLowerCase();
  let score = expectedTypes.length ? 10 : 1;
  if (!normalizedPrefix) return score;
  if (label === normalizedPrefix || insertText === normalizedPrefix) score += 1000;
  else if (label.startsWith(normalizedPrefix) || insertText.startsWith(normalizedPrefix)) score += 800;
  else if (label.includes(normalizedPrefix) || insertText.includes(normalizedPrefix)) score += 300;
  else return 0;
  if (item.kind === "value") score += 200;
  return score;
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
      diagnostics.push(warning("unknown-file-property", nativeMemberDiagnostic(ref.name, "file"), ref.span));
    } else if (ref.kind === "formula-property" && formulaProperties.size && !formulaProperties.has(ref.name)) {
      diagnostics.push(warning("unknown-formula", `Unknown formula ${ref.name}`, ref.span));
    } else if (ref.kind === "object-property" && ref.path && unknownObjectPath(ref.path, schema)) {
      diagnostics.push(warning("unknown-object-property", `Unknown object property ${ref.path}`, ref.span));
    } else if (ref.kind === "global-function" && !getGlobalFunction(ref.name) && !customFunctions.has(ref.name)) {
      diagnostics.push(warning("unknown-function", `Cannot find function "${ref.name}"`, ref.span));
    } else if (ref.kind === "method" && !getMethodFunction(ref.name, ref.receiverType)) {
      diagnostics.push(warning("method-not-available", nativeMethodDiagnostic(ref.name, ref.receiverType), ref.span));
    } else if (ref.kind === "member" && !memberIsAvailable(ref.receiverType, ref.name)) {
      diagnostics.push(warning("method-not-available", nativeMemberDiagnostic(ref.name, ref.receiverType), ref.span));
    }
  }
  return diagnostics;
}

function nativeMethodDiagnostic(name: string, receiverType: FormulaValueType | "any" | undefined): string {
  const type = nativeRuntimeTypeName(receiverType);
  return type ? `Cannot find function "${name}" on type ${type}` : `Cannot find function "${name}"`;
}

function nativeMemberDiagnostic(name: string, receiverType: FormulaValueType | "any" | undefined): string {
  const type = nativeRuntimeTypeName(receiverType);
  return type ? `Cannot find "${name}" on type ${type}` : `Cannot find "${name}"`;
}

function nativeRuntimeTypeName(type: FormulaValueType | "any" | undefined): string | null {
  switch (type) {
    case "null":
      return "Null";
    case "boolean":
      return "Boolean";
    case "number":
      return "Number";
    case "string":
      return "String";
    case "date":
      return "Date";
    case "duration":
      return "Duration";
    case "list":
      return "List";
    case "object":
      return "Object";
    case "file":
      return "File";
    case "link":
      return "Link";
    case "regexp":
      return "RegExp";
    case "html":
      return "HTML";
    case "image":
      return "Image";
    case "icon":
      return "Icon";
    case "error":
      return "Error";
    default:
      return null;
  }
}

function shouldValidateMember(expr: Extract<Expression, { type: "Member" }>, schema: FormulaLanguageSchema): boolean {
  if (expr.computed || typeof expr.property !== "string") return false;
  if (expr.object.type === "Identifier" && ["note", "file", "formula"].includes(expr.object.name)) return false;
  const objectPath = objectPathFromExpression(expr);
  if (objectPath && schema.objects?.some((object) => object.name === objectPath[0])) return false;
  const receiverType = inferExpressionType(expr.object, schema);
  return receiverType !== "any" && receiverType !== "object" && receiverType !== "error";
}

function memberIsAvailable(receiverType: FormulaValueType | "any" | undefined, name: string): boolean {
  if (!receiverType || receiverType === "any" || receiverType === "object") return true;
  if (getMethodFunction(name, receiverType)) return true;
  switch (receiverType) {
    case "string":
    case "list":
      return name === "length";
    case "date":
      return ["year", "month", "day", "hour", "minute", "second", "millisecond"].includes(name);
    case "file":
      return Boolean(getFileProperty(name));
    default:
      return false;
  }
}

function typeDiagnostics(ast: Expression, schema: FormulaLanguageSchema): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const visit = (expr: Expression): void => {
    switch (expr.type) {
      case "Binary":
        diagnostics.push(...binaryTypeDiagnostics(expr, schema));
        visit(expr.left);
        visit(expr.right);
        break;
      case "Call":
        diagnostics.push(...callTypeDiagnostics(expr, schema));
        visit(expr.callee);
        expr.args.forEach(visit);
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
      case "Member":
        visit(expr.object);
        if (expr.computed && typeof expr.property !== "string") visit(expr.property);
        break;
      case "Identifier":
      case "Literal":
      case "Regex":
        break;
    }
  };
  visit(ast);
  return diagnostics;
}

function binaryTypeDiagnostics(expr: Extract<Expression, { type: "Binary" }>, schema: FormulaLanguageSchema): Diagnostic[] {
  if (!["==", "!=", ">", "<", ">=", "<="].includes(expr.operator)) return [];
  const leftType = inferExpressionType(expr.left, schema);
  const rightType = inferExpressionType(expr.right, schema);
  return [
    comparisonTypeDiagnostic(leftType, expr.right),
    comparisonTypeDiagnostic(rightType, expr.left),
  ].filter((diagnostic): diagnostic is Diagnostic => Boolean(diagnostic));
}

function callTypeDiagnostics(expr: Extract<Expression, { type: "Call" }>, schema: FormulaLanguageSchema): Diagnostic[] {
  const fn = functionForCallExpression(expr, schema);
  if (!fn) return [];
  const diagnostics: Diagnostic[] = [];
  expr.args.forEach((arg, index) => {
    const parameter = fn.parameters?.[Math.min(index, Math.max(0, fn.parameters.length - 1))];
    const expectedTypes = expectedTypesFromParameter(parameter);
    const diagnostic = argumentTypeDiagnostic(expectedTypes, arg, schema);
    if (diagnostic) diagnostics.push(diagnostic);
  });
  return diagnostics;
}

function functionForCallExpression(expr: Extract<Expression, { type: "Call" }>, schema: FormulaLanguageSchema): FunctionCompletion | FunctionMetadata | undefined {
  if (expr.callee.type === "Identifier") {
    const name = expr.callee.name;
    return getGlobalFunction(name) ?? schema.functions?.find((fn) => fn.name === name);
  }
  if (expr.callee.type === "Member" && !expr.callee.computed && typeof expr.callee.property === "string") {
    const receiverType = inferExpressionType(expr.callee.object, schema);
    return getMethodFunction(expr.callee.property, receiverType);
  }
  return undefined;
}

function comparisonTypeDiagnostic(expectedType: FormulaValueType | "any", actual: Expression): Diagnostic | null {
  if (expectedType === "any" || expectedType === "null" || expectedType === "error") return null;
  if (literalMatchesExpectedType(actual, [expectedType])) return null;
  if (actual.type !== "Literal" && actual.type !== "Regex") return null;
  return warning(
    "type-mismatch",
    `Expected ${expectedType} value, got ${literalTypeName(actual)}`,
    actual.span,
  );
}

function argumentTypeDiagnostic(expectedTypes: string[], actual: Expression, schema: FormulaLanguageSchema): Diagnostic | null {
  if (!expectedTypes.length || expectedTypes.includes("any") || expectedTypes.includes("value")) return null;
  if (literalMatchesExpectedType(actual, expectedTypes)) return null;
  if (actual.type !== "Literal" && actual.type !== "Regex") {
    const actualType = inferExpressionType(actual, schema);
    if (actualType === "any" || expectedTypes.includes(actualType)) return null;
    return null;
  }
  return warning(
    "type-mismatch",
    `Expected ${formatExpectedTypes(expectedTypes)} value, got ${literalTypeName(actual)}`,
    actual.span,
  );
}

function literalMatchesExpectedType(expr: Expression, expectedTypes: readonly string[]): boolean {
  if (expectedTypes.includes("any") || expectedTypes.includes("value")) return true;
  if (expr.type === "Regex") return expectedTypes.includes("regexp");
  if (expr.type !== "Literal") return true;
  const actualType = expr.value === null ? "null" : typeof expr.value === "boolean" ? "boolean" : typeof expr.value === "number" ? "number" : "string";
  if (expectedTypes.includes(actualType)) {
    if (expectedTypes.includes("date") && actualType === "string") return isDateLiteral(String(expr.value));
    if (expectedTypes.includes("duration") && actualType === "string") return String(expr.value).trim().length > 0;
    return true;
  }
  if (actualType === "string" && expectedTypes.includes("number")) return Number.isFinite(Number(expr.value));
  if (actualType === "string" && expectedTypes.includes("boolean")) return ["true", "false"].includes(String(expr.value).toLowerCase());
  if (actualType === "string" && expectedTypes.includes("date")) return isDateLiteral(String(expr.value));
  return false;
}

function literalTypeName(expr: Expression): string {
  if (expr.type === "Regex") return "regexp";
  if (expr.type !== "Literal") return "expression";
  return expr.value === null ? "null" : typeof expr.value;
}

function formatExpectedTypes(expectedTypes: string[]): string {
  return expectedTypes.join(" or ");
}

function isDateLiteral(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}(?:[T ][0-2]\d:[0-5]\d(?::[0-5]\d)?)?$/.test(value);
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
        if (shouldValidateMember(expr, schema)) {
          refs.push({
            kind: "member",
            name: expr.property as string,
            receiverType: inferExpressionType(expr.object, schema),
            span: propertySpan(expr),
          });
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

function propertyValueToCompletion(
  value: PropertyValueCompletion,
  property: PropertyCompletion,
  quoted: boolean,
): CompletionItem {
  const label = value.label ?? valueLabel(value.value);
  const item: CompletionItem = {
    label,
    kind: "value",
    insertText: value.insertText ?? valueInsertText(value.value, value.type ?? property.type, quoted),
    value: value.value,
  };
  const detailParts = [
    value.detail ?? value.type ?? property.type,
    value.count ? `${value.count} match${value.count === 1 ? "" : "es"}` : "",
  ].filter((part): part is string => Boolean(part));
  if (detailParts.length) item.detail = detailParts.join(" · ");
  if (value.documentation) item.documentation = value.documentation;
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

function valuePrefixBeforeCursor(source: string, position: number): ValuePrefixInfo {
  const before = source.slice(0, position);
  const quoteIndex = lastOpenQuoteIndex(before);
  if (quoteIndex >= 0) {
    return {
      beforeValue: before.slice(0, quoteIndex),
      prefix: before.slice(quoteIndex + 1),
      quoted: true,
      from: quoteIndex + 1,
      to: position,
    };
  }

  const match = before.match(/[^\s,)\]}]*$/);
  const prefix = match?.[0] ?? "";
  return {
    beforeValue: before.slice(0, before.length - prefix.length),
    prefix,
    quoted: false,
    from: position - prefix.length,
    to: position,
  };
}

function propertyExpressionBeforeValue(beforeValue: string): string | null {
  const propertyPattern = String.raw`([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*|note\[(?:"[^"]+"|'[^']+')\])`;
  const comparison = beforeValue.match(new RegExp(`${propertyPattern}\\s*(?:==|!=|>=|<=|>|<)\\s*$`));
  if (comparison) return comparison[1] ?? null;
  const method = beforeValue.match(new RegExp(`${propertyPattern}\\.(?:contains|startsWith|endsWith|hasTag|hasLink|linksTo)\\(\\s*$`));
  return method?.[1] ?? null;
}

function propertyForValueExpression(expression: string, schema: FormulaLanguageSchema): PropertyCompletion | undefined {
  const bracketProperty = expression.match(/^note\[(["'])(.*)\1\]$/);
  if (bracketProperty) return schema.properties?.find((property) => property.name === bracketProperty[2]);
  if (expression.startsWith("note.")) return schema.properties?.find((property) => property.name === expression.slice("note.".length));
  if (expression.startsWith("formula.")) return schema.formulas?.find((property) => property.name === expression.slice("formula.".length));
  const path = expression.split(".");
  if (path.length > 1) return objectPropertyByPath(path, schema);
  return schema.properties?.find((property) => property.name === expression);
}

function lastOpenQuoteIndex(source: string): number {
  let quote: string | null = null;
  let quoteIndex = -1;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index]!;
    if ((char === "\"" || char === "'") && !isEscaped(source, index)) {
      if (quote === char) {
        quote = null;
        quoteIndex = -1;
      } else if (!quote) {
        quote = char;
        quoteIndex = index;
      }
    }
  }
  return quoteIndex;
}

function isEscaped(source: string, index: number): boolean {
  let slashCount = 0;
  for (let cursor = index - 1; cursor >= 0 && source[cursor] === "\\"; cursor -= 1) slashCount += 1;
  return slashCount % 2 === 1;
}

function scoreCompletionValue(item: CompletionItem, prefix: string): number {
  const label = item.label.toLowerCase();
  const detail = item.detail?.toLowerCase() ?? "";
  if (!prefix) return Number(item.detail?.match(/(\d+) match/)?.[1] ?? 1);
  if (label === prefix) return 1000;
  if (label.startsWith(prefix)) return 800;
  if (label.includes(prefix)) return 400;
  if (detail.includes(prefix)) return 100;
  return 0;
}

function valueLabel(value: unknown): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

function valueInsertText(value: unknown, type: FormulaValueType | string | undefined, quoted: boolean): string {
  if (quoted) return valueLabel(value);
  if (value === null || value === undefined) return "null";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (Array.isArray(value)) return `[${value.map((item) => valueInsertText(item, undefined, false)).join(", ")}]`;
  const text = valueLabel(value);
  if (type === "number") {
    const numberValue = Number(text);
    return Number.isFinite(numberValue) ? String(numberValue) : "null";
  }
  if (type === "boolean") {
    const normalized = text.toLowerCase();
    if (normalized === "true" || normalized === "false") return normalized;
  }
  return JSON.stringify(text);
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
  return memberCompletionContext(source, position)?.receiverExpression ?? null;
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

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

export {
  filePropertyMetadata,
  functionAppliesToReceiver,
  functionsForReceiver,
  globalFunctionMetadata,
  methodFunctionMetadata,
};
