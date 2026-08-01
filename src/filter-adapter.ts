import type { Diagnostic, Expression } from "./ast.js";
import type { FilterExpression, LogicalFilter } from "./filter.js";

export interface AdaptedFilterResult {
  filter: FilterExpression;
  diagnostics: Diagnostic[];
}

/**
 * Converts the filter-node shape exposed by Obsidian Bases view config
 * (`conjunction`, `filters`, and `rule.text`) into the public structured-filter
 * contract used by this package.
 */
export function adaptObsidianFilterNode(input: unknown): AdaptedFilterResult {
  const diagnostics: Diagnostic[] = [];
  return {
    filter: adaptNode(input, diagnostics),
    diagnostics,
  };
}

/**
 * Extracts and combines the query-level and view-level filters exposed on an
 * Obsidian Bases view config. Passing a filter node directly is also supported.
 */
export function adaptObsidianFilterConfig(input: unknown): AdaptedFilterResult {
  if (isRuntimeFilterNode(input) || isLogicalFilterInput(input) || typeof input === "string" || isAstExpression(input)) {
    return adaptObsidianFilterNode(input);
  }

  const diagnostics: Diagnostic[] = [];
  if (!isRecord(input)) {
    diagnostics.push(invalidFilterDiagnostic("Expected an Obsidian Bases config or filter node"));
    return { filter: null, diagnostics };
  }

  const filters: FilterExpression[] = [];
  if (isRecord(input.query) && Object.prototype.hasOwnProperty.call(input.query, "filters")) {
    filters.push(adaptNode(input.query.filters, diagnostics));
  }

  if (Object.prototype.hasOwnProperty.call(input, "filters")) {
    filters.push(adaptNode(input.filters, diagnostics));
  }

  if (filters.length === 0) return { filter: null, diagnostics };
  if (filters.length === 1) return { filter: filters[0], diagnostics };
  return { filter: { and: filters }, diagnostics };
}

function adaptNode(input: unknown, diagnostics: Diagnostic[]): FilterExpression {
  if (input === null || input === undefined || typeof input === "string" || isAstExpression(input)) return input;

  if (!isRecord(input)) {
    diagnostics.push(invalidFilterDiagnostic("Unsupported Obsidian Bases filter node"));
    return null;
  }

  const logicalKeys = ["and", "or", "not"].filter((key) => Object.prototype.hasOwnProperty.call(input, key));
  const hasRule = Object.prototype.hasOwnProperty.call(input, "rule");
  const hasRuntimeGroup =
    Object.prototype.hasOwnProperty.call(input, "filters") ||
    Object.prototype.hasOwnProperty.call(input, "conjunction");
  if (
    (logicalKeys.length > 0 && (hasRule || hasRuntimeGroup)) ||
    (hasRule && hasRuntimeGroup)
  ) {
    diagnostics.push(invalidFilterDiagnostic("Filter node mixes incompatible logical, group, or rule shapes"));
    return null;
  }

  if (logicalKeys.length > 0) {
    if (logicalKeys.length !== 1) {
      diagnostics.push(invalidFilterDiagnostic("Filter object must contain exactly one of: and, or, not"));
      return null;
    }
    const key = logicalKeys[0] as keyof LogicalFilter;
    return { [key]: adaptChildren(input[key], diagnostics) };
  }

  if (hasRule) {
    const text = isRecord(input.rule) ? input.rule.text : undefined;
    if (typeof text === "string") return text;
    diagnostics.push(invalidFilterDiagnostic("Obsidian Bases rule.text must be a string"));
    return null;
  }

  if (hasRuntimeGroup) {
    if (!Array.isArray(input.filters)) {
      diagnostics.push(invalidFilterDiagnostic("Obsidian Bases filter group must contain a filters array"));
      return null;
    }

    const conjunction = input.conjunction ?? "and";
    if (conjunction !== "and" && conjunction !== "or" && conjunction !== "not") {
      diagnostics.push(invalidFilterDiagnostic(`Unsupported Obsidian Bases conjunction: ${String(conjunction)}`));
      return null;
    }

    return { [conjunction]: input.filters.map((child) => adaptNode(child, diagnostics)) };
  }

  diagnostics.push(invalidFilterDiagnostic("Unsupported Obsidian Bases filter object"));
  return null;
}

function adaptChildren(input: unknown, diagnostics: Diagnostic[]): FilterExpression | FilterExpression[] {
  if (Array.isArray(input)) return input.map((child) => adaptNode(child, diagnostics));
  return adaptNode(input, diagnostics);
}

function isRuntimeFilterNode(input: unknown): boolean {
  return (
    isRecord(input) &&
    (Object.prototype.hasOwnProperty.call(input, "rule") ||
      Object.prototype.hasOwnProperty.call(input, "conjunction") ||
      Array.isArray(input.filters))
  );
}

function isLogicalFilterInput(input: unknown): boolean {
  return (
    isRecord(input) &&
    ["and", "or", "not"].some((key) => Object.prototype.hasOwnProperty.call(input, key))
  );
}

function isAstExpression(value: unknown): value is Expression {
  return isRecord(value) && typeof value.type === "string";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function invalidFilterDiagnostic(message: string): Diagnostic {
  return {
    code: "invalid-obsidian-filter",
    message,
    severity: "error",
    span: { start: 0, end: 0 },
  };
}
