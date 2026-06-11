import type { BinaryExpression, CallExpression, Diagnostic, Expression, LiteralExpression, MemberExpression, UnaryExpression } from "./ast.js";
import type { FilterExpression, LogicalFilter } from "./filter.js";
import type { EvaluationContext } from "./evaluator.js";
import {
  filePropertyMetadata,
  type FormulaValueType,
} from "./metadata.js";
import {
  validateExpressionDetailed,
  type ExpressionDependencies,
  type ExpressionValidationResult,
  type FormulaLanguageSchema,
  type ObjectPropertyCompletion,
  type PropertyCompletion,
  type PropertyValueCompletion,
  type ValidationOptions,
} from "./language-service.js";
import { parseExpression } from "./parser.js";

export type BuilderConjunction = "and" | "or" | "not";
export type BuilderNodeKind = "group" | "condition" | "expression";
export type BuilderValueSource = "literal" | "expression";
export type BuilderOperatorValueKind = "none" | "any" | "text" | "number" | "boolean" | "date" | "datetime" | "duration" | "regexp";
export type BuilderOperatorId =
  | "is"
  | "is-not"
  | "contains"
  | "not-contains"
  | "starts-with"
  | "ends-with"
  | "greater-than"
  | "greater-than-or-equal"
  | "less-than"
  | "less-than-or-equal"
  | "is-empty"
  | "is-not-empty"
  | "is-true"
  | "is-false"
  | "has-tag"
  | "not-has-tag"
  | "links-to"
  | "not-links-to"
  | "matches";

export interface BuilderProperty {
  id: string;
  label: string;
  type: FormulaValueType | string;
  source: "note" | "file" | "formula" | "object" | "this";
  detail?: string;
  documentation?: string;
  values?: PropertyValueCompletion[];
}

export interface BuilderOperator {
  id: BuilderOperatorId;
  label: string;
  valueKind: BuilderOperatorValueKind;
  types?: Array<FormulaValueType | "string|list">;
  documentation?: string;
}

export interface BuilderCondition {
  kind: "condition";
  property: string;
  operator: BuilderOperatorId;
  value?: unknown;
  valueSource?: BuilderValueSource;
}

export interface BuilderExpression {
  kind: "expression";
  source: string;
}

export interface BuilderGroup {
  kind: "group";
  conjunction: BuilderConjunction;
  children: BuilderNode[];
}

export type BuilderNode = BuilderGroup | BuilderCondition | BuilderExpression;

export interface BuilderSerializationOptions {
  parenthesize?: boolean;
  schema?: FormulaLanguageSchema;
}

export interface BuilderValidationIssue {
  code: string;
  message: string;
  severity: Diagnostic["severity"];
  node: BuilderNode;
}

export interface BuilderValidationResult {
  source: string;
  filter: FilterExpression;
  diagnostics: Diagnostic[];
  issues: BuilderValidationIssue[];
  dependencies: ExpressionDependencies;
  expression: ExpressionValidationResult;
  valid: boolean;
}

export interface BuilderParseResult {
  node: BuilderNode;
  mode: "simple" | "advanced";
  diagnostics: Diagnostic[];
}

export interface BuilderSchemaOptions {
  includeFileProperties?: boolean;
  includeFormulaProperties?: boolean;
  includeObjectProperties?: boolean;
}

const reservedRoots = new Set(["file", "note", "formula", "this"]);
const reservedIdentifiers = new Set(["true", "false", "null", "file", "note", "formula", "this", "value", "index", "acc"]);

