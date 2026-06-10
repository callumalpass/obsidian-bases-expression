import type { Expression } from "./ast.js";
import type { EvaluationContext } from "./evaluator.js";
import { fromJs, linkValue, type FileValueInput, type LinkValueInput, type RuntimeValue } from "./value.js";

export type PropertyValueType = NonNullable<EvaluationContext["propertyTypes"]>[string];

export interface ContextFileInput extends Omit<FileValueInput, "path" | "properties"> {
  path: string;
  properties?: Record<string, unknown>;
}

export interface LinkResolutionEntry {
  target: string;
  resolvedPath: string | null;
}

export interface EvaluationContextInput {
  note?: Record<string, unknown>;
  properties?: Record<string, unknown>;
  objects?: Record<string, unknown>;
  propertyTypes?: Record<string, PropertyValueType>;
  file?: Partial<ContextFileInput> & { path?: string };
  thisFile?: Partial<ContextFileInput> & { path?: string };
  files?: ContextFileInput[];
  links?: LinkValueInput[];
  embeds?: LinkValueInput[];
  backlinks?: LinkValueInput[];
  linkResolutions?: Record<string, string | null> | LinkResolutionEntry[];
  formulas?: Record<string, string | Expression>;
  now?: Date | string | number;
  random?: () => number;
  functions?: EvaluationContext["functions"];
}

export interface BasesRowLike {
  path?: string;
  file?: Partial<ContextFileInput> & { path?: string };
  properties?: Record<string, unknown>;
  note?: Record<string, unknown>;
  links?: LinkValueInput[];
  embeds?: LinkValueInput[];
  backlinks?: LinkValueInput[];
}

export interface FrontmatterOptions {
  propertyTypes?: Record<string, PropertyValueType> | undefined;
  linkResolutions?: Record<string, string | null> | undefined;
}

export function createEvaluationContext(input: EvaluationContextInput = {}): EvaluationContext {
  const normalizedInputResolutions = normalizeResolutionInput(input.linkResolutions);
  const frontmatterOptions: FrontmatterOptions = { linkResolutions: normalizedInputResolutions };
  if (input.propertyTypes) frontmatterOptions.propertyTypes = input.propertyTypes;
  const note = normalizeFrontmatterProperties(input.note ?? input.properties ?? {}, frontmatterOptions);
  const files = input.files?.map(createFileContext) ?? [];
  const currentFileInput: ContextFileInput = {
    ...(input.file ?? {}),
    path: input.file?.path ?? "",
    properties: input.file?.properties ?? note,
  };
  const currentLinks = input.file?.links ?? input.links;
  const currentEmbeds = input.file?.embeds ?? input.embeds;
  const currentBacklinks = input.file?.backlinks ?? input.backlinks;
  if (currentLinks) currentFileInput.links = currentLinks;
  if (currentEmbeds) currentFileInput.embeds = currentEmbeds;
  if (currentBacklinks) currentFileInput.backlinks = currentBacklinks;
  const currentFile = createFileContext(currentFileInput);
  const thisFile = input.thisFile ? createFileContext({ ...input.thisFile, path: input.thisFile.path ?? "" }) : undefined;
  const allFiles = mergeFiles(currentFile.path ? [currentFile, ...files] : files);
  const linkResolutions = {
    ...createLinkResolutionMap(allFiles),
    ...normalizedInputResolutions,
  };

  const context: EvaluationContext = {
    note,
    file: currentFile,
    files: allFiles,
    linkResolutions,
  };
  if (input.objects) context.objects = input.objects;
  if (thisFile) context.thisFile = thisFile;
  if (input.formulas) context.formulas = input.formulas;
  if (input.propertyTypes) context.propertyTypes = input.propertyTypes;
  if (input.now !== undefined) context.now = input.now;
  if (input.random) context.random = input.random;
  if (input.functions) context.functions = input.functions;
  return context;
}

export function createContextFromRow(row: BasesRowLike, defaults: Omit<EvaluationContextInput, "note" | "file" | "links" | "embeds" | "backlinks"> = {}): EvaluationContext {
  const rowProperties = row.properties ?? row.note ?? {};
  const input: EvaluationContextInput = {
    ...defaults,
    note: rowProperties,
    file: {
      ...(row.file ?? {}),
      path: row.file?.path ?? row.path ?? "",
      properties: row.file?.properties ?? rowProperties,
    },
  };
  const links = row.file?.links ?? row.links;
  const embeds = row.file?.embeds ?? row.embeds;
  const backlinks = row.file?.backlinks ?? row.backlinks;
  if (links) input.links = links;
  if (embeds) input.embeds = embeds;
  if (backlinks) input.backlinks = backlinks;
  return createEvaluationContext(input);
}

