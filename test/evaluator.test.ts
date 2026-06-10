import { describe, expect, it } from "vitest";
import { evaluateExpression, toPlain, stringifyValue } from "../src/index.js";

const context = {
  now: "2026-06-10T12:34:56",
  random: () => 0.25,
  note: {
    price: 12.5,
    quantity: 4,
    status: "Todo",
    due: "2026-06-09",
    tags: ["urgent", "work"],
    nested: { a: 2 },
    values: [1, 2, 3],
  },
  propertyTypes: {
    due: "date" as const,
  },
  file: {
    path: "Projects/Example.md",
    size: 123,
    tags: ["project/a", "work"],
    links: [{ path: "Other.md" }],
    ctime: new Date("2026-01-01T00:00:00"),
    mtime: new Date("2026-06-09T10:00:00"),
  },
  formulas: {
    total: "price * quantity",
    label: 'status + " " + formula.total.toString()',
  },
};

function plain(source: string) {
  return toPlain(evaluateExpression(source, context).value);
}

describe("evaluateExpression", () => {
  it("evaluates arithmetic and comparisons", () => {
    expect(plain("price * quantity")).toBe(50);
    expect(plain('status == "Todo" && price > 10')).toBe(true);
    expect(plain('status != "Done"')).toBe(true);
  });

  it("evaluates note, file, and formula references", () => {
    expect(plain("note.price")).toBe(12.5);
    expect(plain("file.basename")).toBe("Example");
    expect(plain("formula.total")).toBe(50);
    expect(plain("formula.label")).toBe("Todo 50");
  });

  it("evaluates strings", () => {
    expect(plain('"Hello world".lower()')).toBe("hello world");
    expect(plain('"hello".contains("ell")')).toBe(true);
    expect(plain('"a:b:c".replace(/:/g, "-")')).toBe("a-b-c");
    expect(plain('"hello".slice(1, 4)')).toBe("ell");
    expect(plain('"hello world".title()')).toBe("Hello World");
  });

  it("evaluates numbers", () => {
    expect(plain("(-5).abs()")).toBe(5);
    expect(plain("(2.3333).round(2)")).toBe(2.33);
    expect(plain("(3.14159).toFixed(2)")).toBe("3.14");
  });

  it("evaluates dates and durations", () => {
    expect(plain('date("2026-06-10").format("YYYY-MM-DD")')).toBe("2026-06-10");
    expect(plain('today().format("YYYY-MM-DD HH:mm:ss")')).toBe("2026-06-10 00:00:00");
    expect(plain('date("2026-06-10 12:00:00") + "1d"')).toBe("2026-06-11T12:00:00");
    expect(plain('(duration("1h") * 2).toString()')).toBe("2 hours");
    expect(plain('date("2026-06-11") - date("2026-06-10")')).toBe("a day");
  });

  it("evaluates lists", () => {
    expect(plain("[1,2,3].contains(2)")).toBe(true);
    expect(plain("[1,2,3,4].filter(value > 2)")).toEqual([3, 4]);
    expect(plain("[1,2,3].map(value + index)")).toEqual([1, 3, 5]);
    expect(plain("[1,2,3].reduce(acc + value, 0)")).toBe(6);
    expect(plain("[1,[2,3]].flat()")).toEqual([1, 2, 3]);
    expect(plain("[3,1,2].sort()")).toEqual([1, 2, 3]);
    expect(plain("[1,2,2,3].unique()")).toEqual([1, 2, 3]);
  });

  it("evaluates objects, regexes, files, and links", () => {
    expect(plain('{"a": 1, "b": 2}.keys()')).toEqual(["a", "b"]);
    expect(plain('/abc/.matches("abcde")')).toBe(true);
    expect(plain('file.hasTag("project")')).toBe(true);
    expect(plain('file.hasLink("Other.md")')).toBe(true);
    expect(plain('link("Projects/Example.md").asFile().path')).toBe("Projects/Example.md");
    expect(plain("file.asLink().toString()")).toBe("[[Projects/Example.md]]");
  });

  it("uses globals", () => {
    expect(plain("if(price > 10, 'yes', 'no')")).toBe("yes");
    expect(plain("1.isTruthy()")).toBe(true);
    expect(plain("number(true)")).toBe(1);
    expect(plain("list('x')")).toEqual(["x"]);
    expect(plain("max(1, 3, 2)")).toBe(3);
    expect(plain("min(1, 3, 2)")).toBe(1);
    expect(plain("random()")).toBe(0.25);
  });

  it("returns structured errors instead of throwing", () => {
    const result = evaluateExpression("number('nope')", context).value;
    expect(result.type).toBe("Error");
    expect(stringifyValue(result)).toContain("Unable to parse");
  });
});
