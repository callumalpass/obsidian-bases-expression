#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const outputPath = resolve(root, "test/fixtures/oracle.generated.json");

const cases = [
  // Literals, property lookup, and operators.
  { name: "literal null", expression: "null" },
  { name: "literal true", expression: "true" },
  { name: "literal false", expression: "false" },
  { name: "literal number decimal", expression: "2.5" },
  { name: "literal string single quotes", expression: "'hello'" },
  { name: "bare note property", expression: "price" },
  { name: "note dot property", expression: "note.price" },
  { name: "note bracket property", expression: 'note["space key"]' },
  { name: "missing property", expression: "missing" },
  { name: "missing equals null", expression: "missing == null" },
  { name: "array index", expression: "[10,20,30][1]" },
  { name: "list property index", expression: "values[2]" },
  { name: "arithmetic precedence", expression: "1 + 2 * 3" },
  { name: "arithmetic grouping", expression: "(1 + 2) * 3" },
  { name: "arithmetic modulo", expression: "10 % 4" },
  { name: "arithmetic division", expression: "7 / 2" },
  { name: "unary minus", expression: "-price" },
  {
    name: "unary plus",
    expression: "+price",
    knownDivergence: "The package supports unary plus as a JavaScript-like operator, but the current internal parser rejects it.",
  },
  { name: "comparison greater equal", expression: "price >= 12.5" },
  { name: "comparison less equal", expression: "quantity <= 4" },
  { name: "comparison string", expression: '"b" > "a"' },
  { name: "equality string", expression: 'status == "Todo"' },
  { name: "inequality string", expression: 'status != "Done"' },
  { name: "boolean and", expression: 'status == "Todo" && price > 10' },
  { name: "boolean or", expression: 'status == "Done" || price > 10' },
  { name: "boolean not", expression: '!(status == "Done")' },

  // Global functions.
  { name: "if true branch", expression: 'if(status == "Todo", "yes", "no")' },
  { name: "if false branch", expression: 'if(status == "Done", "yes", "no")' },
  { name: "if implicit false branch", expression: 'if(status == "Done", "yes")' },
  { name: "escape html", expression: 'escapeHTML("<x>&")' },
  { name: "number from boolean true", expression: "number(true)" },
  { name: "number from boolean false", expression: "number(false)" },
  { name: "number from date", expression: 'number(date("1970-01-02"))' },
  { name: "number from numeric string", expression: 'number("3.4")' },
  { name: "min variadic", expression: "min(3, 1, 2)" },
  { name: "max variadic", expression: "max(3, 1, 2)" },
  { name: "list wraps string", expression: 'list("value")' },
  { name: "list leaves list", expression: "list([1,2])" },
  { name: "link stringify", expression: 'link("Some Note").toString()' },
  { name: "link with display stringify", expression: 'link("Some Note", "Shown").toString()' },
  { name: "file global path", expression: 'file("__codex_bases_expression_oracle/row.md").path' },
  { name: "html to string", expression: 'html("<b>x</b>").toString()' },
  { name: "icon to string", expression: 'icon("arrow-right").toString()' },
  { name: "image url to string", expression: 'image("https://obsidian.md/logo.png").toString()' },
  { name: "today date", expression: 'today().format("YYYY-MM-DD")' },
  { name: "now year", expression: "now().year" },
  { name: "random range", expression: "random()", assertion: "range01" },

  // Any type.
  {
    name: "any isTruthy number direct literal",
    expression: "1.isTruthy()",
    knownDivergence: "Public docs show direct numeric method syntax, but the current internal parser rejects it; parenthesized numeric literals work.",
  },
  {
    name: "any isTruthy zero direct literal",
    expression: "0.isTruthy()",
    knownDivergence: "Public docs show direct numeric method syntax, but the current internal parser rejects it; parenthesized numeric literals work.",
  },
  { name: "any isTruthy number", expression: "(1).isTruthy()" },
  { name: "any isTruthy zero", expression: "(0).isTruthy()" },
  { name: "any isTruthy empty string", expression: '"".isTruthy()' },
  { name: "any isType string", expression: '"example".isType("string")' },
  { name: "any isType boolean", expression: 'true.isType("boolean")' },
  { name: "any isType date", expression: 'date("2026-06-10").isType("date")' },
  {
    name: "any toString number direct literal",
    expression: "123.toString()",
    knownDivergence: "Public docs show direct numeric method syntax, but the current internal parser rejects it; parenthesized numeric literals work.",
  },
  { name: "any toString number", expression: "(123).toString()" },
  { name: "any toString boolean", expression: "true.toString()" },

  // String type.
  { name: "string length", expression: '"hello".length' },
  { name: "string contains", expression: '"hello".contains("ell")' },
  { name: "string contains all", expression: '"hello".containsAll("h", "e")' },
  { name: "string contains any", expression: '"hello".containsAny("x", "e")' },
  { name: "string ends with", expression: '"hello".endsWith("lo")' },
  { name: "string starts with", expression: '"hello".startsWith("he")' },
  { name: "string isEmpty false", expression: '"hello".isEmpty()' },
  { name: "string isEmpty true", expression: '"".isEmpty()' },
  { name: "string lower", expression: '"Hello".lower()' },
  { name: "string replace regex first", expression: '"a:b:c".replace(/:/, "-")' },
  { name: "string replace regex global", expression: '"a:b:c".replace(/:/g, "-")' },
  { name: "string replace string", expression: '"a:b:c".replace(":", "-")' },
  { name: "string repeat", expression: '"ab".repeat(3)' },
  { name: "string reverse", expression: '"hello".reverse()' },
  { name: "string slice", expression: '"hello".slice(1, 4)' },
  { name: "string slice omitted end", expression: '"hello".slice(2)' },
  { name: "string split", expression: '"a,b,c".split(",", 2)' },
  { name: "string split regex", expression: '"a,b,c".split(/,/, 2)' },
  { name: "string title", expression: '"hello world".title()' },
  { name: "string trim", expression: '"  hi  ".trim()' },

  // Number type.
  { name: "number abs", expression: "(-5).abs()" },
  { name: "number ceil", expression: "(2.1).ceil()" },
  { name: "number floor", expression: "(2.9).floor()" },
  {
    name: "number isEmpty false direct literal",
    expression: "5.isEmpty()",
    knownDivergence: "Public docs show direct numeric method syntax, but the current internal parser rejects it; parenthesized numeric literals work.",
  },
  { name: "number isEmpty false", expression: "(5).isEmpty()" },
  { name: "number round no digits", expression: "(2.5).round()" },
  { name: "number round digits", expression: "(2.3333).round(2)" },
  { name: "number fixed", expression: "(3.14159).toFixed(2)" },

  // Date and duration type.
  { name: "date parse date-only", expression: 'date("2026-06-10").toString()' },
  { name: "date parse datetime", expression: 'date("2026-06-10 12:34:56").toString()' },
  { name: "date format", expression: 'date("2026-06-10").format("YYYY-MM-DD")' },
  { name: "date field year", expression: 'date("2026-06-10 12:34:56").year' },
  { name: "date field month", expression: 'date("2026-06-10 12:34:56").month' },
  { name: "date field day", expression: 'date("2026-06-10 12:34:56").day' },
  { name: "date field hour", expression: 'date("2026-06-10 12:34:56").hour' },
  { name: "date field minute", expression: 'date("2026-06-10 12:34:56").minute' },
  { name: "date field second", expression: 'date("2026-06-10 12:34:56").second' },
  { name: "date strip time", expression: 'date("2026-06-10 12:34:56").date().toString()' },
  { name: "date time", expression: 'date("2026-06-10 12:34:56").time()' },
  { name: "date isEmpty", expression: 'date("2026-06-10").isEmpty()' },
  { name: "date arithmetic day", expression: 'date("2026-06-10 12:00:00") + "1d"' },
  { name: "date arithmetic month", expression: 'date("2026-12-01") + "1M"' },
  { name: "date arithmetic subtract hours", expression: 'date("2026-06-10 12:00:00") - "2h"' },
  { name: "date difference", expression: 'date("2026-06-11") - date("2026-06-10")' },
  { name: "date relative future", expression: 'date("2100-01-01").relative()' },
  { name: "duration year", expression: 'duration("1y").toString()' },
  { name: "duration month", expression: 'duration("1M").toString()' },
  { name: "duration week", expression: 'duration("2w").toString()' },
  { name: "duration day", expression: 'duration("1d").toString()' },
  { name: "duration hour", expression: 'duration("1h").toString()' },
  { name: "duration minute", expression: 'duration("30m").toString()' },
  { name: "duration second", expression: 'duration("45s").toString()' },
  { name: "duration scale", expression: '(duration("1h") * 2).toString()' },
  { name: "duration left scalar invalid", expression: '(2 * duration("1h")).toString()' },

  // List type.
  { name: "list length", expression: "[1,2,3].length" },
  { name: "list contains", expression: "[1,2,3].contains(2)" },
  { name: "list contains string", expression: '["a","b"].contains("b")' },
  { name: "list contains all", expression: "[1,2,3].containsAll(2, 3)" },
  { name: "list contains any", expression: "[1,2,3].containsAny(4, 3)" },
  { name: "list filter", expression: "[1,2,3,4].filter(value > 2)" },
  { name: "list filter index", expression: "[1,2,3,4].filter(index > 1)" },
  { name: "list flat", expression: "[1,[2,3]].flat()" },
  { name: "list isEmpty false", expression: "[1].isEmpty()" },
  { name: "list isEmpty true", expression: "[].isEmpty()" },
  { name: "list join", expression: '[1,2,3].join(",")' },
  { name: "list map", expression: "[1,2,3].map(value + index)" },
  { name: "list reduce", expression: "[1,2,3].reduce(acc + value, 0)" },
  { name: "list reverse", expression: "[1,2,3].reverse()" },
  { name: "list slice", expression: "[1,2,3,4].slice(1, 3)" },
  { name: "list slice omitted end", expression: "[1,2,3,4].slice(2)" },
  { name: "list sort numbers", expression: "[3,1,2].sort()" },
  { name: "list sort strings", expression: '["c","a","b"].sort()' },
  { name: "list unique numbers", expression: "[1,2,2,3].unique()" },
  { name: "list unique strings", expression: '["a","b","a"].unique()' },

  // Object type.
  {
    name: "object keys",
    expression: '{"a": 1, "b": 2}.keys()',
    knownDivergence: "Public docs describe object literals, but the current internal parser rejects them.",
  },
  {
    name: "object values",
    expression: '{"a": 1, "b": 2}.values()',
    knownDivergence: "Public docs describe object literals, but the current internal parser rejects them.",
  },
  {
    name: "object isEmpty",
    expression: '{"a": 1}.isEmpty()',
    knownDivergence: "Public docs describe object literals, but the current internal parser rejects them.",
  },

  // RegExp type.
  { name: "regex matches true", expression: '/abc/.matches("abcde")' },
  { name: "regex matches false", expression: '/abc/.matches("abxde")' },

  // File and link type.
  { name: "file name", expression: "file.name" },
  { name: "file basename", expression: "file.basename" },
  { name: "file path", expression: "file.path" },
  { name: "file folder", expression: "file.folder" },
  { name: "file ext", expression: "file.ext" },
  { name: "file size", expression: "file.size" },
  { name: "file properties price", expression: "file.properties.price" },
  { name: "file tags contains", expression: 'file.tags.contains("project/a")' },
  { name: "file links length", expression: "file.links.length" },
  { name: "file links rendered matrix", expression: "file.links.map(value.toString())" },
  { name: "file links as files matrix", expression: "file.links.map(value.asFile().path)" },
  { name: "file ordinary wikilink rendered", expression: "file.links[0].toString()" },
  { name: "file alias wikilink rendered", expression: "file.links[1].toString()" },
  { name: "file heading wikilink rendered", expression: "file.links[2].toString()" },
  { name: "file block wikilink rendered", expression: "file.links[3].toString()" },
  { name: "file duplicate wikilink resolves", expression: "file.links[4].asFile().path" },
  { name: "file full path duplicate resolves", expression: "file.links[6].asFile().path" },
  { name: "file unresolved wikilink as file", expression: "file.links[8].asFile().path" },
  { name: "file markdown link rendered", expression: "file.links[9].toString()" },
  { name: "file markdown encoded link rendered", expression: "file.links[10].toString()" },
  { name: "file markdown unresolved link rendered", expression: "file.links[11].toString()" },
  { name: "file markdown link as file", expression: "file.links[9].asFile().path" },
  { name: "file markdown encoded link as file", expression: "file.links[10].asFile().path" },
  { name: "file markdown unresolved link as file", expression: "file.links[11].asFile().path" },
  { name: "file embeds length", expression: "file.embeds.length" },
  { name: "file embeds rendered matrix", expression: "file.embeds.map(value.toString())" },
  { name: "file embeds as files matrix", expression: "file.embeds.map(value.asFile().path)" },
  { name: "file backlinks length", expression: "file.backlinks.length" },
  { name: "file backlinks rendered matrix", expression: "file.backlinks.map(value.toString())" },
  { name: "file has link", expression: 'file.hasLink("Other.md")' },
  { name: "file has raw basename link", expression: 'file.hasLink("Other")' },
  { name: "file has full path link", expression: 'file.hasLink("__codex_bases_expression_oracle/Other.md")' },
  { name: "file has heading link", expression: 'file.hasLink("Other#Section One")' },
  { name: "file has block link", expression: 'file.hasLink("Other#^block-id")' },
  { name: "file has duplicate basename link", expression: 'file.hasLink("Duplicate")' },
  { name: "file has duplicate full path A link", expression: 'file.hasLink("__codex_bases_expression_oracle/Folder A/Duplicate.md")' },
  { name: "file has duplicate full path B link", expression: 'file.hasLink("__codex_bases_expression_oracle/Folder B/Duplicate.md")' },
  { name: "file has spaced alias link", expression: 'file.hasLink("Spaced Note")' },
  { name: "file has unresolved raw link", expression: 'file.hasLink("Missing Note")' },
  { name: "file has unresolved md link", expression: 'file.hasLink("Missing Note.md")' },
  { name: "file has markdown encoded md link", expression: 'file.hasLink("Spaced Note.md")' },
  { name: "file has markdown unresolved md link", expression: 'file.hasLink("Missing.md")' },
  { name: "file does not have external markdown link", expression: 'file.hasLink("https://example.com/path")' },
  { name: "file has property", expression: 'file.hasProperty("price")' },
  { name: "file has tag direct", expression: 'file.hasTag("work")' },
  { name: "file has tag nested", expression: 'file.hasTag("project")' },
  { name: "file in folder", expression: 'file.inFolder("__codex_bases_expression_oracle")' },
  { name: "file as link", expression: "file.asLink().toString()" },
  { name: "file as link display", expression: 'file.asLink("Shown").toString()' },
  { name: "file global basename lookup", expression: 'file("Other").path' },
  { name: "file global md lookup", expression: 'file("Other.md").path' },
  { name: "file global unresolved lookup", expression: 'file("Missing Note").path' },
  { name: "file global spaced lookup", expression: 'file("Spaced Note").path' },
  { name: "link as file", expression: 'link("__codex_bases_expression_oracle/row.md").asFile().path' },
  { name: "link basename as file", expression: 'link("Other").asFile().path' },
  { name: "link md as file", expression: 'link("Other.md").asFile().path' },
  { name: "link heading as file", expression: 'link("Other#Section One").asFile().path' },
  { name: "link block as file", expression: 'link("Other#^block-id").asFile().path' },
  { name: "link duplicate as file", expression: 'link("Duplicate").asFile().path' },
  { name: "link unresolved as file", expression: 'link("Missing Note").asFile().path' },
  { name: "link markdown unresolved as file", expression: 'link("Missing.md").asFile().path' },
  { name: "link spaced as file", expression: 'link("Spaced Note").asFile().path' },
  { name: "link equals file", expression: 'link("__codex_bases_expression_oracle/row.md") == file' },
  { name: "link aliases equal", expression: 'file.links[1] == link("Other")' },
  { name: "link md variant equals basename", expression: 'link("Other.md") == link("Other")' },
  { name: "link subpath equals basename", expression: 'link("Other#Section One") == link("Other")' },
  { name: "markdown link equals wikilink", expression: 'file.links[9] == link("Other")' },
  { name: "links contains alias variant", expression: 'file.links.contains(link("Other", "Alias Other"))' },
  { name: "links contains unresolved", expression: 'file.links.contains(link("Missing Note"))' },
  { name: "links contains file lookup", expression: 'file.links.contains(file("Other"))' },
  { name: "links filter resolved file equality", expression: 'file.links.filter(value == link("Other")).length' },
  { name: "links filter duplicate equality", expression: 'file.links.filter(value == link("Duplicate")).length' },
  { name: "links unique resolved count", expression: "file.links.unique().length" },
  { name: "link path field", expression: 'link("Some Note").path' },

  // Formula and this context.
  { name: "formula ref", expression: "formula.total" },
  { name: "formula chain", expression: "formula.label" },
  { name: "this file path", expression: "this.file.path" },

  // Invalid/runtime behavior.
  { name: "invalid number conversion", expression: 'number("nope")' },
  { name: "unknown function", expression: "doesNotExist()" },
];

