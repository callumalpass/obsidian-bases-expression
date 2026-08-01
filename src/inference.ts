import type { CallExpression, Diagnostic, Expression, MemberExpression, Span } from "./ast.js";
import { adaptObsidianFilterConfig } from "./filter-adapter.js";
import type { FilterExpression, LogicalFilter } from "./filter.js";
import type { FormulaValueType } from "./metadata.js";
import { parseExpression } from "./parser.js";

export interface InferredConstraint {
  kind: "property-equals" | "property-truthy" | "property-contains" | "tag";
  source: string;
  property?: string;
  value?: unknown;
  tag?: string;
}

export interface UnsupportedConstraint {
  source: string;
  reason: string;
  span: Span;
}

export interface InferredDefaults {
  properties: Record<string, unknown>;
  tags: string[];
  constraints: InferredConstraint[];
  unsupported: UnsupportedConstraint[];
  diagnostics: Diagnostic[];
}

export interface DefaultInferenceOptions {
  /**
   * Concrete value to store when a positive filter requires
   * `this.file.asLink()`. Omit this when the host cannot resolve the current
   * file to a note-property value.
   */
  thisFileLink?: unknown;
  /**
   * Known note-property types. Direct `property.contains(value)` inference is
   * only safe for properties declared as `string` or `list`. An explicit
   * `list(property).contains(value)` does not require this metadata.
   */
  propertyTypes?: Readonly<Record<string, FormulaValueType | undefined>>;
}

type ContainmentKind = "list" | "string";

interface ContainmentReceiver {
  property: string;
  kind: ContainmentKind;
  requiresStringValue?: boolean;
}

interface ResolvedInferenceValue {
  resolved: boolean;
  value?: unknown;
}

type MethodCallExpression = CallExpression & { callee: MemberExpression };

export function inferDefaultsFromExpression(
  sourceOrAst: string | Expression,
  options: DefaultInferenceOptions = {},
): InferredDefaults {
  const source = typeof sourceOrAst === "string" ? sourceOrAst : undefined;
  const parsed = typeof sourceOrAst === "string" ? parseExpression(sourceOrAst) : { ast: sourceOrAst, diagnostics: [] as Diagnostic[] };
  const result = emptyInference(parsed.diagnostics);
  if (!parsed.ast || parsed.diagnostics.some((diagnostic) => diagnostic.severity === "error")) return result;
  inferExpression(parsed.ast, result, options, source);
  return result;
}

export function inferDefaultsFromFilter(filter: FilterExpression, options: DefaultInferenceOptions = {}): InferredDefaults {
  const result = emptyInference();
  inferFilter(filter, result, options);
  return result;
}

export function inferDefaultsFromObsidianFilterConfig(
  config: unknown,
  options: DefaultInferenceOptions = {},
): InferredDefaults {
  const adapted = adaptObsidianFilterConfig(config);
  const result = inferDefaultsFromFilter(adapted.filter, options);
  result.diagnostics.unshift(...adapted.diagnostics);
  return result;
}

function inferFilter(filter: FilterExpression, result: InferredDefaults, options: DefaultInferenceOptions): void {
  if (filter === null || filter === undefined) return;
  if (typeof filter === "string" || isAstExpression(filter)) {
    mergeInference(result, inferDefaultsFromExpression(filter, options));
    return;
  }
  if (!isLogicalFilter(filter)) {
    addUnsupported(result, "Unsupported filter shape", "filter", { start: 0, end: 0 });
    return;
  }
  if (filter.and !== undefined) {
    for (const child of normalizeFilters(filter.and)) inferFilter(child, result, options);
  }
  if (filter.or !== undefined) {
    addUnsupported(result, "Cannot infer defaults from an or branch without choosing a branch", "or", { start: 0, end: 0 });
  }
  if (filter.not !== undefined) {
    addUnsupported(result, "Cannot infer defaults from a negated filter", "not", { start: 0, end: 0 });
  }
}

