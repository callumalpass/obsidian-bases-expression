import type {
  ArrayExpression,
  BinaryExpression,
  CallExpression,
  Diagnostic,
  Expression,
  IdentifierExpression,
  LiteralExpression,
  MemberExpression,
  RegexExpression,
  Span,
  UnaryExpression,
} from "./ast.js";
import { tokenize, type Token } from "./lexer.js";

const precedences: Record<string, number> = {
  "||": 1,
  "&&": 2,
  "==": 3,
  "!=": 3,
  ">": 3,
  "<": 3,
  ">=": 3,
  "<=": 3,
  "+": 4,
  "-": 4,
  "*": 5,
  "/": 5,
  "%": 5,
};

export interface ParseResult {
  ast: Expression | null;
  diagnostics: Diagnostic[];
  tokens: Token[];
}

export function parseExpression(source: string): ParseResult {
  const { tokens, diagnostics } = tokenize(source);
  const parser = new Parser(tokens, diagnostics);
  return parser.parse();
}

class Parser {
  private i = 0;

  constructor(
    private readonly tokens: Token[],
    private readonly diagnostics: Diagnostic[],
  ) {}

  parse(): ParseResult {
    const ast = this.parseExpression(0);
    if (!this.at("eof")) {
      this.error(this.current(), `Unexpected token ${JSON.stringify(this.current().raw || this.current().value)}`);
    }
    return { ast, diagnostics: this.diagnostics, tokens: this.tokens };
  }

  private parseExpression(minPrecedence: number): Expression | null {
    let left = this.parsePrefix();
    if (!left) return null;
    left = this.parsePostfix(left);
    while (this.current().type === "operator") {
      const op = this.current().value;
      const precedence = precedences[op];
      if (!precedence || precedence < minPrecedence) break;
      const token = this.advance();
      const right = this.parseExpression(precedence + 1);
      if (!right) {
        this.error(token, `Missing right-hand side for ${op}`);
        break;
      }
      left = {
        type: "Binary",
        operator: op as BinaryExpression["operator"],
        left,
        right,
        span: { start: left.span.start, end: right.span.end },
      };
    }
    return left;
  }

  private parsePrefix(): Expression | null {
    const token = this.current();
    if (token.type === "number") {
      this.advance();
      return {
        type: "Literal",
        value: Number(token.value),
        raw: token.raw,
        span: spanOf(token),
      } satisfies LiteralExpression;
    }
    if (token.type === "string") {
      this.advance();
      return {
        type: "Literal",
        value: token.value,
        raw: token.raw,
        span: spanOf(token),
      } satisfies LiteralExpression;
    }
    if (token.type === "regex") {
      this.advance();
      const raw = token.raw;
      const lastSlash = raw.lastIndexOf("/");
      return {
        type: "Regex",
        pattern: raw.slice(1, lastSlash),
        flags: raw.slice(lastSlash + 1),
        raw,
        span: spanOf(token),
      } satisfies RegexExpression;
    }
    if (token.type === "identifier") {
      this.advance();
      if (token.value === "true" || token.value === "false" || token.value === "null") {
        return {
          type: "Literal",
          value: token.value === "null" ? null : token.value === "true",
          raw: token.raw,
          span: spanOf(token),
        } satisfies LiteralExpression;
      }
      return {
        type: "Identifier",
        name: token.value,
        span: spanOf(token),
      } satisfies IdentifierExpression;
    }
    if (token.type === "operator" && ["!", "-", "+"].includes(token.value)) {
      this.advance();
      const argument = this.parseExpression(6);
      if (!argument) {
        this.error(token, `Missing operand for ${token.value}`);
        return null;
      }
      return {
        type: "Unary",
        operator: token.value as UnaryExpression["operator"],
        argument,
        span: { start: token.start, end: argument.span.end },
      } satisfies UnaryExpression;
    }
    if (this.match("(")) {
      const start = token.start;
      const expr = this.parseExpression(0);
      const close = this.expect(")", "Expected closing parenthesis");
      if (!expr) return null;
      expr.span = { start, end: close?.end ?? expr.span.end };
      return expr;
    }
    if (this.match("[")) return this.parseArray(token);
    if (this.match("{")) return this.unsupportedObjectLiteral(token);
    this.error(token, `Expected expression, got ${JSON.stringify(token.raw || token.value)}`);
    if (!this.at("eof")) this.advance();
    return null;
  }

  private parsePostfix(expr: Expression): Expression {
    let current = expr;
    while (true) {
      if (this.match(".")) {
        const property = this.current();
        if (property.type !== "identifier") {
          this.error(property, "Expected property name after dot");
          continue;
        }
        this.advance();
        current = {
          type: "Member",
          object: current,
          property: property.value,
          computed: false,
          span: { start: current.span.start, end: property.end },
        } satisfies MemberExpression;
        continue;
      }
      if (this.match("[")) {
        const property = this.parseExpression(0);
        const close = this.expect("]", "Expected closing bracket");
        if (!property) continue;
        current = {
          type: "Member",
          object: current,
          property,
          computed: true,
          span: { start: current.span.start, end: close?.end ?? property.span.end },
        } satisfies MemberExpression;
        continue;
      }
      if (this.match("(")) {
        const args: Expression[] = [];
        if (!this.check(")")) {
          while (true) {
            const arg = this.parseExpression(0);
            if (arg) args.push(arg);
            if (!this.match(",")) break;
          }
        }
        const close = this.expect(")", "Expected closing parenthesis");
        current = {
          type: "Call",
          callee: current,
          args,
          span: { start: current.span.start, end: close?.end ?? current.span.end },
        } satisfies CallExpression;
        continue;
      }
      return current;
    }
  }

  private parseArray(open: Token): ArrayExpression {
    const elements: Expression[] = [];
    if (!this.check("]")) {
      while (true) {
        const element = this.parseExpression(0);
        if (element) elements.push(element);
        if (!this.match(",")) break;
      }
    }
    const close = this.expect("]", "Expected closing array bracket");
    return {
      type: "Array",
      elements,
      span: { start: open.start, end: close?.end ?? open.end },
    };
  }

  private unsupportedObjectLiteral(open: Token): null {
    let depth = 1;
    while (!this.at("eof") && depth > 0) {
      const token = this.advance();
      if (token.type === "punct" && token.value === "{") depth++;
      if (token.type === "punct" && token.value === "}") depth--;
    }
    const end = this.tokens[Math.max(0, this.i - 1)]?.end ?? open.end;
    this.diagnostics.push({
      code: "unsupported-object-literal",
      message: "Object literals are not supported by the observed Obsidian Bases runtime",
      severity: "error",
      span: { start: open.start, end },
    });
    return null;
  }

  private match(value: string): boolean {
    if (!this.check(value)) return false;
    this.advance();
    return true;
  }

  private expect(value: string, message: string): Token | null {
    if (this.check(value)) return this.advance();
    this.error(this.current(), message);
    return null;
  }

  private check(value: string): boolean {
    const token = this.current();
    return token.type === "punct" && token.value === value;
  }

  private at(type: Token["type"]): boolean {
    return this.current().type === type;
  }

  private advance(): Token {
    const token = this.current();
    if (!this.at("eof")) this.i++;
    return token;
  }

  private current(): Token {
    return this.tokens[this.i] ?? this.tokens[this.tokens.length - 1]!;
  }

  private error(token: Token, message: string): void {
    this.diagnostics.push({
      code: "parse-error",
      message,
      severity: "error",
      span: spanOf(token),
    });
  }
}

function spanOf(token: Token): Span {
  return { start: token.start, end: token.end };
}
