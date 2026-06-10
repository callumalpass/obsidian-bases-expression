import moment from "moment";

export type ValueType =
  | "Null"
  | "Boolean"
  | "Number"
  | "String"
  | "Date"
  | "Duration"
  | "List"
  | "Object"
  | "File"
  | "Link"
  | "RegExp"
  | "HTML"
  | "Image"
  | "Icon"
  | "Error";

export type RuntimeValue =
  | { type: "Null"; value: null }
  | { type: "Boolean"; value: boolean }
  | { type: "Number"; value: number }
  | { type: "String"; value: string }
  | { type: "Date"; value: Date; dateOnly?: boolean }
  | { type: "Duration"; value: Duration }
  | { type: "List"; value: RuntimeValue[] }
  | { type: "Object"; value: Record<string, RuntimeValue> }
  | { type: "File"; value: FileValue }
  | { type: "Link"; value: LinkValue }
  | { type: "RegExp"; value: RegExp }
  | { type: "HTML"; value: string }
  | { type: "Image"; value: string | FileValue | LinkValue }
  | { type: "Icon"; value: string }
  | { type: "Error"; value: { message: string } };

export interface Duration {
  years: number;
  months: number;
  weeks: number;
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
  milliseconds: number;
}

export interface FileValue {
  path: string;
  name: string;
  basename: string;
  folder: string;
  ext: string;
  size: number;
  properties: Record<string, unknown>;
  tags: string[];
  links: LinkValue[];
  embeds: LinkValue[];
  backlinks: LinkValue[];
  ctime: Date;
  mtime: Date;
}

export interface LinkValue {
  path: string;
  display?: RuntimeValue;
  resolvedPath?: string | null;
  external?: boolean;
}

export type LinkValueInput = Omit<Partial<LinkValue>, "display"> & { path: string; display?: unknown };

export type FileValueInput = Omit<Partial<FileValue>, "links" | "embeds" | "backlinks"> & {
  path: string;
  links?: LinkValueInput[];
  embeds?: LinkValueInput[];
  backlinks?: LinkValueInput[];
};

export function nullValue(): RuntimeValue {
  return { type: "Null", value: null };
}

export function boolValue(value: boolean): RuntimeValue {
  return { type: "Boolean", value };
}

export function numberValue(value: number): RuntimeValue {
  return { type: "Number", value };
}

export function stringValue(value: string): RuntimeValue {
  return { type: "String", value };
}

export function dateValue(value: Date | string | number, dateOnly = typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)): RuntimeValue {
  const date =
    typeof value === "string"
      ? dateOnly
        ? moment(value, "YYYY-MM-DD").toDate()
        : moment(value, ["YYYY-MM-DD HH:mm:ss", moment.ISO_8601]).toDate()
      : value instanceof Date
        ? value
        : new Date(value);
  const result: RuntimeValue = { type: "Date", value: date };
  if (dateOnly) result.dateOnly = true;
  return result;
}

export function durationValue(value: Partial<Duration>): RuntimeValue {
  return {
    type: "Duration",
    value: {
      years: value.years ?? 0,
      months: value.months ?? 0,
      weeks: value.weeks ?? 0,
      days: value.days ?? 0,
      hours: value.hours ?? 0,
      minutes: value.minutes ?? 0,
      seconds: value.seconds ?? 0,
      milliseconds: value.milliseconds ?? 0,
    },
  };
}

export function listValue(value: RuntimeValue[]): RuntimeValue {
  return { type: "List", value };
}

export function objectValue(value: Record<string, RuntimeValue>): RuntimeValue {
  return { type: "Object", value };
}

