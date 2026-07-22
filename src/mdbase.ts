import type { Expression } from "./ast.js";
import { parseExpression } from "./parser.js";

export type ObsidianBaseFilter = string | {
  and?: ObsidianBaseFilter[];
  or?: ObsidianBaseFilter[];
  not?: ObsidianBaseFilter[];
};

export interface ObsidianBaseLike {
  filters?: ObsidianBaseFilter;
  formulas?: Record<string, string>;
  properties?: Record<string, Record<string, unknown>>;
  summaries?: Record<string, string>;
  views?: Array<Record<string, unknown>>;
  [key: string]: unknown;
}

export interface MdbaseCompatibilityDiagnostic {
  severity: "error" | "warning";
  code: string;
  message: string;
  location?: string;
  expression?: string;
}

export interface MdbaseExpressionTranslation {
  source: string;
  expression: string | null;
  portable: boolean;
  diagnostics: MdbaseCompatibilityDiagnostic[];
}

export interface MdbaseViewConversionOptions {
  id: string;
  name: string;
  description?: string;
}

export interface MdbaseViewConversion {
  /** A canonical view record only when every semantic expression translated. */
  record: Record<string, unknown> | null;
  /** Inspectable structural draft retained even when translation is partial. */
  draft: Record<string, unknown>;
  portable: boolean;
  diagnostics: MdbaseCompatibilityDiagnostic[];
}

const PORTABLE_GLOBALS = new Set(["now", "today", "duration", "link"]);
const MDBASE_IDENTIFIER = /^[A-Za-z][A-Za-z0-9._:-]*$/;
const MDBASE_FIELD_NAME = /^[A-Za-z_][A-Za-z0-9_:-]*$/;
const PORTABLE_METHODS = new Set([
  "asFile",
  "asLink",
  "contains",
  "endsWith",
  "exists",
  "filter",
  "hasLink",
  "hasTag",
  "inFolder",
  "map",
  "matches",
  "size",
  "startsWith",
]);

/** Translate the provably portable subset of an Obsidian Bases expression to mdbase CEL. */
export function translateObsidianExpressionToMdbase(source: string): MdbaseExpressionTranslation {
  const parsed = parseExpression(source);
  const diagnostics: MdbaseCompatibilityDiagnostic[] = parsed.diagnostics
    .filter((diagnostic) => diagnostic.severity === "error")
    .map((diagnostic) => ({
      severity: "error",
      code: "invalid_obsidian_expression",
      message: diagnostic.message,
      expression: source,
    }));
  if (!parsed.ast || diagnostics.length > 0) {
    return { source, expression: null, portable: false, diagnostics };
  }

  const expression = printPortableExpression(parsed.ast, source, diagnostics);
  const portable = diagnostics.every((diagnostic) => diagnostic.severity !== "error");
  return { source, expression: portable ? expression : null, portable, diagnostics };
}

/**
 * Convert a parsed `.base` document into the canonical mdbase view-record
 * structure. Lossless Obsidian source is retained under `x-obsidian`; a
 * canonical executable record is returned only for a behavior-preserving
 * translation.
 */
