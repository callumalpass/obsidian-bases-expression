# obsidian-bases-expression

Standalone parser, evaluator, diagnostics, dependency inspection, and completion helpers for Obsidian Bases-compatible expressions.

The runtime is pure TypeScript and does not import Obsidian. Compatibility tests can optionally generate black-box fixtures from a running Obsidian instance through the Obsidian CLI.

```ts
import { evaluateExpression } from "obsidian-bases-expression";

const result = evaluateExpression('status == "Todo" && due < today()', {
  note: {
    status: "Todo",
    due: "2026-06-09",
  },
  now: "2026-06-10T12:00:00",
});

console.log(result.value);
```

## Design constraints

- Implemented from the published Obsidian Bases documentation.
- No production dependency on Obsidian private APIs.
- Test-only oracle generation validates behavior against a running Obsidian app.
- Parser and diagnostics preserve source ranges for editor integrations.

Public sources used for the implementation surface:

- Obsidian Bases syntax: https://help.obsidian.md/bases/syntax
- Obsidian Bases functions: https://help.obsidian.md/bases/functions
- Obsidian formulas overview: https://help.obsidian.md/formulas

## Current compatibility scope

Implemented:

- literals: strings, numbers, booleans, `null`, lists, objects, regular expressions
- operators: arithmetic, comparison, boolean, unary, grouping
- property access: bare note fields, `note.*`, `file.*`, `formula.*`, `this.*`, bracket access, list indexes
- host-provided object roots such as `trigger.*` or `steps.*` when supplied in the evaluation context
- global functions documented by Obsidian Bases
- typed functions for strings, numbers, dates, lists, links, files, objects, and regexes
- list `map`, `filter`, and `reduce` with `value`, `index`, and `acc`
- diagnostics, dependency inspection, completions, hover info, and signature help
- Bases-style structured filters with `and`, `or`, and `not`
- conservative note-default inference for note creation flows

The package intentionally returns structured `ErrorValue` objects for unsupported or invalid runtime operations instead of throwing in normal evaluation.

## API

```ts
import {
  compileFilter,
  compileExpression,
  completeExpression,
  createContextFromRow,
  createEvaluationContext,
  evaluateExpression,
  evaluateToPlain,
  inferDefaultsFromFilter,
  inspectExpression,
  toCodeMirrorCompletions,
  parseExpression,
  validateExpression,
  validateExpressionDetailed,
} from "obsidian-bases-expression";

const parsed = parseExpression('status == "Todo" && file.hasTag("work")');
const diagnostics = validateExpression("status == unknown", {
  properties: [{ name: "status", type: "string" }],
});
const completions = completeExpression("file.pa", 7);
const inspection = inspectExpression("formula.score + priority");

const result = evaluateExpression("price * quantity", {
  note: { price: 12.5, quantity: 4 },
  file: { path: "Projects/Example.md" },
  objects: {
    trigger: { type: "drag", zone: { id: "doing" } },
    steps: { query: { total: 3 } },
  },
});
```

Higher-level helpers are available for plugin and workflow authors:

```ts
const context = createEvaluationContext({
  note: { status: "Todo", priority: 3 },
  file: {
    path: "Tasks/Write proposal.md",
    tags: ["project/client-a"],
  },
});

const activeZonePredicate = compileExpression('status == "Todo" && file.hasTag("project")');
const shouldRender = activeZonePredicate.evaluateToPlain(context);

const viewFilter = compileFilter({
  and: ['status == "Todo"', { or: ['priority >= 2', 'file.hasTag("urgent")'] }],
});
const matchesView = viewFilter.evaluateToBoolean(context);

const defaults = inferDefaultsFromFilter({
  and: ['status == "Todo"', 'note.project == "Client A"', 'file.hasTag("work")'],
});
// { properties: { status: "Todo", project: "Client A" }, tags: ["work"] }

const plain = evaluateToPlain("priority + 1", context);
const rowContext = createContextFromRow({
  path: "Tasks/Write proposal.md",
  properties: { status: "Todo", priority: 3 },
});

const validation = validateExpressionDetailed("due.lower()", {
  properties: [{ name: "due", type: "date" }],
  objects: [
    {
      name: "trigger",
      type: "object",
      properties: [{ name: "type", type: "string" }],
    },
  ],
});

const completions = toCodeMirrorCompletions(
  completeExpression("file.pa", 7),
);
```

