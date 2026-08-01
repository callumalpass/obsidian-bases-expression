# obsidian-bases-expression

`obsidian-bases-expression` is a standalone TypeScript runtime for the expression language used by Obsidian Bases filters and formulas.

It is meant for projects that want behavior compatible with the observed Obsidian Bases runtime without depending on Obsidian internals: command-line tools, tests, workflow engines, companion plugins, and Obsidian plugins that need to evaluate or validate user-authored expressions outside the native Bases view.

The core package is headless. It does not ship Obsidian view components directly. Use the companion `obsidian-bases-expression-builder` package when you want a native Obsidian expression-builder UI.

## What It Provides

- A parser and evaluator for Bases-style expressions.
- Context builders for note properties, file metadata, links, formulas, and host-provided objects.
- Structured filter evaluation for Bases-style `and`, `or`, and `not` trees.
- Diagnostics, dependency inspection, completions, hover info, signature help, and CodeMirror-shaped adapters.
- Headless builder primitives for condition/group trees, type-aware operators, serialization, simple-expression parsing, and validation.
- Conservative note-creation default inference from positive filters.
- Oracle-backed compatibility tests against a running Obsidian app.

## Why This Exists

Obsidian Bases expressions are useful outside `.base` files. The same expression model can describe:

- whether a note belongs in a view
- whether a saved search or dashboard should include a file
- whether an automation rule should run for a note
- which properties a newly created note needs so it remains visible in a filtered view
- how a CLI or test runner should evaluate Bases-like configuration

This package keeps those concerns on a shared expression contract instead of each consumer inventing its own mini-language.

## Install

```bash
npm install obsidian-bases-expression
```

## Quick Start

```ts
import {
  compileExpression,
  createEvaluationContext,
  evaluateToPlain,
} from "obsidian-bases-expression";

const context = createEvaluationContext({
  note: {
    status: "Todo",
    priority: 3,
  },
  file: {
    path: "Tasks/Write proposal.md",
    tags: ["work", "project/client-a"],
  },
});

const visible = evaluateToPlain(
  'status == "Todo" && file.hasTag("project")',
  context,
);

const predicate = compileExpression("priority >= 2");
const important = predicate.evaluateToPlain(context);

console.log({ visible, important });
```

## Expressions

The runtime follows observed Obsidian Bases behavior when the public docs and the app differ.

Supported expression features include:

- literals: strings, numbers, booleans, `null`, lists, and regular expressions
- operators: arithmetic, comparison, boolean logic, unary operators, and grouping
- property access: bare note fields, `note.*`, `file.*`, `formula.*`, `this.*`, brackets, and list indexes
- global functions such as `date()`, `today()`, `number()`, `link()`, `file()`, `list()`, `min()`, and `max()`
- typed methods for strings, numbers, dates, durations, lists, objects, regexes, files, and links
- list `map`, `filter`, and `reduce` using `value`, `index`, and `acc`

Object values are supported when they come from the runtime context, such as `file.properties`, `note`, or host-provided `objects`. Object literal syntax such as `{"a": 1}` is rejected to match the observed Obsidian Bases parser.

Runtime failures return structured error values during normal evaluation. Use `throwOnError` when integrating with code paths that should fail fast.

```ts
import { evaluateToPlain } from "obsidian-bases-expression";

evaluateToPlain("number('nope')", {}, { throwOnError: true });
```

## Evaluation Contexts

Expressions operate on plain JavaScript data. `createEvaluationContext()` normalizes the common Obsidian-shaped pieces:

```ts
import { createEvaluationContext, evaluateToPlain } from "obsidian-bases-expression";

const context = createEvaluationContext({
  note: {
    due: "2026-06-12",
    project: "[[Client A]]",
  },
  propertyTypes: {
    due: "date",
    project: "link",
  },
  file: {
    path: "Tasks/Follow up.md",
    links: [{ path: "Client A", resolvedPath: "Projects/Client A.md" }],
  },
  files: [{ path: "Projects/Client A.md" }],
});

const result = evaluateToPlain(
  'due < today() || project.asFile().folder == "Projects"',
  context,
);
```

