import type { Diagnostic, Expression } from "./ast.js";
import { createContextFromRow, createEvaluationContext, type BasesRowLike, type EvaluationContextInput } from "./context.js";
import { evaluateExpression, Evaluator, type EvaluationContext, type EvaluationResult } from "./evaluator.js";
import { getExpressionDependencies, type ExpressionDependencies } from "./language-service.js";
import { parseExpression } from "./parser.js";
import { errorValue, stringifyValue, toPlain, type RuntimeValue } from "./value.js";

export interface EvaluateOutputOptions {
  throwOnError?: boolean;
}

export interface CompiledExpression {
  source: string | null;
  ast: Expression | null;
  diagnostics: Diagnostic[];
  dependencies: ExpressionDependencies;
  valid: boolean;
  evaluate(context?: EvaluationContext, options?: EvaluateOutputOptions): EvaluationResult;
  evaluateValue(context?: EvaluationContext, options?: EvaluateOutputOptions): RuntimeValue;
  evaluateToPlain(context?: EvaluationContext, options?: EvaluateOutputOptions): unknown;
  evaluateToString(context?: EvaluationContext, options?: EvaluateOutputOptions): string;
}

export interface BatchEvaluationResult {
  index: number;
  context: EvaluationContext;
  value: RuntimeValue;
  plain: unknown;
  diagnostics: Diagnostic[];
}

export interface BatchEvaluationOptions extends EvaluateOutputOptions {
  baseContext?: EvaluationContextInput;
}

export interface CompiledFormulaSet {
  formulas: Record<string, Expression | null>;
  diagnostics: Diagnostic[];
  dependencies: Record<string, ExpressionDependencies>;
  evaluationOrder: string[];
  evaluate(context?: EvaluationContext, options?: EvaluateOutputOptions): Record<string, RuntimeValue>;
  evaluateToPlain(context?: EvaluationContext, options?: EvaluateOutputOptions): Record<string, unknown>;
}

export class ExpressionError extends Error {
  readonly diagnostics: Diagnostic[];
  readonly value?: RuntimeValue;

  constructor(message: string, diagnostics: Diagnostic[] = [], value?: RuntimeValue) {
    super(message);
    this.name = "ExpressionError";
    this.diagnostics = diagnostics;
    if (value) this.value = value;
  }
}

export function evaluateToPlain(sourceOrAst: string | Expression, context: EvaluationContext = {}, options: EvaluateOutputOptions = {}): unknown {
  const result = evaluateExpression(sourceOrAst, context);
  assertEvaluationOk(result, options);
  return toPlain(result.value);
}

export function evaluateToString(sourceOrAst: string | Expression, context: EvaluationContext = {}, options: EvaluateOutputOptions = {}): string {
  const result = evaluateExpression(sourceOrAst, context);
  assertEvaluationOk(result, options);
  return stringifyValue(result.value);
}

export function compileExpression(sourceOrAst: string | Expression): CompiledExpression {
  const parsed = typeof sourceOrAst === "string" ? parseExpression(sourceOrAst) : { ast: sourceOrAst, diagnostics: [] as Diagnostic[] };
  const source = typeof sourceOrAst === "string" ? sourceOrAst : null;
  const dependencies = parsed.ast ? getExpressionDependencies(parsed.ast) : emptyDependencies();
  const valid = Boolean(parsed.ast) && !parsed.diagnostics.some((diagnostic) => diagnostic.severity === "error");

  const evaluate = (context: EvaluationContext = {}, options: EvaluateOutputOptions = {}): EvaluationResult => {
    if (!parsed.ast || parsed.diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
      const value = errorValue(parsed.diagnostics[0]?.message ?? "Invalid expression");
      const result = { value, ast: parsed.ast, diagnostics: parsed.diagnostics };
      assertEvaluationOk(result, options);
      return result;
    }
    const evaluator = new Evaluator(context);
    const result = { value: evaluator.eval(parsed.ast), ast: parsed.ast, diagnostics: parsed.diagnostics };
    assertEvaluationOk(result, options);
    return result;
  };

  return {
    source,
    ast: parsed.ast,
    diagnostics: parsed.diagnostics,
    dependencies,
    valid,
    evaluate,
    evaluateValue: (context, options) => evaluate(context, options).value,
    evaluateToPlain: (context, options) => toPlain(evaluate(context, options).value),
    evaluateToString: (context, options) => stringifyValue(evaluate(context, options).value),
  };
}

export function evaluateBatch(
  expression: string | Expression | CompiledExpression,
  rows: Array<EvaluationContext | EvaluationContextInput | BasesRowLike>,
  options: BatchEvaluationOptions = {},
): BatchEvaluationResult[] {
  const compiled = isCompiledExpression(expression) ? expression : compileExpression(expression);
  return rows.map((row, index) => {
    const context = contextFromBatchRow(row, options.baseContext);
    const result = compiled.evaluate(context, options);
    return {
      index,
      context,
      value: result.value,
      plain: toPlain(result.value),
      diagnostics: result.diagnostics,
    };
  });
}