export const builderOperators: BuilderOperator[] = [
  { id: "is", label: "is", valueKind: "any" },
  { id: "is-not", label: "is not", valueKind: "any" },
  { id: "contains", label: "contains", valueKind: "any", types: ["string|list"] },
  { id: "not-contains", label: "does not contain", valueKind: "any", types: ["string|list"] },
  { id: "starts-with", label: "starts with", valueKind: "text", types: ["string"] },
  { id: "ends-with", label: "ends with", valueKind: "text", types: ["string"] },
  { id: "greater-than", label: "is greater than", valueKind: "any", types: ["number", "date", "duration"] },
  { id: "greater-than-or-equal", label: "is at least", valueKind: "any", types: ["number", "date", "duration"] },
  { id: "less-than", label: "is less than", valueKind: "any", types: ["number", "date", "duration"] },
  { id: "less-than-or-equal", label: "is at most", valueKind: "any", types: ["number", "date", "duration"] },
  { id: "is-empty", label: "is empty", valueKind: "none" },
  { id: "is-not-empty", label: "is not empty", valueKind: "none" },
  { id: "is-true", label: "is true", valueKind: "none", types: ["boolean"] },
  { id: "is-false", label: "is false", valueKind: "none", types: ["boolean"] },
  { id: "has-tag", label: "has tag", valueKind: "text", types: ["file", "list"] },
  { id: "not-has-tag", label: "does not have tag", valueKind: "text", types: ["file", "list"] },
  { id: "links-to", label: "links to", valueKind: "text", types: ["file", "link"] },
  { id: "not-links-to", label: "does not link to", valueKind: "text", types: ["file", "link"] },
  { id: "matches", label: "matches", valueKind: "regexp", types: ["string"] },
];

export function createBuilderGroup(
  children: BuilderNode[] = [],
  conjunction: BuilderConjunction = "and",
): BuilderGroup {
  return {
    kind: "group",
    conjunction,
    children,
  };
}

export function createBuilderCondition(property = "", operator: BuilderOperatorId = "is", value: unknown = ""): BuilderCondition {
  return {
    kind: "condition",
    property,
    operator,
    value,
    valueSource: "literal",
  };
}

export function createBuilderExpression(source = ""): BuilderExpression {
  return {
    kind: "expression",
    source,
  };
}

export function createDefaultBuilderNode(schema: FormulaLanguageSchema = {}): BuilderGroup {
  const property = getBuilderProperties(schema)[0]?.id ?? "file.name";
  return createBuilderGroup([createBuilderCondition(property, "is-not-empty")]);
}

export function getBuilderOperator(id: BuilderOperatorId): BuilderOperator | undefined {
  return builderOperators.find((operator) => operator.id === id);
}

export function getBuilderOperatorsForType(type: FormulaValueType | string | undefined): BuilderOperator[] {
  if (!type || type === "any") return builderOperators;
  return builderOperators.filter((operator) => {
    if (!operator.types) return true;
    return operator.types.some((candidate) => candidate === type || (candidate === "string|list" && (type === "string" || type === "list")));
  });
}

export function getBuilderProperties(
  schema: FormulaLanguageSchema = {},
  options: BuilderSchemaOptions = {},
): BuilderProperty[] {
  const includeFileProperties = options.includeFileProperties ?? true;
  const includeFormulaProperties = options.includeFormulaProperties ?? true;
  const includeObjectProperties = options.includeObjectProperties ?? true;
  const properties: BuilderProperty[] = [];

  for (const property of schema.properties ?? []) {
    properties.push(builderPropertyFromCompletion(property, "note", property.name));
  }

  if (includeFileProperties) {
    properties.push({
      id: "file",
      label: "file",
      type: "file",
      source: "file",
      documentation: "The current file.",
    });
    for (const property of filePropertyMetadata) {
      properties.push({
        id: `file.${property.name}`,
        label: `file ${property.name}`,
        type: property.type,
        source: "file",
        ...(property.detail ? { detail: property.detail } : {}),
        ...(property.documentation ? { documentation: property.documentation } : {}),
      });
    }
  }

  if (includeFormulaProperties) {
    for (const formula of schema.formulas ?? []) {
      properties.push(builderPropertyFromCompletion(formula, "formula", `formula.${formula.name}`));
    }
  }

  if (includeObjectProperties) {
    for (const object of schema.objects ?? []) {
      properties.push(...flattenObjectProperties(object));
    }
  }

  return dedupeBuilderProperties(properties).sort((a, b) => a.label.localeCompare(b.label));
}

export function findBuilderProperty(schema: FormulaLanguageSchema, propertyId: string): BuilderProperty | undefined {
  return getBuilderProperties(schema).find((property) => property.id === propertyId);
}