function inferExpression(
  expr: Expression,
  result: InferredDefaults,
  options: DefaultInferenceOptions,
  source?: string,
): void {
  switch (expr.type) {
    case "Binary":
      if (expr.operator === "&&") {
        if (inferGeneratedCurrentFileRelationship(expr.left, expr.right, result, options, source)) return;
        inferExpression(expr.left, result, options, source);
        inferExpression(expr.right, result, options, source);
        return;
      }
      if (expr.operator === "==") {
        if (inferEquality(expr.left, expr.right, result, source) || inferEquality(expr.right, expr.left, result, source)) return;
      }
      addUnsupported(result, `Cannot infer defaults for ${expr.operator} expressions`, sourceText(expr, source), expr.span);
      return;
    case "Identifier": {
      const property = propertyReference(expr);
      if (property) assignProperty(result, property, true, sourceText(expr, source), "property-truthy");
      else addUnsupported(result, "Cannot infer defaults for this identifier", sourceText(expr, source), expr.span);
      return;
    }
    case "Member": {
      const property = propertyReference(expr);
      if (property) assignProperty(result, property, true, sourceText(expr, source), "property-truthy");
      else addUnsupported(result, "Cannot infer defaults for this member expression", sourceText(expr, source), expr.span);
      return;
    }
    case "Call":
      if (inferTagCall(expr, result, source)) return;
      if (inferContainsCall(expr, result, options, source)) return;
      addUnsupported(result, "Cannot infer defaults for this function call", sourceText(expr, source), expr.span);
      return;
    case "Unary":
      addUnsupported(result, "Cannot infer defaults from a negated or numeric unary expression", sourceText(expr, source), expr.span);
      return;
    case "Array":
    case "Object":
    case "Literal":
    case "Regex":
      addUnsupported(result, "Expression is not a note-creation constraint", sourceText(expr, source), expr.span);
      return;
  }
}

function inferGeneratedCurrentFileRelationship(
  guard: Expression,
  containment: Expression,
  result: InferredDefaults,
  options: DefaultInferenceOptions,
  source?: string,
): boolean {
  if (!isFileHasLinkThisFileCall(guard) || !isContainsCallWithThisFileLink(containment)) return false;
  const receiver = containmentReceiver(containment.callee.object, options);
  if (!receiver) return false;
  inferContainsCall(containment, result, options, source);
  return true;
}

function inferEquality(left: Expression, right: Expression, result: InferredDefaults, source?: string): boolean {
  const property = propertyReference(left);
  const value = literalValue(right);
  if (!property || value === undefined) return false;
  assignProperty(result, property, value, sourceText(left, source), "property-equals");
  return true;
}

function inferTagCall(expr: Expression, result: InferredDefaults, source?: string): boolean {
  if (expr.type !== "Call") return false;
  if (expr.callee.type !== "Member" || expr.callee.computed || expr.callee.property !== "hasTag") return false;
  if (expr.callee.object.type !== "Identifier" || expr.callee.object.name !== "file") return false;
  let inferred = false;
  for (const arg of expr.args) {
    const value = literalValue(arg);
    if (typeof value !== "string") continue;
    const tag = normalizeTag(value);
    if (!result.tags.includes(tag)) result.tags.push(tag);
    result.constraints.push({ kind: "tag", source: sourceText(expr, source), tag });
    inferred = true;
  }
  return inferred;
}