Useful public surfaces:

- `createEvaluationContext()` and `createContextFromRow()` normalize row/file/link/frontmatter inputs without importing Obsidian.
- `objects` on an evaluation context supplies named host objects for workflow events, canvas zones, action results, or other plugin-owned data.
- `compileExpression()` parses once, exposes dependencies, and evaluates repeatedly.
- `compileFilter()` and `evaluateFilter()` evaluate Obsidian Bases-style filter trees that contain expression strings plus `and`, `or`, and `not`.
- `inferDefaultsFromExpression()` and `inferDefaultsFromFilter()` infer only safe note-creation defaults, currently equality constraints and positive `file.hasTag(...)` requirements; unsupported branches are reported explicitly.
- `evaluateBatch()` evaluates one expression across many rows.
- `compileFormulaSet()` parses a formula graph, reports formula dependencies, and evaluates the set with shared formula caching.
- `FormulaLanguageSchema.objects` describes host object roots so completions, hovers, type checks, and dependency reporting distinguish `trigger.zone.id` from note frontmatter.
- `validateExpressionDetailed()` returns diagnostics plus dependency information suitable for plugin settings screens, workflow editors, active-zone editors, and CI-style checks.
- `getHoverInfo()`, `getSignatureHelp()`, `completeExpression()`, `toCodeMirrorCompletions()`, and `toCodeMirrorDiagnostics()` provide editor integration primitives.
- `compatibilityProfile` exposes the oracle case count, generated timestamp, Obsidian version/build metadata when available, docs sources, and known divergences as machine-readable data.

See `examples/` for workflow validation, workflow event contexts, active-zone predicates, settings autocomplete, note-default inference, and batch row filtering.

## Known compatibility notes

The test suite currently validates 281 expression cases against live Obsidian Bases. Eight known divergences are recorded in the generated fixtures:

- Object literals are described in the public docs, but the current parser observed through Obsidian rejects object literal syntax such as `{"a": 1}.keys()`. The package implements object literals because they are documented, and the oracle suite records this as a known divergence instead of hiding it.
- Public docs show direct numeric method calls such as `1.isTruthy()`, but the current parser rejects direct numeric member syntax. Parenthesized numeric literals such as `(1).isTruthy()` work and are oracle-checked.
- Unary plus is implemented in the package because it is JavaScript-like and harmless, but the current parser rejects `+value`.
- Date subtraction is documented as returning a millisecond difference, but live Obsidian currently returns a `Duration` value. The package follows live behavior here because duration values compose with the documented duration methods and stringification.

## Oracle fixtures

With Obsidian running and the CLI connected:

```bash
npm run oracle:generate
npm test
```

The oracle script creates temporary files in the `test` vault, opens a visible scratch `.base` file in a normal Obsidian leaf, evaluates formulas using Obsidian's live Bases engine, writes `test/fixtures/oracle.generated.json`, and removes the temporary files.

The oracle includes a dedicated link matrix with multiple temporary notes, duplicate basenames, frontmatter wikilinks, wikilink aliases, markdown links, relative markdown paths, markdown image embeds, heading and block subpaths, duplicate headings and block IDs, unresolved links, multiple backlink sources, spaced and unicode/punctuation-heavy names, case-insensitive lookup probes, non-markdown attachments, and full-path variants.

The oracle script does inspect the live scratch Base controller to find Obsidian's formula/context constructors. That code is deliberately quarantined in `scripts/` and is not imported by the library.