const context = {
  now: "2026-06-10T12:34:56",
  note: {
    price: 12.5,
    quantity: 4,
    status: "Todo",
    tags: ["urgent", "work"],
    values: [1, 2, 3],
    "space key": "space value",
  },
  propertyTypes: {},
  file: {
    path: "__codex_bases_expression_oracle/row.md",
    name: "row.md",
    basename: "row",
    folder: "__codex_bases_expression_oracle",
    ext: "md",
    size: 123,
    tags: ["urgent", "work", "project/a"],
    links: [],
    embeds: [],
    backlinks: [],
    ctime: "2026-01-01T00:00:00",
    mtime: "2026-06-09T10:00:00",
  },
  files: [],
  linkResolutions: {},
  formulas: {
    total: "price * quantity",
    label: 'status + " " + formula.total.toString()',
  },
};

const code = `
(async () => {
  const cases = ${JSON.stringify(cases)};
  const context = ${JSON.stringify(context)};
  const dir = "__codex_bases_expression_oracle";
  const basePath = dir + "/oracle.base";
  const otherPath = dir + "/Other.md";
  const duplicateAPath = dir + "/Folder A/Duplicate.md";
  const duplicateBPath = dir + "/Folder B/Duplicate.md";
  const spacedPath = dir + "/Spaced Note.md";
  const embeddedPath = dir + "/Embedded Note.md";
  const backlinkPath = dir + "/Backlink Source.md";
  const notePath = context.file.path;
  let scratchLeaf = null;
  const cleanup = async () => {
    if (scratchLeaf) {
      await scratchLeaf.detach();
      scratchLeaf = null;
    }
    const folder = app.vault.getAbstractFileByPath(dir);
    if (folder) await app.vault.delete(folder, true);
  };
  const waitFor = async (predicate, label, timeoutMs = 5000) => {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const value = predicate();
      if (value) return value;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error("Timed out waiting for " + label);
  };
  const stripSubpath = (link) => {
    const hash = link.indexOf("#");
    return hash < 0 ? link : link.slice(0, hash);
  };
  const ensureMd = (path) => {
    const hash = path.indexOf("#");
    const head = hash < 0 ? path : path.slice(0, hash);
    const tail = hash < 0 ? "" : path.slice(hash);
    return /\\.[^/.]+$/.test(head) ? path : head + ".md" + tail;
  };
  const withoutMd = (path) => path.replace(/\\.md(?=#|$)/, "");
  const basename = (path) => {
    const name = path.split("/").pop() ?? path;
    return withoutMd(name);
  };
  const defaultDisplay = (link) => {
    const base = stripSubpath(link);
    const subpath = link.slice(base.length + 1);
    const label = base.includes("/") ? base : basename(base);
    return subpath ? label + " > " + subpath : label;
  };
  const hasExplicitDisplay = (linkCache) => (linkCache.original?.includes("|") ?? false) || /!?\\[[^\\]]*\\]\\(/.test(linkCache.original ?? "");
  const linkDisplay = (linkCache) => hasExplicitDisplay(linkCache) ? linkCache.displayText : defaultDisplay(linkCache.link);
  const fileRecord = (file) => ({
    path: file.path,
    name: file.name,
    basename: file.basename,
    folder: file.parent?.path ?? "",
    ext: file.extension,
    size: file.stat.size,
    properties: {},
    tags: [],
    links: [],
    embeds: [],
    backlinks: [],
    ctime: new Date(file.stat.ctime).toISOString(),
    mtime: new Date(file.stat.mtime).toISOString(),
  });
  const setResolution = (resolutions, key, value) => {
    if (!Object.prototype.hasOwnProperty.call(resolutions, key)) resolutions[key] = value;
  };
  const addResolution = (resolutions, link, sourcePath) => {
    const base = stripSubpath(link);
    const dest = app.metadataCache.getFirstLinkpathDest(base, sourcePath)?.path ?? null;
    for (const key of new Set([link, base, ensureMd(link), ensureMd(base), withoutMd(link), withoutMd(base)])) {
      setResolution(resolutions, key, dest);
    }
    return dest;
  };
  const addFileResolutions = (resolutions, files) => {
    for (const file of files) {
      setResolution(resolutions, file.path, file.path);
      setResolution(resolutions, withoutMd(file.path), file.path);
      setResolution(resolutions, file.name, file.path);
      setResolution(resolutions, file.basename, file.path);
    }
  };
  const linkRecord = (linkCache, sourcePath, resolutions) => ({
    path: linkCache.link,
    display: linkDisplay(linkCache),
    resolvedPath: addResolution(resolutions, linkCache.link, sourcePath),
  });
  const backlinkRecord = (path) => ({
    path,
    display: basename(path),
    resolvedPath: path,
  });
  const normalize = (value) => {
    if (value === null || value === undefined) return null;
    if (typeof value !== "object") return value;
    const type = value.constructor?.type ?? value.constructor?.name;
    if (type === "Null") return null;
    if (type === "Error") return { error: value.message ?? value.toString?.() };
    if ("data" in value) {
      if (Array.isArray(value.data)) return value.data.map(normalize);
      if (value.data instanceof Date) return moment(value.data).format("YYYY-MM-DD HH:mm:ss");
      if (value.data && typeof value.data === "object") {
        return Object.fromEntries(Object.entries(value.data).map(([key, item]) => [key, normalize(item)]));
      }
      return value.data;
    }
    if (type === "Date" && value.moment) return value.moment.format("YYYY-MM-DD HH:mm:ss");
    return value.toString?.() ?? String(value);
  };
  try {
    await cleanup();
    await app.vault.createFolder(dir);
    await app.vault.createFolder(dir + "/Folder A");
    await app.vault.createFolder(dir + "/Folder B");
    const other = await app.vault.create(otherPath, "---\\nstatus: Other\\n---\\nOther note\\n\\n## Section One\\nHeading target\\n\\nBlock target ^block-id\\n");
    const duplicateA = await app.vault.create(duplicateAPath, "---\\nstatus: Duplicate A\\n---\\nDuplicate A\\n");
    const duplicateB = await app.vault.create(duplicateBPath, "---\\nstatus: Duplicate B\\n---\\nDuplicate B\\n");
    const spaced = await app.vault.create(spacedPath, "---\\nstatus: Spaced\\n---\\nSpaced note\\n");
    const embedded = await app.vault.create(embeddedPath, "---\\nstatus: Embedded\\n---\\nEmbedded note\\n");
    const note = await app.vault.create(notePath, "---\\nprice: 12.5\\nquantity: 4\\nstatus: Todo\\ntags:\\n  - urgent\\n  - work\\nvalues:\\n  - 1\\n  - 2\\n  - 3\\nspace key: space value\\n---\\nBody #project/a links to [[Other]]\\nAlias: [[Other|Alias Other]]\\nHeading: [[Other#Section One]]\\nBlock: [[Other#^block-id]]\\nDuplicate ambiguous: [[Duplicate]]\\nDuplicate A: [[__codex_bases_expression_oracle/Folder A/Duplicate|Dup A]]\\nDuplicate B: [[__codex_bases_expression_oracle/Folder B/Duplicate]]\\nSpaced alias: [[Spaced Note|Space Alias]]\\nMissing: [[Missing Note]]\\nMarkdown note: [Markdown Other](Other.md)\\nMarkdown encoded: [Markdown Space](Spaced%20Note.md)\\nMarkdown missing: [Markdown Missing](Missing.md)\\nExternal markdown: [Example](https://example.com/path)\\nEmbed note: ![[Embedded Note]]\\nEmbed heading: ![[Other#Section One]]\\n");
    const backlinkSource = await app.vault.create(backlinkPath, "Links back to [[__codex_bases_expression_oracle/row.md]] and [[__codex_bases_expression_oracle/row.md|Row Alias]].\\n");
    let linkMetadataLast = {};
    const linkMetadata = await waitFor(() => {
      const cache = app.metadataCache.getFileCache(note);
      const backlinks = app.metadataCache.getBacklinksForFile(note);
      const backlinkPaths = backlinks?.data instanceof Map ? Array.from(backlinks.data.keys()) : Object.keys(backlinks?.data ?? {});
      const backlinkCount = backlinkPaths.length;
      linkMetadataLast = {
        links: cache?.links?.length ?? 0,
        embeds: cache?.embeds?.length ?? 0,
        backlinkCount,
        linkTargets: (cache?.links ?? []).map((link) => link.link),
        embedTargets: (cache?.embeds ?? []).map((link) => link.link),
        backlinkPaths,
      };
      if ((cache?.links?.length ?? 0) >= 12 && (cache?.embeds?.length ?? 0) >= 2 && backlinkCount >= 1) {
        return { cache, backlinks };
      }
      return null;
    }, "link metadata matrix", 20000).catch((error) => {
      throw new Error((error?.message ?? String(error)) + " " + JSON.stringify(linkMetadataLast));
    });
    const base = await app.vault.create(basePath, "formulas:\\n  seed: \\"1\\"\\nviews:\\n  - type: table\\n    name: Oracle\\n");
    scratchLeaf = app.workspace.getLeaf(true);
    await scratchLeaf.openFile(base);
    const controller = await waitFor(
      () => scratchLeaf?.view?.controller?.ctx?.formulas?.seed && scratchLeaf.view.controller,
      "visible scratch Base controller"
    );
    const FormulaCtor = Object.getPrototypeOf(controller.ctx.formulas.seed).constructor;
    const ContextCtor = Object.getPrototypeOf(controller.ctx).constructor;
    context.now = new Date().toISOString();
    const allFiles = [note, other, duplicateA, duplicateB, spaced, embedded, backlinkSource];
    const linkResolutions = {};
    addFileResolutions(linkResolutions, allFiles);
    const links = [
      ...(linkMetadata.cache.links ?? []).map((link) => linkRecord(link, note.path, linkResolutions)),
      ...(linkMetadata.cache.embeds ?? []).map((link) => linkRecord(link, note.path, linkResolutions)),
    ];
    const embeds = (linkMetadata.cache.embeds ?? []).map((link) => linkRecord(link, note.path, linkResolutions));
    const backlinkPaths = (linkMetadata.backlinks?.data instanceof Map ? Array.from(linkMetadata.backlinks.data.keys()) : Object.keys(linkMetadata.backlinks?.data ?? {})).sort();
    const backlinks = backlinkPaths.map(backlinkRecord);
    context.file = {
      ...context.file,
      path: note.path,
      name: note.name,
      basename: note.basename,
      folder: note.parent?.path ?? "",
      ext: note.extension,
      size: note.stat.size,
      properties: context.note,
      ctime: new Date(note.stat.ctime).toISOString(),
      mtime: new Date(note.stat.mtime).toISOString(),
      links,
      embeds,
      backlinks,
    };
    context.files = [context.file, ...allFiles.filter((file) => file.path !== note.path).map(fileRecord)];
    context.linkResolutions = linkResolutions;
    const formulas = Object.fromEntries(Object.entries(context.formulas).map(([name, formula]) => [name, new FormulaCtor(formula)]));
    const ctx = new ContextCtor(app, null, formulas, note);
    const results = [];
    for (const testCase of cases) {
      const formula = new FormulaCtor(testCase.expression);
      let result;
      try {
        result = normalize(formula.getValue(ctx.local));
      } catch (error) {
        result = { error: error?.message ?? String(error) };
      }
      results.push({ ...testCase, context, expected: result });
    }
    await cleanup();
    console.log("ORACLE_JSON_START" + JSON.stringify({ generatedAt: new Date().toISOString(), cases: results }) + "ORACLE_JSON_END");
  } catch (error) {
    await cleanup().catch(() => {});
    console.log("ORACLE_ERROR", error?.stack ?? error?.message ?? String(error));
  }
})()
`;

const result = spawnSync("obsidian", ["vault=test", "eval", `code=${code}`], {
  encoding: "utf8",
  maxBuffer: 1024 * 1024 * 20,
});

if (result.error) throw result.error;
if (result.status !== 0) {
  process.stderr.write(result.stderr);
  process.stdout.write(result.stdout);
  process.exit(result.status ?? 1);
}

const output = `${result.stdout}\n${result.stderr}`;
const match = output.match(/ORACLE_JSON_START(.*)ORACLE_JSON_END/s);
if (!match) {
  console.error("Could not find oracle JSON in Obsidian CLI output.");
  console.error(output);
  process.exit(1);
}

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(JSON.parse(match[1]), null, 2)}\n`);
console.log(`Wrote ${outputPath}`);