function inferContainsCall(
  expr: Expression,
  result: InferredDefaults,
  options: DefaultInferenceOptions,
  source?: string,
): boolean {
  if (!isMethodCall(expr, "contains") || expr.args.length !== 1) return false;
  const [containedValue] = expr.args;
  if (!containedValue) return false;

  const property = collectionProperty(expr.callee.object);
  if (!property) return false;

  const receiver = containmentReceiver(expr.callee.object, options);
  if (!receiver) {
    addUnsupported(
      result,
      `Cannot infer defaults from ${property}.contains() without a known string or list property type`,
      sourceText(expr, source),
      expr.span,
    );
    return true;
  }

  const resolved = resolveInferenceValue(containedValue, options);
  if (!resolved.resolved) {
    const reason = isThisFileAsLinkCall(containedValue)
      ? "Cannot infer a current-file default without options.thisFileLink"
      : "Cannot infer defaults from a non-literal contains() value";
    addUnsupported(result, reason, sourceText(expr, source), containedValue.span);
    return true;
  }

  if ((receiver.kind === "string" || receiver.requiresStringValue) && typeof resolved.value !== "string") {
    addUnsupported(
      result,
      `Cannot infer a string-backed default for ${receiver.property} from a non-string contains() value`,
      sourceText(expr, source),
      containedValue.span,
    );
    return true;
  }

  assignContainedProperty(result, receiver, resolved.value, sourceText(expr, source));
  return true;
}

function containmentReceiver(expr: Expression, options: DefaultInferenceOptions): ContainmentReceiver | null {
  const explicitListProperty = listPropertyReference(expr);
  if (explicitListProperty) return { property: explicitListProperty, kind: "list" };

  const mappedProperty = safeMappedListPropertyReference(expr);
  if (mappedProperty) return { property: mappedProperty, kind: "list", requiresStringValue: true };

  const property = propertyReference(expr);
  if (!property) return null;
  const propertyType = options.propertyTypes?.[property];
  if (propertyType === "list" || propertyType === "string") return { property, kind: propertyType };
  return null;
}

function collectionProperty(expr: Expression): string | null {
  return listPropertyReference(expr) ?? safeMappedListPropertyReference(expr) ?? propertyReference(expr);
}

function listPropertyReference(expr: Expression): string | null {
  if (!isGlobalCall(expr, "list") || expr.args.length !== 1) return null;
  const [argument] = expr.args;
  return argument ? propertyReference(argument) : null;
}

function safeMappedListPropertyReference(expr: Expression): string | null {
  if (!isMethodCall(expr, "map") || expr.args.length !== 1) return null;
  const [mapExpression] = expr.args;
  if (!mapExpression) return null;
  const property = listPropertyReference(expr.callee.object);
  if (!property || !isLinkPreservingMapExpression(mapExpression)) return null;
  return property;
}

function isLinkPreservingMapExpression(expr: Expression): boolean {
  if (!isMethodCall(expr, "asLink") || expr.args.length !== 0) return false;
  const fileCall = expr.callee.object;
  if (!isGlobalCall(fileCall, "file") || fileCall.args.length !== 1) return false;
  const [input] = fileCall.args;
  if (!input) return false;
  return isIdentifier(input, "value") || isMarkdownLinkNormalization(input) || isDependencyLinkNormalization(input);
}

function isMarkdownLinkNormalization(expr: Expression): boolean {
  if (!isMethodCall(expr, "replace") || expr.args.length !== 2) return false;
  const [percentPattern, spaceReplacement] = expr.args;
  if (!percentPattern || !spaceReplacement) return false;
  if (!isRegex(percentPattern, "%20", "g") || !isLiteral(spaceReplacement, " ")) return false;

  const markdownReplace = expr.callee.object;
  if (!isMethodCall(markdownReplace, "replace") || markdownReplace.args.length !== 2) return false;
  const [markdownPattern, pathReplacement] = markdownReplace.args;
  if (!markdownPattern || !pathReplacement) return false;
  return (
    isIdentifier(markdownReplace.callee.object, "value") &&
    isRegex(markdownPattern, "^\\[[^\\]]+\\]\\((.*)\\)$", "") &&
    isLiteral(pathReplacement, "$1")
  );
}