export function serializeBuilderNode(node: BuilderNode, options: BuilderSerializationOptions = {}): string {
  switch (node.kind) {
    case "condition":
      return serializeBuilderCondition(node, options.schema);
    case "expression":
      return node.source.trim();
    case "group":
      return serializeBuilderGroup(node, options);
  }
}

export function builderNodeToFilterExpression(node: BuilderNode, schema: FormulaLanguageSchema = {}): FilterExpression {
  switch (node.kind) {
    case "condition":
      return serializeBuilderCondition(node, schema);
    case "expression":
      return node.source.trim();
    case "group":
      return groupToLogicalFilter(node, schema);
  }
}

export function validateBuilderNode(
  node: BuilderNode,
  schema: FormulaLanguageSchema = {},
  options: ValidationOptions = {},
): BuilderValidationResult {
  const source = serializeBuilderNode(node, { schema });
  const expression = validateExpressionDetailed(source || "true", schema, options);
  const issues = collectBuilderIssues(node, schema);
  const diagnostics = [...expression.diagnostics];
  const valid = issues.every((issue) => issue.severity !== "error") && expression.valid;
  return {
    source,
    filter: builderNodeToFilterExpression(node, schema),
    diagnostics,
    issues,
    dependencies: expression.dependencies,
    expression,
    valid,
  };
}

export function parseBuilderNode(source: string, schema: FormulaLanguageSchema = {}): BuilderParseResult {
  const parsed = parseExpression(source);
  if (!parsed.ast || parsed.diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
    return {
      node: createBuilderExpression(source),
      mode: "advanced",
      diagnostics: parsed.diagnostics,
    };
  }
  const simple = expressionToBuilderNode(parsed.ast, source, schema);
  if (simple) {
    return {
      node: simple,
      mode: "simple",
      diagnostics: parsed.diagnostics,
    };
  }
  return {
    node: createBuilderExpression(source),
    mode: "advanced",
    diagnostics: parsed.diagnostics,
  };
}

export function formatExpressionLiteral(
  value: unknown,
  type: FormulaValueType | string | undefined = "any",
  valueSource: BuilderValueSource = "literal",
): string {
  if (valueSource === "expression") return String(value ?? "").trim() || "null";
  if (value === null || value === undefined || value === "") return type === "string" || type === "text" ? "\"\"" : "null";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (Array.isArray(value)) return `[${value.map((item) => formatExpressionLiteral(item, "any")).join(", ")}]`;
  const text = String(value);
  if (type === "number") {
    const numberValue = Number(text);
    return Number.isFinite(numberValue) ? String(numberValue) : "null";
  }
  if (type === "boolean") {
    const normalized = text.trim().toLowerCase();
    if (normalized === "true") return "true";
    if (normalized === "false") return "false";
  }
  if (type === "date" || type === "datetime") return `date(${quoteString(text)})`;
  if (type === "duration") return `duration(${quoteString(text)})`;
  if (type === "regexp") return regexpLiteral(text);
  return quoteString(text);
}

export function propertyIdToExpression(propertyId: string): string {
  const trimmed = propertyId.trim();
  if (!trimmed) return "";
  const [root, ...rest] = trimmed.split(".");
  if (root && reservedRoots.has(root)) {
    if (rest.length === 0) return root;
    return rest.reduce((current, part) => `${current}${propertyAccess(part)}`, root);
  }
  if (isIdentifier(trimmed) && !reservedIdentifiers.has(trimmed)) return trimmed;
  return `note${propertyAccess(trimmed)}`;
}

export function expressionToPropertyId(expr: Expression): string | null {
  if (expr.type === "Identifier") return expr.name;
  if (expr.type !== "Member") return null;
  const parent = expressionToPropertyId(expr.object);
  if (!parent) return null;
  if (!expr.computed && typeof expr.property === "string") return `${parent}.${expr.property}`;
  if (expr.computed && typeof expr.property !== "string" && expr.property.type === "Literal" && typeof expr.property.value === "string") {
    return `${parent}.${expr.property.value}`;
  }
  return null;
}

export function evaluateBuilderNode(
  node: BuilderNode,
  schema: FormulaLanguageSchema,
  context: EvaluationContext,
): BuilderValidationResult {
  return validateBuilderNode(node, schema, { context, runEvaluation: true });
}

