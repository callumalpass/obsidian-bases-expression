import { describe, expect, it } from "vitest";
import { parseExpression, tokenize } from "../src/index.js";

describe("lexer", () => {
  it("tokenizes literals, identifiers, operators, and regexes", () => {
    const { tokens, diagnostics } = tokenize('status != "Done" && /a+/g.matches(name)');
    expect(diagnostics).toEqual([]);
    expect(tokens.map((token) => token.value).slice(0, -1)).toEqual([
      "status",
      "!=",
      "Done",
      "&&",
      "a+/g",
      ".",
      "matches",
      "(",
      "name",
      ")",
    ]);
  });
});

describe("parseExpression", () => {
  it("parses arithmetic with precedence", () => {
    const parsed = parseExpression("1 + 2 * 3");
    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.ast?.type).toBe("Binary");
    expect(parsed.ast).toMatchObject({ operator: "+" });
  });

  it("parses member calls and bracket access", () => {
    const parsed = parseExpression('note["total price"].toFixed(2)');
    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.ast?.type).toBe("Call");
  });

  it("parses documented numeric method calls", () => {
    const parsed = parseExpression("1.isTruthy()");
    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.ast?.type).toBe("Call");
  });

  it("reports incomplete expressions", () => {
    const parsed = parseExpression("price +");
    expect(parsed.diagnostics.some((diagnostic) => diagnostic.severity === "error")).toBe(true);
  });
});