function isDependencyLinkNormalization(expr: Expression): boolean {
  if (!isGlobalCall(expr, "if") || expr.args.length !== 3) return false;
  const [condition, objectValue, fallback] = expr.args;
  if (!condition || !objectValue || !fallback) return false;
  if (!isMethodCall(condition, "isType") || condition.args.length !== 1) return false;
  const [typeName] = condition.args;
  if (!typeName) return false;
  return (
    isIdentifier(condition.callee.object, "value") &&
    isLiteral(typeName, "object") &&
    isMember(objectValue, "uid", "value") &&
    isIdentifier(fallback, "value")
  );
}

function resolveInferenceValue(expr: Expression, options: DefaultInferenceOptions): ResolvedInferenceValue {
  if (expr.type === "Literal") return { resolved: true, value: expr.value };
  if (isThisFileAsLinkCall(expr) && options.thisFileLink !== undefined && options.thisFileLink !== null) {
    return { resolved: true, value: options.thisFileLink };
  }
  return { resolved: false };
}

function isContainsCallWithThisFileLink(expr: Expression): expr is MethodCallExpression {
  if (!isMethodCall(expr, "contains") || expr.args.length !== 1) return false;
  const [argument] = expr.args;
  return Boolean(argument && isThisFileAsLinkCall(argument));
}

function isFileHasLinkThisFileCall(expr: Expression): boolean {
  if (!isMethodCall(expr, "hasLink") || expr.args.length !== 1) return false;
  const [argument] = expr.args;
  return Boolean(argument && isIdentifier(expr.callee.object, "file") && isMember(argument, "file", "this"));
}

function isThisFileAsLinkCall(expr: Expression): boolean {
  return (
    isMethodCall(expr, "asLink") &&
    expr.args.length === 0 &&
    isMember(expr.callee.object, "file", "this")
  );
}

function isGlobalCall(expr: Expression, name: string): expr is CallExpression {
  return expr.type === "Call" && isIdentifier(expr.callee, name);
}

function isMethodCall(expr: Expression, name: string): expr is MethodCallExpression {
  return (
    expr.type === "Call" &&
    expr.callee.type === "Member" &&
    !expr.callee.computed &&
    expr.callee.property === name
  );
}

function isIdentifier(expr: Expression, name: string): boolean {
  return expr.type === "Identifier" && expr.name === name;
}

function isMember(expr: Expression, property: string, objectName: string): boolean {
  return (
    expr.type === "Member" &&
    !expr.computed &&
    expr.property === property &&
    isIdentifier(expr.object, objectName)
  );
}

function isRegex(expr: Expression, pattern: string, flags: string): boolean {
  return expr.type === "Regex" && expr.pattern === pattern && expr.flags === flags;
}

function isLiteral(expr: Expression, value: unknown): boolean {
  return expr.type === "Literal" && sameValue(expr.value, value);
}

function assignProperty(
  result: InferredDefaults,
  property: string,
  value: unknown,
  source: string,
  kind: "property-equals" | "property-truthy",
): void {
  if (Object.prototype.hasOwnProperty.call(result.properties, property) && !sameValue(result.properties[property], value)) {
    addUnsupported(result, `Conflicting inferred defaults for ${property}`, source, { start: 0, end: 0 });
    return;
  }
  result.properties[property] = value;
  const constraint: InferredConstraint = { kind, source, property };
  if (kind === "property-equals") constraint.value = value;
  result.constraints.push(constraint);
}

function assignContainedProperty(
  result: InferredDefaults,
  receiver: ContainmentReceiver,
  value: unknown,
  source: string,
): void {
  const existing = result.properties[receiver.property];
  if (existing === undefined) {
    result.properties[receiver.property] = receiver.kind === "list" ? [value] : value;
  } else if (receiver.kind === "list" && Array.isArray(existing)) {
    if (!existing.some((item) => sameValue(item, value))) result.properties[receiver.property] = [...existing, value];
  } else if (receiver.kind === "string" && typeof existing === "string" && typeof value === "string") {
    if (!existing.includes(value)) {
      addUnsupported(result, `Conflicting inferred defaults for ${receiver.property}`, source, { start: 0, end: 0 });
      return;
    }
  } else {
    addUnsupported(result, `Conflicting inferred defaults for ${receiver.property}`, source, { start: 0, end: 0 });
    return;
  }

  result.constraints.push({
    kind: "property-contains",
    source,
    property: receiver.property,
    value,
  });
}

