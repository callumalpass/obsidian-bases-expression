import {
  findBuilderProperty,
  type FormulaLanguageSchema,
  type PropertyValueCompletion,
} from "obsidian-bases-expression";

export interface ValueSuggestion {
  label: string;
  insertText: string;
  value: unknown;
  detail?: string;
  documentation?: string;
  type?: string;
  count?: number;
}

export function getValueSuggestions(
  schema: FormulaLanguageSchema,
  propertyId: string,
  query = "",
  options: { limit?: number } = {},
): ValueSuggestion[] {
  const property = findBuilderProperty(schema, propertyId);
  const values = property?.values ?? [];
  const needle = normalize(query);
  return values
    .map(valueToSuggestion)
    .map((suggestion) => ({ suggestion, score: scoreValue(suggestion, needle) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || (b.suggestion.count ?? 0) - (a.suggestion.count ?? 0) || a.suggestion.label.localeCompare(b.suggestion.label))
    .slice(0, options.limit ?? 50)
    .map((item) => item.suggestion);
}

function valueToSuggestion(value: PropertyValueCompletion): ValueSuggestion {
  const label = value.label ?? displayValue(value.value);
  const suggestion: ValueSuggestion = {
    label,
    insertText: value.insertText ?? label,
    value: value.value,
  };
  if (value.detail) suggestion.detail = value.detail;
  else if (value.type || value.count) suggestion.detail = [value.type, value.count ? `${value.count} occurrence${value.count === 1 ? "" : "s"}` : ""].filter(Boolean).join(" · ");
  if (value.documentation) suggestion.documentation = value.documentation;
  if (value.type) suggestion.type = String(value.type);
  if (value.count) suggestion.count = value.count;
  return suggestion;
}

function scoreValue(suggestion: ValueSuggestion, needle: string): number {
  if (!needle) return suggestion.count ?? 1;
  const label = normalize(suggestion.label);
  const insertText = normalize(suggestion.insertText);
  if (label === needle || insertText === needle) return 100;
  if (label.startsWith(needle) || insertText.startsWith(needle)) return 80;
  if (label.includes(needle) || insertText.includes(needle)) return 50;
  if (suggestion.detail && normalize(suggestion.detail).includes(needle)) return 20;
  return 0;
}

function displayValue(value: unknown): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

function normalize(value: string): string {
  return value.trim().toLowerCase();
}
