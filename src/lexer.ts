import type { Diagnostic } from "./ast.js";

export type TokenType =
  | "number"
  | "string"
  | "identifier"
  | "regex"
  | "operator"
  | "punct"
  | "eof";

export interface Token {
  type: TokenType;
  value: string;
  raw: string;
  start: number;
  end: number;
}

const punct = new Set(["(", ")", "[", "]", "{", "}", ".", ",", ":"]);
const singleOps = new Set(["+", "-", "*", "/", "%", "!", ">", "<"]);
const endExpressionValues = new Set([")", "]", "}"]);

export function tokenize(source: string): {
  tokens: Token[];
  diagnostics: Diagnostic[];
} {
  const lexer = new Lexer(source);
  return lexer.scan();
}

class Lexer {
  private i = 0;
  private readonly tokens: Token[] = [];
  private readonly diagnostics: Diagnostic[] = [];
  private lastSignificant: Token | undefined;

  constructor(private readonly source: string) {}

  scan(): { tokens: Token[]; diagnostics: Diagnostic[] } {
    while (!this.done()) {
      const ch = this.peek();
      if (isWhitespace(ch)) {
        this.i++;
        continue;
      }
      if (isDigit(ch) || (ch === "." && isDigit(this.peek(1)))) {
        this.scanNumber();
        continue;
      }
      if (ch === "'" || ch === '"') {
        this.scanString(ch);
        continue;
      }
      if (ch === "/" && this.shouldStartRegex()) {
        this.scanRegex();
        continue;
      }
      if (isIdentifierStart(ch)) {
        this.scanIdentifier();
        continue;
      }
      const two = ch + this.peek(1);
      if (["==", "!=", ">=", "<=", "&&", "||"].includes(two)) {
        this.push("operator", two, two, this.i, (this.i += 2));
        continue;
      }
      if (singleOps.has(ch)) {
        this.push("operator", ch, ch, this.i, ++this.i);
        continue;
      }
      if (punct.has(ch)) {
        this.push("punct", ch, ch, this.i, ++this.i);
        continue;
      }
      this.diagnostics.push({
        code: "unexpected-character",
        message: `Unexpected character ${JSON.stringify(ch)}`,
        severity: "error",
        span: { start: this.i, end: this.i + 1 },
      });
      this.i++;
    }
    this.tokens.push({
      type: "eof",
      value: "",
      raw: "",
      start: this.source.length,
      end: this.source.length,
    });
    return { tokens: this.tokens, diagnostics: this.diagnostics };
  }

  private scanNumber(): void {
    const start = this.i;
    if (this.peek() !== ".") {
      while (isDigit(this.peek())) this.i++;
    }
    if (this.peek() === "." && isDigit(this.peek(1))) {
      this.i++;
      while (isDigit(this.peek())) this.i++;
    }
    if (this.peek().toLowerCase() === "e") {
      const expStart = this.i;
      this.i++;
      if (this.peek() === "+" || this.peek() === "-") this.i++;
      if (!isDigit(this.peek())) {
        this.i = expStart;
      } else {
        while (isDigit(this.peek())) this.i++;
      }
    }
    const raw = this.source.slice(start, this.i);
    this.push("number", raw, raw, start, this.i);
  }

  private scanString(quote: string): void {
    const start = this.i;
    this.i++;
    let value = "";
    while (!this.done()) {
      const ch = this.peek();
      if (ch === quote) {
        this.i++;
        this.push("string", value, this.source.slice(start, this.i), start, this.i);
        return;
      }
      if (ch === "\\") {
        this.i++;
        if (this.done()) break;
        const esc = this.peek();
        value += decodeEscape(esc);
        this.i++;
        continue;
      }
      value += ch;
      this.i++;
    }
    this.diagnostics.push({
      code: "unterminated-string",
      message: "Unterminated string literal",
      severity: "error",
      span: { start, end: this.i },
    });
    this.push("string", value, this.source.slice(start, this.i), start, this.i);
  }

  private scanRegex(): void {
    const start = this.i;
    this.i++;
    let escaped = false;
    let inClass = false;
    let pattern = "";
    while (!this.done()) {
      const ch = this.peek();
      if (escaped) {
        pattern += ch;
        escaped = false;
        this.i++;
        continue;
      }
      if (ch === "\\") {
        pattern += ch;
        escaped = true;
        this.i++;
        continue;
      }
      if (ch === "[") inClass = true;
      if (ch === "]") inClass = false;
      if (ch === "/" && !inClass) {
        this.i++;
        let flags = "";
        while (/[a-z]/i.test(this.peek())) {
          flags += this.peek();
          this.i++;
        }
        this.push("regex", `${pattern}/${flags}`, this.source.slice(start, this.i), start, this.i);
        return;
      }
      pattern += ch;
      this.i++;
    }
    this.diagnostics.push({
      code: "unterminated-regex",
      message: "Unterminated regular expression literal",
      severity: "error",
      span: { start, end: this.i },
    });
    this.push("regex", pattern, this.source.slice(start, this.i), start, this.i);
  }

  private scanIdentifier(): void {
    const start = this.i;
    this.i++;
    while (isIdentifierPart(this.peek())) this.i++;
    const raw = this.source.slice(start, this.i);
    this.push("identifier", raw, raw, start, this.i);
  }

  private shouldStartRegex(): boolean {
    const previous = this.lastSignificant;
    if (!previous) return true;
    if (previous.type === "number" || previous.type === "string" || previous.type === "identifier" || previous.type === "regex") {
      return false;
    }
    return !endExpressionValues.has(previous.value);
  }

  private push(type: TokenType, value: string, raw: string, start: number, end: number): void {
    const token = { type, value, raw, start, end };
    this.tokens.push(token);
    if (type !== "eof") this.lastSignificant = token;
  }

  private done(): boolean {
    return this.i >= this.source.length;
  }

  private peek(offset = 0): string {
    return this.source[this.i + offset] ?? "";
  }
}

function decodeEscape(ch: string): string {
  switch (ch) {
    case "n":
      return "\n";
    case "r":
      return "\r";
    case "t":
      return "\t";
    case "\\":
      return "\\";
    case "'":
      return "'";
    case '"':
      return '"';
    default:
      return ch;
  }
}

function isWhitespace(ch: string): boolean {
  return /\s/.test(ch);
}

function isDigit(ch: string): boolean {
  return /[0-9]/.test(ch);
}

function isIdentifierStart(ch: string): boolean {
  return /[A-Za-z_$]/.test(ch);
}

function isIdentifierPart(ch: string): boolean {
  return /[A-Za-z0-9_$]/.test(ch);
}