function propertyReference(expr: Expression): string | null {
  if (expr.type === "Identifier") return isReservedIdentifier(expr.name) ? null : expr.name;
  if (expr.type !== "Member" || !isIdentifier(expr.object, "note")) return null;
  if (!expr.computed && typeof expr.property === "string") return expr.property;
  if (expr.computed && typeof expr.property !== "string" && expr.property.type === "Literal") {
    return typeof expr.property.value === "string" ? expr.property.value : null;
  }
  return null;
}

function literalValue(expr: Expression): unknown {
  if (expr.type === "Literal") return expr.value;
  return undefined;
}

function mergeInference(target: InferredDefaults, source: InferredDefaults): void {
  target.diagnostics.push(...source.diagnostics);
  target.unsupported.push(...source.unsupported);
  for (const [property, value] of Object.entries(source.properties)) {
    if (!Object.prototype.hasOwnProperty.call(target.properties, property)) {
      target.properties[property] = value;
    } else if (sameValue(target.properties[property], value)) {
      continue;
    } else if (canMergeContainedLists(target, source, property, value)) {
      const existing = target.properties[property] as unknown[];
      const incoming = value as unknown[];
      target.properties[property] = [
        ...existing,
        ...incoming.filter((item) => !existing.some((existingItem) => sameValue(existingItem, item))),
      ];
    } else {
      addUnsupported(target, `Conflicting inferred defaults for ${property}`, property, { start: 0, end: 0 });
    }
  }
  for (const tag of source.tags) {
    if (!target.tags.includes(tag)) target.tags.push(tag);
  }
  target.constraints.push(...source.constraints);
}

function canMergeContainedLists(
  target: InferredDefaults,
  source: InferredDefaults,
  property: string,
  sourceValue: unknown,
): boolean {
  if (!Array.isArray(target.properties[property]) || !Array.isArray(sourceValue)) return false;
  const targetConstraints = target.constraints.filter((constraint) => constraint.property === property);
  const sourceConstraints = source.constraints.filter((constraint) => constraint.property === property);
  return (
    targetConstraints.length > 0 &&
    sourceConstraints.length > 0 &&
    targetConstraints.every((constraint) => constraint.kind === "property-contains") &&
    sourceConstraints.every((constraint) => constraint.kind === "property-contains")
  );
}

function emptyInference(diagnostics: Diagnostic[] = []): InferredDefaults {
  return {
    properties: {},
    tags: [],
    constraints: [],
    unsupported: [],
    diagnostics,
  };
}

function normalizeFilters(value: FilterExpression | FilterExpression[]): FilterExpression[] {
  return Array.isArray(value) ? value : [value];
}

function isLogicalFilter(value: unknown): value is LogicalFilter {
  return Boolean(value && typeof value === "object" && !isAstExpression(value));
}

function isAstExpression(value: unknown): value is Expression {
  return Boolean(value && typeof value === "object" && typeof (value as { type?: unknown }).type === "string");
}

function isReservedIdentifier(name: string): boolean {
  return ["true", "false", "null", "file", "note", "formula", "this", "values"].includes(name);
}

function normalizeTag(tag: string): string {
  return tag.replace(/^#/, "");
}

function sourceText(expr: Expression, source?: string): string {
  return source ? source.slice(expr.span.start, expr.span.end) : expr.type;
}

function addUnsupported(result: InferredDefaults, reason: string, source: string, span: Span): void {
  result.unsupported.push({ reason, source, span });
}

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