export function convertObsidianBaseToMdbaseView(
  base: ObsidianBaseLike,
  options: MdbaseViewConversionOptions,
): MdbaseViewConversion {
  const diagnostics: MdbaseCompatibilityDiagnostic[] = [];
  const query: Record<string, unknown> = {};

  if (!MDBASE_IDENTIFIER.test(options.id)) {
    diagnostics.push({ severity: "error", code: "invalid_identifier", message: "View record id is not a portable mdbase identifier", location: "id" });
  }
  if (!options.name.trim()) {
    diagnostics.push({ severity: "error", code: "invalid_name", message: "View record name must not be empty", location: "name" });
  }

  const sharedWhere = translateFilter(base.filters, "filters", diagnostics);
  if (sharedWhere) query.where = sharedWhere;

  const projections: Record<string, unknown> = {};
  for (const [name, source] of Object.entries(base.formulas ?? {})) {
    if (!MDBASE_FIELD_NAME.test(name)) {
      diagnostics.push({ severity: "error", code: "invalid_identifier", message: `Formula name ${JSON.stringify(name)} is not a portable projection name`, location: `formulas.${name}` });
      continue;
    }
    const translated = translateAt(source, `formulas.${name}`, diagnostics);
    if (translated) projections[name] = { expr: translated };
  }
  if (Object.keys(projections).length > 0) query.projections = projections;

  const properties: Record<string, unknown> = {};
  for (const [sourceName, sourceMetadata] of Object.entries(base.properties ?? {})) {
    const propertyName = normalizePropertyId(sourceName);
    if (!propertyName) {
      diagnostics.push({ severity: "error", code: "invalid_property", message: "Property metadata key must not be empty", location: `properties.${sourceName}` });
      continue;
    }
    const metadata: Record<string, unknown> = {};
    if (typeof sourceMetadata.displayName === "string") metadata.label = sourceMetadata.displayName;
    const extra = Object.fromEntries(Object.entries(sourceMetadata).filter(([key]) => key !== "displayName"));
    if (Object.keys(extra).length > 0) metadata["x-obsidian"] = extra;
    properties[propertyName] = metadata;
  }

  const summaryFunctions: Record<string, unknown> = {};
  for (const [name, source] of Object.entries(base.summaries ?? {})) {
    if (!MDBASE_FIELD_NAME.test(name)) {
      diagnostics.push({ severity: "error", code: "invalid_identifier", message: `Summary name ${JSON.stringify(name)} is not a portable field name`, location: `summaries.${name}` });
      continue;
    }
    const translated = translateAt(source, `summaries.${name}`, diagnostics);
    if (translated) summaryFunctions[name] = { expr: translated };
  }

  const sourceViews = base.views?.length ? base.views : [{ type: "table", name: "All" }];
  const usedIds = new Set<string>();
  const views = sourceViews.map((sourceView, index) => {
    const name = typeof sourceView.name === "string" && sourceView.name.trim()
      ? sourceView.name.trim()
      : `View ${index + 1}`;
    const id = uniqueViewId(name, index, usedIds);
    const view: Record<string, unknown> = { id, name };

    const where = translateFilter(
      sourceView.filters as ObsidianBaseFilter | undefined,
      `views.${id}.filters`,
      diagnostics,
    );
    if (where) view.where = where;

    if (Array.isArray(sourceView.order) && sourceView.order.length > 0) {
      view.select = sourceView.order.filter((value): value is string => typeof value === "string").map(normalizePropertyId);
    }
    if (Array.isArray(sourceView.sort) && sourceView.sort.length > 0) {
      view.order_by = sourceView.sort.flatMap((entry) => {
        if (!isRecord(entry) || typeof entry.property !== "string") return [];
        return [{
          field: normalizePropertyId(entry.property),
          direction: String(entry.direction).toLowerCase() === "desc" ? "desc" : "asc",
        }];
      });
    }
    if (isRecord(sourceView.groupBy) && typeof sourceView.groupBy.property === "string") {
      view.group_by = [{
        field: normalizePropertyId(sourceView.groupBy.property),
        direction: String(sourceView.groupBy.direction).toLowerCase() === "desc" ? "desc" : "asc",
      }];
    }
    if (isRecord(sourceView.summaries)) {
      view.summaries = Object.entries(sourceView.summaries).flatMap(([field, fn]) => {
        if (typeof fn !== "string") return [];
        const functionName = normalizeSummaryFunction(fn);
        if (!MDBASE_IDENTIFIER.test(functionName)) {
          diagnostics.push({ severity: "error", code: "invalid_identifier", message: `Summary function ${JSON.stringify(fn)} is not a portable identifier`, location: `views.${id}.summaries.${field}` });
          return [];
        }
        return [{ field: normalizePropertyId(field), function: functionName }];
      });
    }
    if (typeof sourceView.limit === "number" && Number.isInteger(sourceView.limit) && sourceView.limit >= 0) {
      view.limit = sourceView.limit;
    }

    const presentationOptions = Object.fromEntries(Object.entries(sourceView).filter(([key]) => ![
      "type", "name", "filters", "order", "sort", "groupBy", "summaries", "limit",
    ].includes(key)));
    const presentationType = typeof sourceView.type === "string" && sourceView.type ? sourceView.type : "table";
    if (!MDBASE_IDENTIFIER.test(presentationType)) {
      diagnostics.push({ severity: "error", code: "invalid_identifier", message: `Presentation type ${JSON.stringify(presentationType)} is not a portable identifier`, location: `views.${id}.type` });
    }
    view.presentation = {
      type: MDBASE_IDENTIFIER.test(presentationType) ? presentationType : "table",
      ...(Object.keys(presentationOptions).length > 0 ? { options: presentationOptions } : {}),
      "x-obsidian": { source: sourceView },
    };
    return view;
  });

  const draft: Record<string, unknown> = {
    type: "view",
    id: options.id,
    version: 1,
    name: options.name,
    ...(options.description ? { description: options.description } : {}),
    ...(Object.keys(query).length > 0 ? { query } : {}),
    ...(Object.keys(properties).length > 0 ? { properties } : {}),
    ...(Object.keys(summaryFunctions).length > 0 ? { summary_functions: summaryFunctions } : {}),
    views,
    "x-obsidian": {
      source_format: "base",
      portable: diagnostics.every((diagnostic) => diagnostic.severity !== "error"),
      source: base,
    },
  };
  const portable = diagnostics.every((diagnostic) => diagnostic.severity !== "error");
  return { record: portable ? draft : null, draft, portable, diagnostics };
}