export function compileFormulaSet(formulas: Record<string, string | Expression>): CompiledFormulaSet {
  const compiled: Record<string, Expression | null> = {};
  const dependencies: Record<string, ExpressionDependencies> = {};
  const diagnostics: Diagnostic[] = [];

  for (const [name, formula] of Object.entries(formulas)) {
    const parsed = typeof formula === "string" ? parseExpression(formula) : { ast: formula, diagnostics: [] as Diagnostic[] };
    compiled[name] = parsed.ast;
    dependencies[name] = parsed.ast ? getExpressionDependencies(parsed.ast) : emptyDependencies();
    diagnostics.push(...parsed.diagnostics.map((diagnostic) => ({ ...diagnostic, message: `${name}: ${diagnostic.message}` })));
  }

  diagnostics.push(...cycleDiagnostics(dependencies));
  const evaluationOrder = sortFormulas(dependencies);

  const evaluate = (context: EvaluationContext = {}, options: EvaluateOutputOptions = {}): Record<string, RuntimeValue> => {
    const formulaAsts = Object.fromEntries(Object.entries(compiled).filter((entry): entry is [string, Expression] => Boolean(entry[1])));
    const evaluator = new Evaluator({ ...context, formulas: formulaAsts });
    const values: Record<string, RuntimeValue> = {};
    for (const name of evaluationOrder) {
      const ast = compiled[name];
      values[name] = ast ? evaluator.eval(ast) : errorValue(`Invalid formula ${name}`);
      assertRuntimeValueOk(values[name], diagnostics, options);
    }
    return values;
  };

  return {
    formulas: compiled,
    diagnostics,
    dependencies,
    evaluationOrder,
    evaluate,
    evaluateToPlain: (context, options) => Object.fromEntries(Object.entries(evaluate(context, options)).map(([key, value]) => [key, toPlain(value)])),
  };
}

function contextFromBatchRow(row: EvaluationContext | EvaluationContextInput | BasesRowLike, baseContext: EvaluationContextInput = {}): EvaluationContext {
  if (looksLikeEvaluationContext(row)) return createEvaluationContext({ ...baseContext, ...(row as EvaluationContextInput) });
  return createContextFromRow(row as BasesRowLike, baseContext);
}

function looksLikeEvaluationContext(row: EvaluationContext | EvaluationContextInput | BasesRowLike): boolean {
  return "note" in row || "propertyTypes" in row || "files" in row || "linkResolutions" in row || "functions" in row || "formulas" in row;
}

function isCompiledExpression(value: unknown): value is CompiledExpression {
  return Boolean(value && typeof value === "object" && "evaluate" in value && "dependencies" in value);
}

function assertEvaluationOk(result: EvaluationResult, options: EvaluateOutputOptions): void {
  if (result.diagnostics.some((diagnostic) => diagnostic.severity === "error") && options.throwOnError) {
    throw new ExpressionError(result.diagnostics[0]?.message ?? "Invalid expression", result.diagnostics, result.value);
  }
  assertRuntimeValueOk(result.value, result.diagnostics, options);
}

function assertRuntimeValueOk(value: RuntimeValue, diagnostics: Diagnostic[], options: EvaluateOutputOptions): void {
  if (value.type === "Error" && options.throwOnError) {
    throw new ExpressionError(value.value.message, diagnostics, value);
  }
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

function sortFormulas(dependencies: Record<string, ExpressionDependencies>): string[] {
  const names = Object.keys(dependencies);
  const known = new Set(names);
  const visited = new Set<string>();
  const visiting = new Set<string>();
  const order: string[] = [];

  const visit = (name: string): void => {
    if (visited.has(name) || visiting.has(name)) return;
    visiting.add(name);
    for (const dep of dependencies[name]?.formulaProperties ?? []) {
      if (known.has(dep)) visit(dep);
    }
    visiting.delete(name);
    visited.add(name);
    order.push(name);
  };

  names.forEach(visit);
  return order;
}

function cycleDiagnostics(dependencies: Record<string, ExpressionDependencies>): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const names = new Set(Object.keys(dependencies));
  const visiting = new Set<string>();
  const visited = new Set<string>();

  const visit = (name: string, path: string[]): void => {
    if (visiting.has(name)) {
      diagnostics.push({
        code: "circular-formula",
        message: `Circular formula reference ${[...path, name].join(" -> ")}`,
        severity: "warning",
        span: { start: 0, end: 0 },
      });
      return;
    }
    if (visited.has(name)) return;
    visiting.add(name);
    for (const dep of dependencies[name]?.formulaProperties ?? []) {
      if (names.has(dep)) visit(dep, [...path, name]);
    }
    visiting.delete(name);
    visited.add(name);
  };

  for (const name of names) visit(name, []);
  return diagnostics;
}