export function fileValue(value: FileValueInput): RuntimeValue {
  const name = value.name ?? value.path.split("/").pop() ?? value.path;
  const dot = name.lastIndexOf(".");
  const ext = value.ext ?? (dot >= 0 ? name.slice(dot + 1) : "");
  const basename = value.basename ?? (dot >= 0 ? name.slice(0, dot) : name);
  const slash = value.path.lastIndexOf("/");
  return {
    type: "File",
    value: {
      path: value.path,
      name,
      basename,
      folder: value.folder ?? (slash >= 0 ? value.path.slice(0, slash) : ""),
      ext,
      size: value.size ?? 0,
      properties: value.properties ?? {},
      tags: value.tags ?? [],
      links: (value.links ?? []).map(normalizeLinkValue),
      embeds: (value.embeds ?? []).map(normalizeLinkValue),
      backlinks: (value.backlinks ?? []).map(normalizeLinkValue),
      ctime: value.ctime ?? new Date(0),
      mtime: value.mtime ?? new Date(0),
    },
  };
}

export function linkValue(path: string, display?: RuntimeValue, resolvedPath?: string | null): RuntimeValue {
  const input: LinkValueInput = { path };
  if (display !== undefined) input.display = display;
  if (resolvedPath !== undefined) input.resolvedPath = resolvedPath;
  const value: LinkValue = normalizeLinkValue(input);
  return { type: "Link", value };
}

function normalizeLinkValue(value: LinkValueInput): LinkValue {
  const normalized: LinkValue = { path: value.path };
  if (value.display !== undefined) normalized.display = isRuntimeValue(value.display) ? value.display : fromJs(value.display);
  if (Object.prototype.hasOwnProperty.call(value, "resolvedPath")) normalized.resolvedPath = value.resolvedPath ?? null;
  if (value.external ?? /^[a-z][a-z0-9+.-]*:/i.test(value.path)) normalized.external = true;
  return normalized;
}

function isRuntimeValue(value: unknown): value is RuntimeValue {
  return Boolean(
    value &&
      typeof value === "object" &&
      "type" in value &&
      "value" in value &&
      typeof (value as { type?: unknown }).type === "string",
  );
}

export function regexpValue(value: RegExp): RuntimeValue {
  return { type: "RegExp", value };
}

export function errorValue(message: string): RuntimeValue {
  return { type: "Error", value: { message } };
}

export function fromJs(value: unknown, typeHint?: string): RuntimeValue {
  if (value && typeof value === "object" && "type" in value && "value" in value) {
    return value as RuntimeValue;
  }
  if (typeHint === "date" || value instanceof Date) return dateValue(value as Date | string | number);
  if (value === null || value === undefined) return nullValue();
  if (typeof value === "boolean") return boolValue(value);
  if (typeof value === "number") return numberValue(value);
  if (typeof value === "string") return stringValue(value);
  if (Array.isArray(value)) return listValue(value.map((item) => fromJs(item)));
  if (typeof value === "object") {
    const out: Record<string, RuntimeValue> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      out[key] = fromJs(item);
    }
    return objectValue(out);
  }
  return stringValue(String(value));
}

export function toPlain(value: RuntimeValue): unknown {
  switch (value.type) {
    case "Null":
    case "Boolean":
    case "Number":
    case "String":
    case "HTML":
    case "Icon":
      return value.value;
    case "Date":
      return formatDateValue(value);
    case "Duration":
      return stringifyValue(value);
    case "List":
      return value.value.map(toPlain);
    case "Object":
      return Object.fromEntries(Object.entries(value.value).map(([key, item]) => [key, toPlain(item)]));
    case "File":
      return value.value.path;
    case "Link":
      return value.value.display ? { path: value.value.path, display: toPlain(value.value.display) } : value.value.path;
    case "RegExp":
      return `/${value.value.source}/${value.value.flags}`;
    case "Image":
      return typeof value.value === "string" ? value.value : value.value.path;
    case "Error":
      return { error: value.value.message };
  }
}

export function stringifyValue(value: RuntimeValue): string {
  switch (value.type) {
    case "Null":
      return "";
    case "Boolean":
    case "Number":
      return String(value.value);
    case "String":
    case "HTML":
    case "Icon":
      return value.value;
    case "Date":
      return formatDateValue(value);
    case "Duration":
      return formatDuration(value.value);
    case "List":
      return value.value.map(stringifyValue).join(",");
    case "Object":
      return JSON.stringify(toPlain(value));
    case "File":
      return value.value.path;
    case "Link":
      if (value.value.external) return value.value.path;
      return value.value.display
        ? `[[${value.value.path}|${stringifyValue(value.value.display)}]]`
        : `[[${value.value.path}]]`;
    case "RegExp":
      return `/${value.value.source}/${value.value.flags}`;
    case "Image":
      return `![](${typeof value.value === "string" ? value.value : value.value.path})`;
    case "Error":
      return value.value.message;
  }
}