function translateFilter(
  filter: ObsidianBaseFilter | undefined,
  location: string,
  diagnostics: MdbaseCompatibilityDiagnostic[],
): string | undefined {
  if (filter === undefined) return undefined;
  if (typeof filter === "string") return translateAt(filter, location, diagnostics) ?? undefined;
  if (!isRecord(filter)) {
    diagnostics.push({ severity: "error", code: "invalid_filter", message: "Filter must be an expression or logical object", location });
    return undefined;
  }
  if (Array.isArray(filter.and)) {
    const children = filter.and.map((child, index) => translateFilter(child, `${location}.and.${index}`, diagnostics)).filter(Boolean) as string[];
    return children.length === filter.and.length ? (children.length ? children.map(parenthesize).join(" && ") : "true") : undefined;
  }
  if (Array.isArray(filter.or)) {
    const children = filter.or.map((child, index) => translateFilter(child, `${location}.or.${index}`, diagnostics)).filter(Boolean) as string[];
    return children.length === filter.or.length ? (children.length ? children.map(parenthesize).join(" || ") : "false") : undefined;
  }
  if (Array.isArray(filter.not)) {
    const children = filter.not.map((child, index) => translateFilter(child, `${location}.not.${index}`, diagnostics)).filter(Boolean) as string[];
    return children.length === filter.not.length ? `!(${children.length ? children.map(parenthesize).join(" && ") : "true"})` : undefined;
  }
  diagnostics.push({ severity: "error", code: "invalid_filter", message: "Logical filter must contain exactly one of and, or, or not", location });
  return undefined;
}

function translateAt(
  source: string,
  location: string,
  diagnostics: MdbaseCompatibilityDiagnostic[],
): string | null {
  const result = translateObsidianExpressionToMdbase(source);
  diagnostics.push(...result.diagnostics.map((diagnostic) => ({ ...diagnostic, location })));
  return result.expression;
}

function printPortableExpression(
  expr: Expression,
  source: string,
  diagnostics: MdbaseCompatibilityDiagnostic[],
): string {
  switch (expr.type) {
    case "Identifier":
      if (expr.name === "note") return "record";
      if (expr.name === "formula") return "projection";
      return expr.name;
    case "Literal":
      return typeof expr.value === "string" ? JSON.stringify(expr.value) : String(expr.value);
    case "Regex":
      unsupported(diagnostics, source, "unsupported_regex_literal", "Obsidian regex literals do not have a behavior-preserving portable CEL representation");
      return expr.raw;
    case "Array":
      return `[${expr.elements.map((element) => printPortableExpression(element, source, diagnostics)).join(", ")}]`;
    case "Object":
      unsupported(diagnostics, source, "unsupported_object_literal", "Object literals are not portable in stored mdbase CEL");
      return "{}";
    case "Unary":
      if (expr.operator === "+") unsupported(diagnostics, source, "unsupported_operator", "Unary plus is not portable mdbase CEL");
      return `${expr.operator}${parenthesize(printPortableExpression(expr.argument, source, diagnostics))}`;
    case "Binary":
      return `(${printPortableExpression(expr.left, source, diagnostics)} ${expr.operator} ${printPortableExpression(expr.right, source, diagnostics)})`;
    case "Member": {
      const object = printPortableExpression(expr.object, source, diagnostics);
      if (!expr.computed && expr.property === "length") return `${parenthesize(object)}.size()`;
      if (!expr.computed && expr.object.type === "Identifier" && expr.object.name === "this" && expr.property === "note") {
        return "this.record";
      }
      if (expr.computed && typeof expr.property !== "string") {
        return `${parenthesize(object)}[${printPortableExpression(expr.property, source, diagnostics)}]`;
      }
      return `${parenthesize(object)}.${String(expr.property)}`;
    }
    case "Call": {
      if (expr.callee.type === "Identifier") {
        const name = expr.callee.name;
        const args = expr.args.map((arg) => printPortableExpression(arg, source, diagnostics));
        if (name === "if") {
          if (args.length !== 3) unsupported(diagnostics, source, "unsupported_function", "Obsidian if() must have exactly three arguments");
          return `(${args[0] ?? "null"} ? ${args[1] ?? "null"} : ${args[2] ?? "null"})`;
        }
        if (name === "file") {
          if (args.length !== 1) unsupported(diagnostics, source, "unsupported_function", "Obsidian file() must have exactly one argument");
          return `${parenthesize(args[0] ?? "null")}.asFile()`;
        }
        if (!PORTABLE_GLOBALS.has(name)) {
          unsupported(diagnostics, source, "unsupported_function", `Obsidian function ${name}() is not in the portable mdbase CEL contract`);
        }
        const requiredArity = name === "now" || name === "today" ? 0 : 1;
        if (PORTABLE_GLOBALS.has(name) && args.length !== requiredArity) {
          unsupported(diagnostics, source, "unsupported_arity", `${name}() requires exactly ${requiredArity} argument${requiredArity === 1 ? "" : "s"}`);
        }
        if (
          name === "duration" &&
          expr.args[0]?.type === "Literal" &&
          typeof expr.args[0].value === "string" &&
          !isPortableIsoDuration(expr.args[0].value)
        ) {
          unsupported(
            diagnostics,
            source,
            "unsupported_duration",
            "Portable mdbase duration() literals must use the fixed-length ISO 8601 subset (for example P1D or PT2H)",
          );
        }
        return `${name}(${args.join(", ")})`;
      }
      if (expr.callee.type === "Member" && typeof expr.callee.property === "string") {
        const method = expr.callee.property;
        const receiver = printPortableExpression(expr.callee.object, source, diagnostics);
        const args = expr.args.map((arg) => printPortableExpression(arg, source, diagnostics));
        if (!PORTABLE_METHODS.has(method)) {
          unsupported(diagnostics, source, "unsupported_method", `Obsidian method ${method}() is not in the portable mdbase CEL contract`);
        }
        if ((method === "hasTag" || method === "hasLink") && args.length !== 1) {
          unsupported(diagnostics, source, "unsupported_arity", `${method}() is variadic in Obsidian but accepts one value in portable mdbase CEL`);
        }
        if (method === "filter" || method === "map" || method === "exists") {
          if (args.length !== 1) {
            unsupported(diagnostics, source, "unsupported_arity", `Obsidian ${method}() must have one implicit-value expression`);
          }
          if (expr.args[0] && containsIdentifier(expr.args[0], "index")) {
            unsupported(diagnostics, source, "unsupported_lambda_index", `Obsidian ${method}() index bindings do not have a portable CEL equivalent`);
          }
          return `${parenthesize(receiver)}.${method}(value, ${args[0] ?? "null"})`;
        }
        return `${parenthesize(receiver)}.${method}(${args.join(", ")})`;
      }
      unsupported(diagnostics, source, "unsupported_call", "Dynamic function calls are not portable mdbase CEL");
      return `${printPortableExpression(expr.callee, source, diagnostics)}(${expr.args.map((arg) => printPortableExpression(arg, source, diagnostics)).join(", ")})`;
    }
  }
}

