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

  it("distinguishes division from regex literals", () => {
    expect(tokenize("10 / 2").tokens.map((token) => token.value).slice(0, -1)).toEqual(["10", "/", "2"]);
    expect(tokenize("value == /a\\/b/i").tokens.map((token) => token.type).slice(0, -1)).toEqual([
      "identifier",
      "operator",
      "regex",
    ]);
  });

  it("decodes basic string escapes", () => {
    const { tokens, diagnostics } = tokenize('"line\\n\\"quoted\\""');
    expect(diagnostics).toEqual([]);
    expect(tokens[0]).toMatchObject({ type: "string", value: 'line\n"quoted"' });
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

  it("parses computed member expressions", () => {
    const parsed = parseExpression('steps.matches[index + 1]["path"]');
    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.ast?.type).toBe("Member");
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

  it("rejects object literals to match the observed runtime", () => {
    const parsed = parseExpression('{"a": 1}.keys()');
    expect(parsed.ast).toBeNull();
    expect(parsed.diagnostics.some((diagnostic) => diagnostic.code === "unsupported-object-literal")).toBe(true);
  });

  it("reports unterminated strings and regexes", () => {
    expect(parseExpression('"unterminated').diagnostics.some((diagnostic) => diagnostic.code === "unterminated-string")).toBe(true);
    expect(parseExpression("/unterminated").diagnostics.some((diagnostic) => diagnostic.code === "unterminated-regex")).toBe(true);
  });
});