Host applications can also provide named object roots. These are useful for workflow events, canvas zones, action results, or other data that should not be treated as note frontmatter.

```ts
const context = createEvaluationContext({
  note: { status: "Todo" },
  objects: {
    trigger: { type: "drag", zone: { id: "doing" } },
    steps: { query: { total: 4 } },
  },
});

evaluateToPlain(
  'trigger.type == "drag" && trigger.zone.id == "doing" && steps.query.total > 0',
  context,
);
```

Reserved roots such as `file`, `note`, `formula`, `this`, and `values` keep their Bases meaning.

For an mdbase v0.3 query adapter, pass `thisRecord` to bind the complete
portable invocation context. It exposes effective fields at `this.<field>`,
the `this.record`/`this.note` aliases, persisted `this.raw` values, effective
and raw presence maps, and `this.file`. Pass `null` explicitly when the query
has no invocation context; the existing `this.file` fallback remains the
default for ordinary Obsidian Bases evaluation.

```ts
const context = createEvaluationContext({
  note: candidateFrontmatter,
  file: { path: candidatePath },
  thisRecord: project
    ? {
        record: project.effective,
        raw: project.raw,
        knownFields: project.knownFields,
        file: { path: project.path },
      }
    : null,
});
```

The package also exposes `convertObsidianBaseToMdbaseView()` and
`translateObsidianExpressionToMdbase()` for importing `.base` data into the
canonical mdbase v0.3 view-record shape. The converter maps global filters into
the nested shared `query`, formulas into projections, column order into
selection, sorting/grouping/summaries into their query equivalents, and the
renderer into advisory presentation metadata. It returns an executable
`record` only when every expression has a behavior-preserving translation;
otherwise `record` is null, diagnostics identify the unsupported dialect
features, and an inspectable `draft` retains the lossless source under
`x-obsidian`.

## Structured Filters

Bases filters are either expression strings or recursive filter objects. `compileFilter()` evaluates that shape directly:

```ts
import { compileFilter, createEvaluationContext } from "obsidian-bases-expression";

const filter = compileFilter({
  and: [
    'status == "Todo"',
    {
      or: [
        "priority >= 2",
        'file.hasTag("urgent")',
      ],
    },
  ],
});

const context = createEvaluationContext({
  note: { status: "Todo", priority: 1 },
  file: { path: "Tasks/A.md", tags: ["urgent"] },
});

const matches = filter.evaluateToBoolean(context);
```

Filter objects accept exactly one of `and`, `or`, or `not`. A `not` list is treated as `not(and(...))`.

## Language Tooling

The language-service helpers are designed for editors and settings screens. They return plain data rather than rendering UI.

```ts
import {
  completeExpression,
  toCodeMirrorCompletions,
  validateExpressionDetailed,
  type FormulaLanguageSchema,
} from "obsidian-bases-expression";

const schema: FormulaLanguageSchema = {
  properties: [
    {
      name: "status",
      type: "string",
      values: [
        { value: "Todo", label: "Todo", count: 3 },
        { value: "Done", label: "Done", count: 1 },
      ],
    },
    { name: "priority", type: "number" },
    { name: "due", type: "date" },
  ],
  objects: [
    {
      name: "trigger",
      type: "object",
      properties: [
        { name: "type", type: "string" },
        {
          name: "zone",
          type: "object",
          properties: [{ name: "id", type: "string" }],
        },
      ],
    },
  ],
};

const validation = validateExpressionDetailed(
  'status == "Todo" && trigger.zone.id == "doing"',
  schema,
);

const completions = toCodeMirrorCompletions(
  completeExpression("trigger.zone.", "trigger.zone.".length, schema),
);

console.log(validation.dependencies, completions);
```

Available tooling includes:

- `validateExpression()` and `validateExpressionDetailed()`
- `inspectExpression()` and `getExpressionDependencies()`
- `completeExpression()`
- `getHoverInfo()`
- `getSignatureHelp()`
- `toCodeMirrorCompletions()`
- `toCodeMirrorDiagnostics()`