function serializeBuilderGroup(group: BuilderGroup, options: BuilderSerializationOptions): string {
  const childOptions: BuilderSerializationOptions = { parenthesize: true };
  if (options.schema) childOptions.schema = options.schema;
  const children = group.children
    .map((child) => serializeBuilderNode(child, childOptions).trim())
    .filter((source) => source.length > 0);
  if (!children.length) return "true";
  const conjunction = group.conjunction === "or" ? " || " : " && ";
  const joined = children.map((child) => `(${child})`).join(conjunction);
  const source = group.conjunction === "not" ? `!(${joined})` : joined;
  return options.parenthesize ? `(${source})` : source;
}

function serializeBuilderCondition(condition: BuilderCondition, schema: FormulaLanguageSchema = {}): string {
  const left = propertyIdToExpression(condition.property);
  const operator = getBuilderOperator(condition.operator);
  if (!left || !operator) return "";
  const literalType = literalTypeForCondition(condition, operator, schema);
  const value = formatExpressionLiteral(condition.value, literalType, condition.valueSource);
  switch (condition.operator) {
    case "is":
      return `${left} == ${value}`;
    case "is-not":
      return `${left} != ${value}`;
    case "contains":
      return `${left}.contains(${value})`;
    case "not-contains":
      return `!${left}.contains(${value})`;
    case "starts-with":
      return `${left}.startsWith(${value})`;
    case "ends-with":
      return `${left}.endsWith(${value})`;
    case "greater-than":
      return `${left} > ${value}`;
    case "greater-than-or-equal":
      return `${left} >= ${value}`;
    case "less-than":
      return `${left} < ${value}`;
    case "less-than-or-equal":
      return `${left} <= ${value}`;
    case "is-empty":
      return `${left}.isEmpty()`;
    case "is-not-empty":
      return `!${left}.isEmpty()`;
    case "is-true":
      return `${left} == true`;
    case "is-false":
      return `${left} == false`;
    case "has-tag":
      return left === "file" ? `file.hasTag(${value})` : `${left}.contains(${value})`;
    case "not-has-tag":
      return left === "file" ? `!file.hasTag(${value})` : `!${left}.contains(${value})`;
    case "links-to":
      return left === "file" ? `file.hasLink(${value})` : `${left}.linksTo(${value})`;
    case "not-links-to":
      return left === "file" ? `!file.hasLink(${value})` : `!${left}.linksTo(${value})`;
    case "matches":
      return `${value}.matches(${left})`;
  }
}

function groupToLogicalFilter(group: BuilderGroup, schema: FormulaLanguageSchema): LogicalFilter {
  const children = group.children.map((child) => builderNodeToFilterExpression(child, schema)).filter((child): child is Exclude<FilterExpression, null | undefined> => child !== null && child !== undefined);
  if (group.conjunction === "or") return { or: children };
  if (group.conjunction === "not") return { not: children };
  return { and: children };
}

function literalTypeForCondition(condition: BuilderCondition, operator: BuilderOperator, schema: FormulaLanguageSchema): FormulaValueType | string {
  const propertyType = findBuilderProperty(schema, condition.property)?.type;
  if (operator.valueKind === "regexp") return "regexp";
  if (operator.valueKind === "date" || operator.valueKind === "datetime" || operator.valueKind === "duration" || operator.valueKind === "number" || operator.valueKind === "boolean") {
    return operator.valueKind;
  }
  if (operator.valueKind === "text") return "string";
  if (propertyType && propertyType !== "any") return propertyType;
  return condition.valueSource === "expression" ? "any" : "string";
}

function expressionToBuilderNode(expr: Expression, source: string, schema: FormulaLanguageSchema): BuilderNode | null {
  if (expr.type === "Binary") return binaryToCondition(expr, source, schema);
  if (expr.type === "Unary") return unaryToCondition(expr, source, schema);
  if (expr.type === "Call") return callToCondition(expr, source, schema);
  return null;
}