export function isTruthy(value: RuntimeValue): boolean {
  switch (value.type) {
    case "Null":
      return false;
    case "Boolean":
      return value.value;
    case "Number":
      return value.value !== 0 && !Number.isNaN(value.value);
    case "String":
      return value.value.length > 0;
    case "Error":
      return false;
    default:
      return true;
  }
}

export function isEmpty(value: RuntimeValue): boolean {
  switch (value.type) {
    case "Null":
      return true;
    case "String":
      return value.value.length === 0;
    case "Number":
      return Number.isNaN(value.value);
    case "List":
      return value.value.length === 0;
    case "Object":
      return Object.keys(value.value).length === 0;
    default:
      return false;
  }
}

export function parseDuration(input: string): Duration | null {
  const result: Duration = {
    years: 0,
    months: 0,
    weeks: 0,
    days: 0,
    hours: 0,
    minutes: 0,
    seconds: 0,
    milliseconds: 0,
  };
  const pattern = /([+-]?(?:\d+(?:\.\d+)?|\.\d+))\s*(years?|y|months?|M|weeks?|w|days?|d|hours?|h|minutes?|m|seconds?|s|milliseconds?|ms)\b/g;
  let matched = false;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(input.trim()))) {
    matched = true;
    const amount = Number(match[1]);
    const unit = match[2]!;
    if (unit === "y" || unit.startsWith("year")) result.years += amount;
    else if (unit === "M" || unit.startsWith("month")) result.months += amount;
    else if (unit === "w" || unit.startsWith("week")) result.weeks += amount;
    else if (unit === "d" || unit.startsWith("day")) result.days += amount;
    else if (unit === "h" || unit.startsWith("hour")) result.hours += amount;
    else if (unit === "m" || unit.startsWith("minute")) result.minutes += amount;
    else if (unit === "s" || unit.startsWith("second")) result.seconds += amount;
    else if (unit === "ms" || unit.startsWith("millisecond")) result.milliseconds += amount;
  }
  return matched ? result : null;
}

export function addDuration(date: Date, duration: Duration, direction = 1): Date {
  return moment(date)
    .add(direction * duration.years, "years")
    .add(direction * duration.months, "months")
    .add(direction * duration.weeks, "weeks")
    .add(direction * duration.days, "days")
    .add(direction * duration.hours, "hours")
    .add(direction * duration.minutes, "minutes")
    .add(direction * duration.seconds, "seconds")
    .add(direction * duration.milliseconds, "milliseconds")
    .toDate();
}

export function scaleDuration(duration: Duration, scale: number): Duration {
  return {
    years: duration.years * scale,
    months: duration.months * scale,
    weeks: duration.weeks * scale,
    days: duration.days * scale,
    hours: duration.hours * scale,
    minutes: duration.minutes * scale,
    seconds: duration.seconds * scale,
    milliseconds: duration.milliseconds * scale,
  };
}

export function durationToMilliseconds(duration: Duration): number {
  return (
    duration.milliseconds +
    duration.seconds * 1000 +
    duration.minutes * 60_000 +
    duration.hours * 3_600_000 +
    duration.days * 86_400_000 +
    duration.weeks * 604_800_000
  );
}

function formatDuration(duration: Duration): string {
  return moment
    .duration({
      years: duration.years,
      months: duration.months,
      weeks: duration.weeks,
      days: duration.days,
      hours: duration.hours,
      minutes: duration.minutes,
      seconds: duration.seconds,
      milliseconds: duration.milliseconds,
    })
    .humanize();
}

function formatDateValue(value: Extract<RuntimeValue, { type: "Date" }>): string {
  return moment(value.value).format(value.dateOnly ? "YYYY-MM-DD" : "YYYY-MM-DDTHH:mm:ss");
}
