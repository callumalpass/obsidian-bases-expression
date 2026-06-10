# Compatibility Notes

This package is built from the published Obsidian Bases syntax and function documentation, then validated against a running Obsidian instance.

## Production boundary

Library source under `src/` has no Obsidian dependency and does not use private Obsidian APIs. It evaluates plain JavaScript data structures.

The oracle generator under `scripts/` intentionally probes a running Obsidian app. It creates temporary vault files, opens a visible scratch `.base` file in a normal workspace leaf, reads the live formula/context constructors from that view controller, evaluates formulas against a temporary note, normalizes the returned values, and writes JSON fixtures. This keeps Obsidian-specific probing out of the published runtime while still giving regression evidence against the real app.

## Observed docs/runtime divergence

Object literals are documented as a data type in the public formula docs, but the parser observed in Obsidian currently rejects object literal expressions. The package implements object literals because they are documented. The generated oracle fixture marks this as a known divergence.

Public docs show direct numeric method syntax such as `1.isTruthy()`, but the parser observed in Obsidian currently rejects direct numeric member calls. Parenthesized numeric literals such as `(1).isTruthy()` work.

The package supports unary plus as a JavaScript-like operator, but the parser observed in Obsidian rejects `+value`.

Date subtraction is documented as returning a millisecond difference, but the internal evaluator observed in Obsidian returns a `Duration` value. For example, `date("2026-06-11") - date("2026-06-10")` evaluates to a Duration whose string form is `a day`, and `number(date("2026-06-11") - date("2026-06-10"))` returns an error. The package follows live behavior for this case.

Link/file behavior is resolution-based in several places. In the current observed runtime, `file.links` includes embeds as well as ordinary wikilinks and internal markdown links; external markdown links are not included; `file.embeds` is the embed-only subset; backlinks are source files deduplicated by path; unresolved raw wikilinks can satisfy `file.hasLink("Missing Note")`, but not `file.hasLink("Missing Note.md")`; unresolved markdown links keep their literal target, so `[Markdown Missing](Missing.md)` satisfies `file.hasLink("Missing.md")`; and link equality ignores display text, `.md` spelling, and subpaths once both links resolve to the same file. One notable exception is `list.unique()` over links, which de-duplicates by the rendered/plain link value rather than by the same resolved-link equality used by `contains()` and `filter(value == link(...))`.

## Verification

Current verification commands:

```bash
npm run oracle:generate
npm run check
npm test
npm run build
```

The test suite includes parser tests, evaluator tests across the documented function families, language-service tests, property-based arithmetic/list tests, and live oracle fixture tests. The current oracle corpus covers literals, property access, operators, globals, any/string/number/date/duration/list/object/regexp/file/link behavior, formula references, `this.file`, a dedicated wikilink/markdown-link lookup matrix, and representative runtime errors. It does not repeat the same corpus across multiple Obsidian versions.