function binaryToCondition(expr: BinaryExpression, source: string, schema: FormulaLanguageSchema): BuilderCondition | null {
  const operator = binaryOperatorToBuilderOperator(expr.operator);
  if (!operator) return null;
  const leftProperty = expressionToPropertyId(expr.left);
  const rightValue = expressionLiteralValue(expr.right, source);
  if (leftProperty && rightValue) {
    return normalizeParsedCondition({
      kind: "condition",
      property: leftProperty,
      operator,
      value: rightValue.value,
      valueSource: rightValue.source,
    }, schema);
  }
  const rightProperty = expressionToPropertyId(expr.right);
  const leftValue = expressionLiteralValue(expr.left, source);
  if (rightProperty && leftValue) {
    return normalizeParsedCondition({
      kind: "condition",
      property: rightProperty,
      operator: flipBinaryBuilderOperator(operator),
      value: leftValue.value,
      valueSource: leftValue.source,
    }, schema);
  }
  return null;
}

function unaryToCondition(expr: UnaryExpression, source: string, schema: FormulaLanguageSchema): BuilderCondition | null {
  if (expr.operator !== "!") return null;
  if (expr.argument.type === "Call") {
    const condition = callToCondition(expr.argument, source, schema);
    if (!condition) return null;
    if (condition.operator === "contains") return { ...condition, operator: "not-contains" };
    if (condition.operator === "is-empty") return { ...condition, operator: "is-not-empty" };
    if (condition.operator === "has-tag") return { ...condition, operator: "not-has-tag" };
    if (condition.operator === "links-to") return { ...condition, operator: "not-links-to" };
  }
  return null;
}

function callToCondition(expr: CallExpression, source: string, schema: FormulaLanguageSchema): BuilderCondition | null {
  if (expr.callee.type !== "Member" || expr.callee.computed || typeof expr.callee.property !== "string") return null;
  const property = expressionToPropertyId(expr.callee.object);
  if (!property) return null;
  const method = expr.callee.property;
  const firstArg = expr.args[0] ? expressionLiteralValue(expr.args[0], source) : undefined;
  const conditionFor = (operator: BuilderOperatorId): BuilderCondition => {
    const condition: BuilderCondition = {
      kind: "condition",
      property,
      operator,
    };
    if (firstArg) {
      condition.value = firstArg.value;
      condition.valueSource = firstArg.source;
    }
    return condition;
  };
  if (method === "isEmpty") return normalizeParsedCondition(conditionFor("is-empty"), schema);
  if (method === "contains" && firstArg) return normalizeParsedCondition(conditionFor("contains"), schema);
  if (method === "startsWith" && firstArg) return normalizeParsedCondition(conditionFor("starts-with"), schema);
  if (method === "endsWith" && firstArg) return normalizeParsedCondition(conditionFor("ends-with"), schema);
  if (method === "hasTag" && firstArg) return normalizeParsedCondition(conditionFor("has-tag"), schema);
  if ((method === "hasLink" || method === "linksTo") && firstArg) return normalizeParsedCondition(conditionFor("links-to"), schema);
  return null;
}

function expressionLiteralValue(expr: Expression, source: string): { value: unknown; source: BuilderValueSource } | null {
  if (expr.type === "Literal") return { value: expr.value, source: "literal" };
  if (expr.type === "Regex") return { value: `/${expr.pattern}/${expr.flags}`, source: "literal" };
  if (expr.type === "Call" && expr.callee.type === "Identifier" && (expr.callee.name === "date" || expr.callee.name === "duration")) {
    const value = expr.args[0];
    if (value?.type === "Literal") return { value: value.value, source: "literal" };
  }
  if (expr.type === "Array") {
    const values: unknown[] = [];
    for (const element of expr.elements) {
      const value = expressionLiteralValue(element, source);
      if (!value || value.source !== "literal") return { value: source.slice(expr.span.start, expr.span.end), source: "expression" };
      values.push(value.value);
    }
    return { value: values, source: "literal" };
  }
  return { value: source.slice(expr.span.start, expr.span.end), source: "expression" };
}

function binaryOperatorToBuilderOperator(operator: BinaryExpression["operator"]): BuilderOperatorId | null {
  switch (operator) {
    case "==":
      return "is";
    case "!=":
      return "is-not";
    case ">":
      return "greater-than";
    case ">=":
      return "greater-than-or-equal";
    case "<":
      return "less-than";
    case "<=":
      return "less-than-or-equal";
    default:
      return null;
  }
}

