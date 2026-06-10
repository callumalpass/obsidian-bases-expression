import type { Diagnostic, Expression } from "./ast.js";
import { compileExpression, ExpressionError, type CompiledExpression, type EvaluateOutputOptions } from "./compile.js";
import type { EvaluationContext } from "./evaluator.js";
import { boolValue, errorValue, isTruthy, type RuntimeValue } from "./value.js";
import type { ExpressionDependencies } from "./language-service.js";

export interface LogicalFilter {
  and?: FilterExpression | FilterExpression[];
  or?: FilterExpression | FilterExpression[];
  not?: FilterExpression | FilterExpression[];
}

export type FilterExpression = string | Expression | LogicalFilter | null | undefined;

export interface FilterEvaluationResult {
  value: RuntimeValue;
  matches: boolean;
  diagnostics: Diagnostic[];
}

export interface CompiledFilter {
  source: FilterExpression;
  diagnostics: Diagnostic[];
  dependencies: ExpressionDependencies;
  valid: boolean;
  evaluate(context?: EvaluationContext, options?: EvaluateOutputOptions): FilterEvaluationResult;
  evaluateToBoolean(context?: EvaluationContext, options?: EvaluateOutputOptions): boolean;
}

type CompiledFilterNode =
  | { kind: "all" }
  | { kind: "invalid"; diagnostic: Diagnostic }
  | { kind: "expression"; expression: CompiledExpression }
  | { kind: "and"; children: CompiledFilterNode[] }
  | { kind: "or"; children: CompiledFilterNode[] }
  | { kind: "not"; child: CompiledFilterNode };

export function compileFilter(filter: FilterExpression): CompiledFilter {
  const node = compileFilterNode(filter);
  const diagnostics = collectDiagnostics(node);
  const dependencies = collectDependencies(node);
  const valid = !diagnostics.some((diagnostic) => diagnostic.severity === "error");

  const evaluate = (context: EvaluationContext = {}, options: EvaluateOutputOptions = {}): FilterEvaluationResult => {
    const result = evaluateNode(node, context);
    if (result.value.type === "Error" && options.throwOnError) {
      throw new ExpressionError(result.value.value.message, result.diagnostics, result.value);
    }
    if (result.diagnostics.some((diagnostic) => diagnostic.severity === "error") && options.throwOnError) {
      throw new ExpressionError(result.diagnostics[0]?.message ?? "Invalid filter", result.diagnostics, result.value);
    }
    return result;
  };

  return {
    source: filter,
    diagnostics,
    dependencies,
    valid,
    evaluate,
    evaluateToBoolean: (context, options) => evaluate(context, options).matches,
  };
}

export function evaluateFilter(
  filter: FilterExpression,
  context: EvaluationContext = {},
  options: EvaluateOutputOptions = {},
): FilterEvaluationResult {
  return compileFilter(filter).evaluate(context, options);
}

function compileFilterNode(filter: FilterExpression): CompiledFilterNode {
  if (filter === null || filter === undefined) return { kind: "all" };
  if (typeof filter === "string" || isAstExpression(filter)) return { kind: "expression", expression: compileExpression(filter) };
  if (!isLogicalFilter(filter)) {
    return invalidFilter("Unsupported filter shape");
  }
  const keys = ["and", "or", "not"].filter((key) => Object.prototype.hasOwnProperty.call(filter, key));
  if (keys.length > 1) return invalidFilter("Filter object must contain exactly one of: and, or, not");
  if (filter.and !== undefined) return { kind: "and", children: normalizeFilters(filter.and).map(compileFilterNode) };
  if (filter.or !== undefined) return { kind: "or", children: normalizeFilters(filter.or).map(compileFilterNode) };
  if (filter.not !== undefined) return { kind: "not", child: compileFilterNode({ and: normalizeFilters(filter.not) }) };
  return { kind: "all" };
}

function evaluateNode(node: CompiledFilterNode, context: EvaluationContext): FilterEvaluationResult {
  switch (node.kind) {
    case "all":
      return { value: boolValue(true), matches: true, diagnostics: [] };
    case "invalid":
      return { value: errorValue(node.diagnostic.message), matches: false, diagnostics: [node.diagnostic] };
    case "expression": {
      const result = node.expression.evaluate(context);
      const matches = result.value.type !== "Error" && isTruthy(result.value);
      return { value: result.value, matches, diagnostics: result.diagnostics };
    }
    case "and": {
      const diagnostics: Diagnostic[] = [];
      for (const child of node.children) {
        const result = evaluateNode(child, context);
        diagnostics.push(...result.diagnostics);
        if (!result.matches) return { value: boolValue(false), matches: false, diagnostics };
      }
      return { value: boolValue(true), matches: true, diagnostics };
    }
    case "or": {
      const diagnostics: Diagnostic[] = [];
      for (const child of node.children) {
        const result = evaluateNode(child, context);
        diagnostics.push(...result.diagnostics);
        if (result.matches) return { value: boolValue(true), matches: true, diagnostics };
      }
      return { value: boolValue(false), matches: false, diagnostics };
    }
    case "not": {
      const result = evaluateNode(node.child, context);
      const matches = !result.matches;
      return { value: boolValue(matches), matches, diagnostics: result.diagnostics };
    }
  }
}

function collectDiagnostics(node: CompiledFilterNode): Diagnostic[] {
  switch (node.kind) {
    case "all":
      return [];
    case "invalid":
      return [node.diagnostic];
    case "expression":
      return node.expression.diagnostics;
    case "and":
    case "or":
      return node.children.flatMap(collectDiagnostics);
    case "not":
      return collectDiagnostics(node.child);
  }
}

function collectDependencies(node: CompiledFilterNode): ExpressionDependencies {
  switch (node.kind) {
    case "all":
    case "invalid":
      return emptyDependencies();
    case "expression":
      return node.expression.dependencies;
    case "and":
    case "or":
      return mergeDependencies(node.children.map(collectDependencies));
    case "not":
      return collectDependencies(node.child);
  }
}

function mergeDependencies(items: ExpressionDependencies[]): ExpressionDependencies {
  return {
    noteProperties: unique(items.flatMap((item) => item.noteProperties)),
    fileProperties: unique(items.flatMap((item) => item.fileProperties)),
    formulaProperties: unique(items.flatMap((item) => item.formulaProperties)),
    objectProperties: unique(items.flatMap((item) => item.objectProperties)),
    functions: unique(items.flatMap((item) => item.functions)),
    hasThisReference: items.some((item) => item.hasThisReference),
  };
}

function emptyDependencies(): ExpressionDependencies {
  return {
    noteProperties: [],
    fileProperties: [],
    formulaProperties: [],
    objectProperties: [],
    functions: [],
    hasThisReference: false,
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

function invalidFilter(message: string): CompiledFilterNode {
  return {
    kind: "invalid",
    diagnostic: {
      code: "invalid-filter",
      message,
      severity: "error",
      span: { start: 0, end: 0 },
    },
  };
}

function unique(values: string[]): string[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}
