import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { CompletionContext } from "@codemirror/autocomplete";
import { getBuilderOperatorsForType } from "obsidian-bases-expression";
import { basesExpressionCompletionSource } from "../src/codemirror.js";
import { getOperatorSuggestions } from "../src/operator-suggestions.js";
import { collectObsidianBasesSchema } from "../src/schema.js";
import { getValueSuggestions } from "../src/value-suggestions.js";
import type { App, CachedMetadata, TFile } from "obsidian";

describe("collectObsidianBasesSchema", () => {
  it("infers property names and value types from metadata cache", () => {
    const files = [
      fakeFile("Tasks/A.md"),
      fakeFile("Tasks/B.md"),
    ];
    const app = fakeApp(files, {
      "Tasks/A.md": { frontmatter: { status: "Todo", due: "2026-06-11", priority: 2, done: false } },
      "Tasks/B.md": { frontmatter: { status: "Done", tags: ["work"], priority: 1 } },
    });

    const schema = collectObsidianBasesSchema(app);

    expect(schema.properties).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "status", type: "string" }),
        expect.objectContaining({ name: "due", type: "date" }),
        expect.objectContaining({ name: "priority", type: "number" }),
        expect.objectContaining({ name: "done", type: "boolean" }),
        expect.objectContaining({ name: "tags", type: "list" }),
      ]),
    );
    expect(schema.properties?.find((property) => property.name === "status")?.values).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ value: "Todo", label: "Todo", count: 1 }),
        expect.objectContaining({ value: "Done", label: "Done", count: 1 }),
      ]),
    );
    expect(schema.properties?.find((property) => property.name === "tags")?.values).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ value: "work", label: "work", count: 1 }),
      ]),
    );
  });

  it("limits property suggestion previews", () => {
    const files = [fakeFile("Tasks/A.md")];
    const app = fakeApp(files, {
      "Tasks/A.md": {
        frontmatter: {
          status: "This is a deliberately long status value used to test preview truncation",
        },
      },
    });

    const schema = collectObsidianBasesSchema(app, { maxPreviewLength: 32 });
    const status = schema.properties?.find((property) => property.name === "status");

    expect(status?.documentation).toHaveLength(32);
    expect(status?.documentation?.endsWith("...")).toBe(true);
  });
});

describe("basesExpressionCompletionSource", () => {
  it("returns schema-backed completions", () => {
    const state = EditorState.create({ doc: "sta" });
    const context = new CompletionContext(state, 3, true);
    const result = basesExpressionCompletionSource({
      schema: {
        properties: [{ name: "status", type: "string" }],
      },
    })(context);

    expect(result?.options.map((option) => option.label)).toContain("status");
  });

  it("returns value completions with quoted replacement ranges", () => {
    const source = 'status == "To';
    const state = EditorState.create({ doc: source });
    const context = new CompletionContext(state, source.length, true);
    const result = basesExpressionCompletionSource({
      schema: {
        properties: [
          {
            name: "status",
            type: "string",
            values: [{ value: "Todo", label: "Todo", count: 2 }],
          },
        ],
      },
    })(context);

    expect(result?.from).toBe('status == "'.length);
    expect(result?.options.find((option) => option.label === "Todo")).toMatchObject({
      type: "value",
      apply: "Todo",
    });
  });
});

describe("getValueSuggestions", () => {
  it("ranks matching value suggestions", () => {
    const suggestions = getValueSuggestions(
      {
        properties: [
          {
            name: "status",
            type: "string",
            values: [
              { value: "Done", label: "Done", count: 1 },
              { value: "Todo", label: "Todo", count: 3 },
            ],
          },
        ],
      },
      "status",
      "to",
    );

    expect(suggestions[0]).toMatchObject({ label: "Todo", value: "Todo", count: 3 });
  });
});

describe("getOperatorSuggestions", () => {
  it("filters operators by label while preserving type-specific order", () => {
    const suggestions = getOperatorSuggestions(getBuilderOperatorsForType("string"), "contain");

    expect(suggestions.map((operator) => operator.id)).toEqual(["contains", "not-contains"]);
  });

  it("opens the full operator list when the query is the selected operator label", () => {
    const operators = getBuilderOperatorsForType("string");
    const suggestions = getOperatorSuggestions(operators, "is", { selectedId: "is" });

    expect(suggestions).toHaveLength(operators.length);
    expect(suggestions[0]).toMatchObject({ id: "is" });
  });
});

function fakeFile(path: string): TFile {
  return { path } as TFile;
}

function fakeApp(files: TFile[], caches: Record<string, CachedMetadata>): App {
  return {
    vault: {
      getMarkdownFiles: () => files,
    },
    metadataCache: {
      getFileCache: (file: TFile) => caches[file.path] ?? null,
    },
  } as App;
}