function flipBinaryBuilderOperator(operator: BuilderOperatorId): BuilderOperatorId {
  if (operator === "greater-than") return "less-than";
  if (operator === "greater-than-or-equal") return "less-than-or-equal";
  if (operator === "less-than") return "greater-than";
  if (operator === "less-than-or-equal") return "greater-than-or-equal";
  return operator;
}

function normalizeParsedCondition(condition: BuilderCondition, schema: FormulaLanguageSchema): BuilderCondition {
  const property = findBuilderProperty(schema, condition.property);
  if (!property) return condition;
  return condition;
}

function collectBuilderIssues(node: BuilderNode, schema: FormulaLanguageSchema): BuilderValidationIssue[] {
  const issues: BuilderValidationIssue[] = [];
  const visit = (current: BuilderNode): void => {
    if (current.kind === "group") {
      if (!["and", "or", "not"].includes(current.conjunction)) {
        issues.push({ code: "invalid-conjunction", message: "Filter group must use and, or, or not", severity: "error", node: current });
      }
      current.children.forEach(visit);
      return;
    }
    if (current.kind === "expression") {
      if (!current.source.trim()) {
        issues.push({ code: "empty-expression", message: "Expression is empty", severity: "warning", node: current });
      }
      return;
    }
    if (!current.property.trim()) {
      issues.push({ code: "missing-property", message: "Choose a property", severity: "error", node: current });
    }
    const operator = getBuilderOperator(current.operator);
    if (!operator) {
      issues.push({ code: "unknown-operator", message: `Unknown operator ${current.operator}`, severity: "error", node: current });
    }
    if (operator && operator.valueKind !== "none" && current.valueSource !== "expression" && (current.value === undefined || current.value === null || current.value === "")) {
      issues.push({ code: "missing-value", message: "Enter a value", severity: "warning", node: current });
    }
    const property = current.property ? findBuilderProperty(schema, current.property) : undefined;
    if (operator && property && !getBuilderOperatorsForType(property.type).some((candidate) => candidate.id === operator.id)) {
      issues.push({
        code: "operator-type-mismatch",
        message: `${operator.label} is unusual for ${property.type} values`,
        severity: "warning",
        node: current,
      });
    }
  };
  visit(node);
  return issues;
}

function builderPropertyFromCompletion(
  property: PropertyCompletion,
  source: BuilderProperty["source"],
  id: string,
): BuilderProperty {
  return {
    id,
    label: property.name,
    type: property.type ?? "any",
    source,
    ...(property.detail ? { detail: property.detail } : {}),
    ...(property.documentation ? { documentation: property.documentation } : {}),
    ...(property.values?.length ? { values: property.values } : {}),
  };
}

function flattenObjectProperties(object: ObjectPropertyCompletion, prefix = object.name): BuilderProperty[] {
  const own: BuilderProperty = {
    id: prefix,
    label: prefix,
    type: object.type ?? "object",
    source: "object",
    ...(object.detail ? { detail: object.detail } : {}),
    ...(object.documentation ? { documentation: object.documentation } : {}),
    ...(object.values?.length ? { values: object.values } : {}),
  };
  return [
    own,
    ...(object.properties ?? []).flatMap((property) => flattenObjectProperties(property, `${prefix}.${property.name}`)),
  ];
}

function dedupeBuilderProperties(properties: BuilderProperty[]): BuilderProperty[] {
  const seen = new Set<string>();
  const result: BuilderProperty[] = [];
  for (const property of properties) {
    if (seen.has(property.id)) continue;
    seen.add(property.id);
    result.push(property);
  }
  return result;
}

function propertyAccess(part: string): string {
  return isIdentifier(part) ? `.${part}` : `[${quoteString(part)}]`;
}

function quoteString(value: string): string {
  return JSON.stringify(value);
}

function regexpLiteral(value: string): string {
  if (/^\/.*\/[a-z]*$/i.test(value)) return value;
  return `/${value.replace(/[\\/]/g, "\\$&")}/`;
}

function isIdentifier(value: string): boolean {
  return /^[A-Za-z_$][\w$]*$/.test(value);
}
