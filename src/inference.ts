import type { Diagnostic, Expression, Span } from "./ast.js";
import type { FilterExpression, LogicalFilter } from "./filter.js";
import { parseExpression } from "./parser.js";

export interface InferredConstraint {
  kind: "property-equals" | "property-truthy" | "tag";
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

export function inferDefaultsFromExpression(sourceOrAst: string | Expression): InferredDefaults {
  const source = typeof sourceOrAst === "string" ? sourceOrAst : undefined;
  const parsed = typeof sourceOrAst === "string" ? parseExpression(sourceOrAst) : { ast: sourceOrAst, diagnostics: [] as Diagnostic[] };
  const result = emptyInference(parsed.diagnostics);
  if (!parsed.ast || parsed.diagnostics.some((diagnostic) => diagnostic.severity === "error")) return result;
  inferExpression(parsed.ast, result, source);
  return result;
}

export function inferDefaultsFromFilter(filter: FilterExpression): InferredDefaults {
  const result = emptyInference();
  inferFilter(filter, result);
  return result;
}

function inferFilter(filter: FilterExpression, result: InferredDefaults): void {
  if (filter === null || filter === undefined) return;
  if (typeof filter === "string" || isAstExpression(filter)) {
    mergeInference(result, inferDefaultsFromExpression(filter));
    return;
  }
  if (!isLogicalFilter(filter)) {
    addUnsupported(result, "Unsupported filter shape", "filter", { start: 0, end: 0 });
    return;
  }
  if (filter.and !== undefined) {
    for (const child of normalizeFilters(filter.and)) inferFilter(child, result);
  }
  if (filter.or !== undefined) {
    addUnsupported(result, "Cannot infer defaults from an or branch without choosing a branch", "or", { start: 0, end: 0 });
  }
  if (filter.not !== undefined) {
    addUnsupported(result, "Cannot infer defaults from a negated filter", "not", { start: 0, end: 0 });
  }
}

function inferExpression(expr: Expression, result: InferredDefaults, source?: string): void {
  switch (expr.type) {
    case "Binary":
      if (expr.operator === "&&") {
        inferExpression(expr.left, result, source);
        inferExpression(expr.right, result, source);
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

function propertyReference(expr: Expression): string | null {
  if (expr.type === "Identifier") return isReservedIdentifier(expr.name) ? null : expr.name;
  if (expr.type !== "Member" || typeof expr.property !== "string" || expr.computed) return null;
  if (expr.object.type === "Identifier" && expr.object.name === "note") return expr.property;
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
    if (Object.prototype.hasOwnProperty.call(target.properties, property) && !sameValue(target.properties[property], value)) {
      addUnsupported(target, `Conflicting inferred defaults for ${property}`, property, { start: 0, end: 0 });
    } else {
      target.properties[property] = value;
    }
  }
  for (const tag of source.tags) {
    if (!target.tags.includes(tag)) target.tags.push(tag);
  }
  target.constraints.push(...source.constraints);
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