function isPortableIsoDuration(value: string): boolean {
  return /^-?P(?=\d|T)(?:(?:\d+(?:\.\d+)?W)|(?:\d+(?:\.\d+)?D))?(?:T(?=\d)(?:\d+(?:\.\d+)?H)?(?:\d+(?:\.\d+)?M)?(?:\d+(?:\.\d+)?S)?)?$/.test(value);
}

function unsupported(
  diagnostics: MdbaseCompatibilityDiagnostic[],
  expression: string,
  code: string,
  message: string,
): void {
  diagnostics.push({ severity: "error", code, message, expression });
}

function containsIdentifier(expr: Expression, name: string): boolean {
  switch (expr.type) {
    case "Identifier": return expr.name === name;
    case "Array": return expr.elements.some((item) => containsIdentifier(item, name));
    case "Object": return expr.properties.some((property) => containsIdentifier(property.value, name));
    case "Unary": return containsIdentifier(expr.argument, name);
    case "Binary": return containsIdentifier(expr.left, name) || containsIdentifier(expr.right, name);
    case "Member": return containsIdentifier(expr.object, name) ||
      (expr.computed && typeof expr.property !== "string" && containsIdentifier(expr.property, name));
    case "Call": return containsIdentifier(expr.callee, name) || expr.args.some((arg) => containsIdentifier(arg, name));
    case "Literal":
    case "Regex":
      return false;
  }
}

function normalizePropertyId(value: string): string {
  if (value.startsWith("note.")) return value.slice(5);
  if (value.startsWith("formula.")) return `projection.${value.slice(8)}`;
  return value;
}

function normalizeSummaryFunction(value: string): string {
  const normalized = value.trim().toLowerCase();
  const aliases: Record<string, string> = { min: "minimum", max: "maximum", avg: "average", mean: "average" };
  return aliases[normalized] ?? normalized;
}

function uniqueViewId(name: string, index: number, used: Set<string>): string {
  const base = name.toLowerCase().replace(/[^a-z0-9._:-]+/g, "-").replace(/^-+|-+$/g, "") || `view-${index + 1}`;
  const prefixed = /^[a-z]/.test(base) ? base : `view-${base}`;
  let candidate = prefixed;
  let suffix = 2;
  while (used.has(candidate)) candidate = `${prefixed}-${suffix++}`;
  used.add(candidate);
  return candidate;
}

function parenthesize(value: string): string {
  return `(${value})`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
