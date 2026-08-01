import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  inferDefaultsFromExpression,
  inferDefaultsFromFilter,
  parseExpression,
} from "../src/index.js";

const generatedProjectRelationshipFilter = String.raw`file.hasLink(this.file) && list(note.projects).map(file(value.replace(/^\[[^\]]+\]\((.*)\)$/, "$1").replace(/%20/g, " ")).asLink()).contains(this.file.asLink())`;

const generatedDependencyRelationshipFilter =
  'file.hasLink(this.file) && list(note.blockedBy).map(file(if(value.isType("object"), value.uid, value)).asLink()).contains(this.file.asLink())';

describe("note-default inference", () => {
  describe("positive containment", () => {
    it("infers explicit list containment without property metadata", () => {
      const inferred = inferDefaultsFromExpression('list(note.projects).contains("[[Alpha]]")');

      expect(inferred.properties).toEqual({ projects: ["[[Alpha]]"] });
      expect(inferred.constraints).toContainEqual({
        kind: "property-contains",
        property: "projects",
        source: 'list(note.projects).contains("[[Alpha]]")',
        value: "[[Alpha]]",
      });
      expect(inferred.unsupported).toEqual([]);
    });

    it("uses property types for direct string and list containment", () => {
      const inferred = inferDefaultsFromFilter(
        {
          and: ['note.title.contains("Alpha")', 'note.projects.contains("[[Alpha]]")'],
        },
        {
          propertyTypes: {
            title: "string",
            projects: "list",
          },
        },
      );

      expect(inferred.properties).toEqual({
        projects: ["[[Alpha]]"],
        title: "Alpha",
      });
      expect(inferred.unsupported).toEqual([]);
    });

    it("supports bracket property names and AST inputs", () => {
      const parsed = parseExpression('list(note["project links"]).contains("[[Alpha]]")');
      expect(parsed.ast).not.toBeNull();

      const inferred = inferDefaultsFromExpression(parsed.ast!);
      expect(inferred.properties).toEqual({ "project links": ["[[Alpha]]"] });
    });

    it("combines and deduplicates multiple required list members", () => {
      const inferred = inferDefaultsFromFilter({
        and: [
          'list(note.projects).contains("[[Alpha]]")',
          'list(note.projects).contains("[[Beta]]")',
          'list(note.projects).contains("[[Alpha]]")',
        ],
      });

      expect(inferred.properties).toEqual({ projects: ["[[Alpha]]", "[[Beta]]"] });
      expect(inferred.unsupported).toEqual([]);
    });

    it("requires property metadata for direct contains calls", () => {
      const inferred = inferDefaultsFromExpression('note.projects.contains("[[Alpha]]")');

      expect(inferred.properties).toEqual({});
      expect(inferred.unsupported.map((item) => item.reason)).toEqual([
        "Cannot infer defaults from projects.contains() without a known string or list property type",
      ]);
    });

    it("rejects non-string defaults for string properties", () => {
      const inferred = inferDefaultsFromExpression("note.title.contains(42)", {
        propertyTypes: { title: "string" },
      });

      expect(inferred.properties).toEqual({});
      expect(inferred.unsupported[0]?.reason).toContain("non-string contains() value");
    });
  });

  describe("current-file links", () => {
    it("resolves this.file.asLink() through caller options", () => {
      const inferred = inferDefaultsFromExpression(
        "list(note.projects).contains(this.file.asLink())",
        { thisFileLink: "[[Projects/Alpha|Alpha]]" },
      );

      expect(inferred.properties).toEqual({ projects: ["[[Projects/Alpha|Alpha]]"] });
      expect(inferred.unsupported).toEqual([]);
    });

    it("preserves non-string host link values for list properties", () => {
      const link = { path: "Projects/Alpha.md", display: "Alpha" };
      const inferred = inferDefaultsFromExpression(
        "list(note.projects).contains(this.file.asLink())",
        { thisFileLink: link },
      );

      expect(inferred.properties).toEqual({ projects: [link] });
    });

    it("reports unresolved current-file values instead of guessing", () => {
      const inferred = inferDefaultsFromExpression(
        "list(note.projects).contains(this.file.asLink())",
      );

      expect(inferred.properties).toEqual({});
      expect(inferred.unsupported[0]?.reason).toBe(
        "Cannot infer a current-file default without options.thisFileLink",
      );
    });
  });

  describe("generated link-normalizing relationship filters", () => {
    it("infers the generated project relationship filter", () => {
      const inferred = inferDefaultsFromExpression(generatedProjectRelationshipFilter, {
        thisFileLink: "[[Projects/Alpha|Alpha]]",
      });

      expect(inferred.properties).toEqual({ projects: ["[[Projects/Alpha|Alpha]]"] });
      expect(inferred.unsupported).toEqual([]);
    });

    it("infers the generated object-or-link dependency filter", () => {
      const inferred = inferDefaultsFromExpression(generatedDependencyRelationshipFilter, {
        thisFileLink: "[[Tasks/Blocker]]",
      });

      expect(inferred.properties).toEqual({ blockedBy: ["[[Tasks/Blocker]]"] });
      expect(inferred.unsupported).toEqual([]);
    });

    it("accepts the minimal file(value).asLink() normalization", () => {
      const inferred = inferDefaultsFromExpression(
        "list(note.projects).map(file(value).asLink()).contains(this.file.asLink())",
        { thisFileLink: "[[Alpha]]" },
      );

      expect(inferred.properties).toEqual({ projects: ["[[Alpha]]"] });
      expect(inferred.unsupported).toEqual([]);
    });

    it("rejects non-string values for string-backed link normalizers", () => {
      const inferred = inferDefaultsFromExpression(
        "list(note.projects).map(file(value).asLink()).contains(this.file.asLink())",
        { thisFileLink: { path: "Projects/Alpha.md" } },
      );

      expect(inferred.properties).toEqual({});
      expect(inferred.unsupported[0]?.reason).toContain("non-string contains() value");
    });

    it.each([
      'list(note.projects).map("constant").contains(this.file.asLink())',
      'list(note.projects).map(value + "-suffix").contains(this.file.asLink())',
      'list(note.projects).map(file(value.replace(/./g, "")).asLink()).contains(this.file.asLink())',
      'list(note.projects).map(file(value).asLink()).filter(true).contains(this.file.asLink())',
      'file.hasLink(this.file) && list(note.projects).map("constant").contains(this.file.asLink())',
    ])("rejects arbitrary or additionally transformed maps: %s", (filter) => {
      const inferred = inferDefaultsFromExpression(filter, { thisFileLink: "[[Alpha]]" });

      expect(inferred.properties).toEqual({});
      expect(inferred.unsupported.length).toBeGreaterThan(0);
    });

    it("rejects near-miss markdown normalization patterns", () => {
      const filter = String.raw`list(note.projects).map(file(value.replace(/^\[[^\]]+\]\((.*)\)$/, "$1").replace(/%2F/g, "/")).asLink()).contains(this.file.asLink())`;
      const inferred = inferDefaultsFromExpression(filter, { thisFileLink: "[[Alpha]]" });

      expect(inferred.properties).toEqual({});
      expect(inferred.unsupported.length).toBeGreaterThan(0);
    });
  });

  describe("conservative boundaries", () => {
    it("does not infer from OR alternatives containing otherwise supported constraints", () => {
      const inferred = inferDefaultsFromExpression(
        `file.hasTag("either") || ${generatedProjectRelationshipFilter}`,
        { thisFileLink: "[[Alpha]]" },
      );

      expect(inferred.properties).toEqual({});
      expect(inferred.tags).toEqual([]);
      expect(inferred.unsupported[0]?.reason).toBe("Cannot infer defaults for || expressions");
    });

    it("does not infer from structured OR or NOT filters", () => {
      const orInference = inferDefaultsFromFilter(
        { or: ['list(note.projects).contains("[[Alpha]]")', 'status == "Todo"'] },
      );
      const notInference = inferDefaultsFromFilter({
        not: 'list(note.projects).contains("[[Alpha]]")',
      });

      expect(orInference.properties).toEqual({});
      expect(notInference.properties).toEqual({});
      expect(orInference.unsupported).toHaveLength(1);
      expect(notInference.unsupported).toHaveLength(1);
    });

    it("reports conflicts between equality and containment defaults", () => {
      const inferred = inferDefaultsFromExpression(
        'note.projects == "[[Other]]" && list(note.projects).contains("[[Alpha]]")',
      );

      expect(inferred.properties).toEqual({ projects: "[[Other]]" });
      expect(inferred.unsupported.map((item) => item.reason)).toContain(
        "Conflicting inferred defaults for projects",
      );
    });

    it("keeps positive equality, truthy property, and tag behavior unchanged", () => {
      const inferred = inferDefaultsFromFilter({
        and: ['status == "Todo"', "published", 'file.hasTag("#work")'],
      });

      expect(inferred.properties).toEqual({ published: true, status: "Todo" });
      expect(inferred.tags).toEqual(["work"]);
      expect(inferred.unsupported).toEqual([]);
    });
  });

  describe("property-based safety", () => {
    it("never treats a literal-valued map as link preserving", () => {
      fc.assert(
        fc.property(fc.string({ maxLength: 40 }), (mappedValue) => {
          const filter = `list(note.projects).map(${JSON.stringify(mappedValue)}).contains(this.file.asLink())`;
          const inferred = inferDefaultsFromExpression(filter, { thisFileLink: "[[Alpha]]" });

          expect(inferred.properties).toEqual({});
          expect(inferred.unsupported.length).toBeGreaterThan(0);
        }),
        { numRuns: 250 },
      );
    });

    it("merges every unique positive list membership constraint", () => {
      fc.assert(
        fc.property(
          fc.uniqueArray(fc.string({ maxLength: 30 }), { maxLength: 12 }),
          (values) => {
            const inferred = inferDefaultsFromFilter({
              and: values.map(
                (value) => `list(note.projects).contains(${JSON.stringify(value)})`,
              ),
            });

            expect(inferred.properties).toEqual(
              values.length > 0 ? { projects: values } : {},
            );
            expect(inferred.unsupported).toEqual([]);
          },
        ),
        { numRuns: 250 },
      );
    });
  });
});