export function createFileContext(input: ContextFileInput): FileValueInput {
  const name = input.name ?? input.path.split("/").pop() ?? input.path;
  const dot = name.lastIndexOf(".");
  const ext = input.ext ?? (dot >= 0 ? name.slice(dot + 1) : "");
  const basename = input.basename ?? (dot >= 0 ? name.slice(0, dot) : name);
  const slash = input.path.lastIndexOf("/");
  return {
    ...input,
    path: input.path,
    name,
    basename,
    folder: input.folder ?? (slash >= 0 ? input.path.slice(0, slash) : ""),
    ext,
    size: input.size ?? 0,
    properties: input.properties ?? {},
    tags: input.tags ?? [],
    links: input.links ?? [],
    embeds: input.embeds ?? [],
    backlinks: input.backlinks ?? [],
    ctime: input.ctime ?? new Date(0),
    mtime: input.mtime ?? new Date(0),
  };
}

export function normalizeFrontmatterProperties(properties: Record<string, unknown>, options: FrontmatterOptions = {}): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(properties)) {
    output[key] = normalizeFrontmatterValue(value, options.propertyTypes?.[key], options.linkResolutions);
  }
  return output;
}

export function normalizeFrontmatterValue(
  value: unknown,
  type?: PropertyValueType,
  linkResolutions: Record<string, string | null> = {},
): unknown {
  if (type === "date") return value;
  if (type !== "link") return value;
  if (Array.isArray(value)) return value.map((item) => normalizeFrontmatterValue(item, type, linkResolutions));
  if (isRuntimeValue(value)) return value;
  if (typeof value !== "string") return value;
  const parsed = parseLinkText(value);
  return frontmatterLink(parsed.target, parsed.display, resolveFromTable(parsed.target, linkResolutions));
}

export function frontmatterLink(target: string, display?: unknown, resolvedPath?: string | null): RuntimeValue {
  return linkValue(target, display === undefined ? undefined : fromJs(display), resolvedPath);
}

export function createLinkResolutionMap(files: FileValueInput[] = [], entries: LinkResolutionEntry[] = []): Record<string, string | null> {
  const map: Record<string, string | null> = {};
  for (const file of files) addFileResolution(map, file);
  for (const entry of entries) addLinkResolution(map, entry.target, entry.resolvedPath);
  return map;
}

export function addLinkResolution(map: Record<string, string | null>, target: string, resolvedPath: string | null): Record<string, string | null> {
  for (const key of linkResolutionKeys(target)) {
    if (!Object.prototype.hasOwnProperty.call(map, key)) map[key] = resolvedPath;
  }
  return map;
}

function addFileResolution(map: Record<string, string | null>, file: FileValueInput): void {
  const normalized = createFileContext(file);
  const keys = [normalized.path, withoutMarkdownExtension(normalized.path), normalized.name, normalized.basename].filter((key): key is string => Boolean(key));
  for (const key of keys) {
    map[key] = normalized.path;
    map[key.toLowerCase()] = normalized.path;
  }
}

function normalizeResolutionInput(input: EvaluationContextInput["linkResolutions"]): Record<string, string | null> {
  if (!input) return {};
  if (!Array.isArray(input)) return { ...input };
  const map: Record<string, string | null> = {};
  for (const entry of input) addLinkResolution(map, entry.target, entry.resolvedPath);
  return map;
}

function mergeFiles(files: FileValueInput[]): FileValueInput[] {
  const seen = new Set<string>();
  return files.filter((file) => {
    if (seen.has(file.path)) return false;
    seen.add(file.path);
    return true;
  });
}

function parseLinkText(input: string): { target: string; display?: string } {
  let value = input.trim();
  if (value.startsWith("!")) value = value.slice(1).trim();
  if (value.startsWith("[[") && value.endsWith("]]")) value = value.slice(2, -2);
  const pipe = value.indexOf("|");
  if (pipe < 0) return { target: value };
  return { target: value.slice(0, pipe), display: value.slice(pipe + 1) };
}

function resolveFromTable(target: string, table: Record<string, string | null>): string | null | undefined {
  for (const key of linkResolutionKeys(target)) {
    if (Object.prototype.hasOwnProperty.call(table, key)) return table[key] ?? null;
  }
  return undefined;
}

function linkResolutionKeys(target: string): string[] {
  const base = stripLinkSubpath(target);
  return [...new Set([target, base, ensureMarkdownExtension(target), ensureMarkdownExtension(base), withoutMarkdownExtension(target), withoutMarkdownExtension(base)])];
}

function stripLinkSubpath(target: string): string {
  const hash = target.indexOf("#");
  return hash < 0 ? target : target.slice(0, hash);
}

function ensureMarkdownExtension(path: string): string {
  const hash = path.indexOf("#");
  const head = hash < 0 ? path : path.slice(0, hash);
  const tail = hash < 0 ? "" : path.slice(hash);
  return /\.[^/.]+$/.test(head) ? path : `${head}.md${tail}`;
}

function withoutMarkdownExtension(path: string): string {
  return path.replace(/\.md(?=#|$)/, "");
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
