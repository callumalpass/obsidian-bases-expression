import type { App, CachedMetadata, TFile } from "obsidian";
import type { FormulaLanguageSchema, FormulaValueType, PropertyCompletion, PropertyValueCompletion } from "obsidian-bases-expression";

export interface ObsidianSchemaOptions {
  files?: TFile[];
  maxFiles?: number;
  includeEmptyProperties?: boolean;
  propertyTypes?: Record<string, FormulaValueType>;
  includeValueSuggestions?: boolean;
  maxValuesPerProperty?: number;
  maxPreviewLength?: number;
}

type FrontmatterRecord = Record<string, unknown>;
type ValueStats = PropertyValueCompletion & { key: string; count: number };

const ignoredFrontmatterKeys = new Set(["position"]);
const defaultMaxValuesPerProperty = 50;
const defaultMaxPreviewLength = 96;

export function collectObsidianBasesSchema(app: App, options: ObsidianSchemaOptions = {}): FormulaLanguageSchema {
  const files = options.files ?? app.vault.getMarkdownFiles();
  const maxFiles = options.maxFiles ?? 2000;
  const includeValueSuggestions = options.includeValueSuggestions ?? true;
  const maxValuesPerProperty = options.maxValuesPerProperty ?? defaultMaxValuesPerProperty;
  const maxPreviewLength = options.maxPreviewLength ?? defaultMaxPreviewLength;
  const propertyTypes = new Map<string, FormulaValueType>();
  const propertyCounts = new Map<string, number>();
  const propertyValues = new Map<string, Map<string, ValueStats>>();

  for (const file of files.slice(0, maxFiles)) {
    const cache = app.metadataCache.getFileCache(file);
    const frontmatter = frontmatterFromCache(cache);
    if (!frontmatter) continue;
    for (const [key, value] of Object.entries(frontmatter)) {
      if (ignoredFrontmatterKeys.has(key)) continue;
      propertyCounts.set(key, (propertyCounts.get(key) ?? 0) + 1);
      const inferred = options.propertyTypes?.[key] ?? inferFormulaType(value);
      propertyTypes.set(key, mergeFormulaTypes(propertyTypes.get(key), inferred));
      if (includeValueSuggestions) {
        let values = propertyValues.get(key);
        if (!values) {
          values = new Map();
          propertyValues.set(key, values);
        }
        collectValueSuggestions(value, values);
      }
    }
  }

  const properties: PropertyCompletion[] = [...propertyTypes.entries()]
    .filter(([name]) => options.includeEmptyProperties ?? propertyCounts.has(name))
    .map(([name, type]) => {
      const count = propertyCounts.get(name) ?? 0;
      const property: PropertyCompletion = {
        name,
        type,
        source: "note",
        detail: `${type}${count ? ` · ${count} file${count === 1 ? "" : "s"}` : ""}`,
      };
      const values = topPropertyValues(propertyValues.get(name), maxValuesPerProperty);
      if (values.length) {
        property.values = values;
        const documentation = truncateText(`Examples: ${values.map((value) => value.label ?? String(value.value)).join(", ")}`, maxPreviewLength);
        if (documentation) property.documentation = documentation;
      }
      return property;
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  return {
    properties,
  };
}

function collectValueSuggestions(value: unknown, values: Map<string, ValueStats>): void {
  for (const item of scalarSuggestionValues(value)) {
    const label = valueLabel(item.value);
    const key = `${item.type}:${label}`;
    const existing = values.get(key);
    if (existing) {
      existing.count += 1;
      existing.detail = `${existing.count} occurrence${existing.count === 1 ? "" : "s"}`;
      continue;
    }
    values.set(key, {
      key,
      value: item.value,
      label,
      type: item.type,
      detail: "1 occurrence",
      count: 1,
    });
  }
}

function scalarSuggestionValues(value: unknown): Array<{ value: string | number | boolean; type: FormulaValueType }> {
  if (Array.isArray(value)) return value.flatMap((item) => scalarSuggestionValues(item));
  if (value instanceof Date) return [{ value: value.toISOString().slice(0, 10), type: "date" }];
  if (typeof value === "string") return value.trim() ? [{ value, type: inferFormulaType(value) }] : [];
  if (typeof value === "number" && Number.isFinite(value)) return [{ value, type: "number" }];
  if (typeof value === "boolean") return [{ value, type: "boolean" }];
  return [];
}

function topPropertyValues(values: Map<string, ValueStats> | undefined, maxValues: number): PropertyValueCompletion[] {
  if (!values || maxValues <= 0) return [];
  return [...values.values()]
    .sort((a, b) => b.count - a.count || (a.label ?? "").localeCompare(b.label ?? ""))
    .slice(0, maxValues)
    .map(({ key: _key, ...value }) => value);
}

function frontmatterFromCache(cache: CachedMetadata | null): FrontmatterRecord | null {
  const frontmatter = cache?.frontmatter;
  return frontmatter && typeof frontmatter === "object" ? frontmatter as FrontmatterRecord : null;
}

function valueLabel(value: string | number | boolean): string {
  return String(value);
}

function inferFormulaType(value: unknown): FormulaValueType {
  if (value === null || value === undefined) return "null";
  if (typeof value === "boolean") return "boolean";
  if (typeof value === "number") return "number";
  if (Array.isArray(value)) return "list";
  if (value instanceof Date) return "date";
  if (typeof value === "object") return "object";
  if (typeof value === "string") {
    if (/^\d{4}-\d{2}-\d{2}(?:[T ][0-2]\d:[0-5]\d(?::[0-5]\d)?)?$/.test(value)) return "date";
    return "string";
  }
  return "any";
}

function mergeFormulaTypes(existing: FormulaValueType | undefined, next: FormulaValueType): FormulaValueType {
  if (!existing) return next;
  if (existing === next) return existing;
  if (existing === "null") return next;
  if (next === "null") return existing;
  if (existing === "date" && next === "string") return "string";
  if (existing === "string" && next === "date") return "string";
  return "any";
}

function truncateText(value: string, maxLength: number): string {
  if (maxLength <= 0) return "";
  if (value.length <= maxLength) return value;
  if (maxLength <= 3) return value.slice(0, maxLength);
  return `${value.slice(0, maxLength - 3).trimEnd()}...`;
}