Completions are context-aware. In value positions such as `status == "T`, `completeExpression()` can return schema-backed value suggestions with replacement ranges. In typed positions such as `due < ` or `priority.round(`, it suggests compatible properties, literals, and functions instead of the full global list. Validation also reports conservative `type-mismatch` warnings for obvious literal mistakes while allowing common coercions such as numeric strings and ISO date strings.

These APIs are enough for consumers to build their own expression editors or filter builders, but this package intentionally does not include one.

## Builder Primitives

The core package includes a headless builder model for plugins and tools that want to store or edit expressions as structured UI state before serializing them back to Bases syntax.

```ts
import {
  createBuilderCondition,
  createBuilderGroup,
  serializeBuilderNode,
  validateBuilderNode,
  type FormulaLanguageSchema,
} from "obsidian-bases-expression";

const schema: FormulaLanguageSchema = {
  properties: [
    {
      name: "status",
      type: "string",
      values: [
        { value: "Todo", label: "Todo" },
        { value: "Done", label: "Done" },
      ],
    },
    { name: "priority", type: "number" },
  ],
};

const filter = createBuilderGroup([
  createBuilderCondition("status", "is", "Todo"),
  createBuilderCondition("priority", "greater-than-or-equal", 2),
]);

console.log(serializeBuilderNode(filter, { schema }));
// (status == "Todo") && (priority >= 2)

console.log(validateBuilderNode(filter, schema).valid);
```

Builder APIs include:

- `getBuilderProperties()` to flatten note, file, formula, and object schema properties.
- `getBuilderOperatorsForType()` for type-aware operator menus.
- `serializeBuilderNode()` and `builderNodeToFilterExpression()` for expression and structured-filter output.
- `parseBuilderNode()` for converting simple expression strings back into editable rows.
- `validateBuilderNode()` and `evaluateBuilderNode()` for diagnostics and optional runtime warnings.

## Obsidian Builder Package

`obsidian-bases-expression-builder` provides native Obsidian UI helpers on top of this core package. It declares `obsidian`, CodeMirror, and `obsidian-bases-expression` as peer dependencies.

```ts
import {
  BasesExpressionBuilderModal,
  collectObsidianBasesSchema,
} from "obsidian-bases-expression-builder";
import "obsidian-bases-expression-builder/styles.css";

new BasesExpressionBuilderModal(this.app, {
  schema: collectObsidianBasesSchema(this.app),
  initialExpression: 'status == "Todo"',
  onApply: ({ source, filter, validation }) => {
    console.log(source, filter, validation.valid);
  },
}).open();
```

`collectObsidianBasesSchema()` also collects bounded value suggestions from frontmatter by default. Use `maxValuesPerProperty` to cap distinct values per property and `maxPreviewLength` to cap the example preview shown in property suggestions.

The package also exports `BasesExpressionBuilder` for embedding in a custom view or settings tab, `BasesPropertySuggest`, `BasesOperatorSuggest`, `BasesValueSuggest`, and `BasesExpressionSuggest` for plain inputs, `getOperatorSuggestions()` / `getValueSuggestions()` for pure ranking, and `basesExpressionEditorExtensions()` / `basesExpressionSyntaxHighlighting()` for CodeMirror editors.

## Note-Creation Defaults

When a UI creates a note from inside a filtered view, it often needs to prefill properties so the new note is not immediately filtered out. `inferDefaultsFromFilter()` handles the safe subset of that problem:

```ts
import {
  inferDefaultsFromFilter,
  inferDefaultsFromObsidianFilterConfig,
} from "obsidian-bases-expression";

const inferred = inferDefaultsFromFilter({
  and: [
    'status == "Todo"',
    'note.project == "Client A"',
    'list(note.reviewers).contains("Alice")',
    'file.hasTag("work")',
  ],
});

console.log(inferred.properties);
// { status: "Todo", project: "Client A", reviewers: ["Alice"] }

console.log(inferred.tags);
// ["work"]
```

Hosts can resolve current-file relationship filters and declare direct
`contains()` receiver types through the optional inference context:

```ts
const inferred = inferDefaultsFromFilter(
  {
    and: [
      'list(note.projects).contains(this.file.asLink())',
      'note.title.contains("Follow up")',
    ],
  },
  {
    thisFileLink: "[[Projects/Alpha|Alpha]]",
    propertyTypes: { title: "string" },
  },
);

console.log(inferred.properties);
// { projects: ["[[Projects/Alpha|Alpha]]"], title: "Follow up" }
```

Explicit `list(property).contains(value)` constraints produce list defaults.
Direct `property.contains(value)` constraints require a `string` or `list`
entry in `propertyTypes` so inference does not guess the stored property type.
The current-file value is never synthesized; callers must supply the concrete
frontmatter value through `thisFileLink`.

Inference recognizes the link-preserving `file(value).asLink()` maps and the
markdown-link and object-UID normalizers emitted by generated relationship
filters. Other maps remain unsupported. Ranges, negation, `or` branches,
unresolved symbolic values, arbitrary function calls, and conflicting
constraints are likewise reported in `unsupported` instead of being guessed.

Obsidian view integrations can pass the runtime config shape directly through
`inferDefaultsFromObsidianFilterConfig()`. It adapts query-level and view-level
`conjunction` / `filters` / `rule.text` nodes into the package's structured
filter representation and returns adapter failures in `diagnostics`:

```ts
const inferred = inferDefaultsFromObsidianFilterConfig(viewConfig, {
  thisFileLink: "[[Projects/Alpha|Alpha]]",
  propertyTypes: { projects: "list" },
});
```

Use `adaptObsidianFilterConfig()` or `adaptObsidianFilterNode()` separately
when the adapted filter is also needed for compilation or evaluation.

## Public API Map

Use these entry points for most integrations:

- `parseExpression()` for syntax trees.
- `evaluateExpression()`, `evaluateToPlain()`, and `evaluateToString()` for direct evaluation.
- `compileExpression()` for parse-once/evaluate-many workflows.
- `createEvaluationContext()` and `createContextFromRow()` for normalized inputs.
- `compileFilter()` and `evaluateFilter()` for Bases-style filter trees.
- `adaptObsidianFilterConfig()` and `adaptObsidianFilterNode()` for the filter
  nodes exposed by Obsidian Bases view configs.
- `compileFormulaSet()` for formula graphs with dependency ordering and shared formula caching.
- `inferDefaultsFromExpression()`, `inferDefaultsFromFilter()`, and
  `inferDefaultsFromObsidianFilterConfig()` for note-creation defaults.
- `createFormulaLanguageService()` for a schema-bound helper object.
- `compatibilityProfile` for machine-readable compatibility metadata.

See `examples/` for active-zone predicates, workflow condition validation, settings autocomplete, batch row filtering, workflow event contexts, and note-default inference.

## Compatibility

The implementation is based on the public Obsidian Bases documentation and checked against observed app behavior:

- <https://help.obsidian.md/bases/syntax>
- <https://help.obsidian.md/bases/functions>
- <https://help.obsidian.md/formulas>

The runtime does not import Obsidian and does not use private Obsidian APIs.

Compatibility is checked separately through an oracle generator in `scripts/`. With Obsidian running and the CLI connected:

```bash
npm run oracle:generate
npm run oracle:diagnostics:generate
npm test
```

The generated oracle fixture currently covers 281 live Obsidian cases, including literals, operators, functions, formulas, files, links, frontmatter links, relative markdown links, backlinks, duplicate basenames, and representative runtime errors.
The diagnostics oracle fixture covers native parser validity, runtime error values, and validation-warning parity for targeted cases such as unknown typed members, missing note properties, and incomplete expressions.

Known differences from the currently observed Obsidian runtime are recorded in `compatibilityProfile` and in the generated oracle fixture. Where docs and runtime disagree, this package defaults to runtime behavior. See [docs/compatibility.md](docs/compatibility.md) for details.

## Development

```bash
npm install
npm run verify
npm run docs:upstream:check
npm pack --dry-run
```

`npm run verify` runs TypeScript, the unit/property/oracle fixture tests, and the build.
