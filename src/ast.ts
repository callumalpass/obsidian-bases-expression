export interface Span {
  start: number;
  end: number;
}

export type Expression =
  | IdentifierExpression
  | LiteralExpression
  | RegexExpression
  | ArrayExpression
  | ObjectExpression
  | UnaryExpression
  | BinaryExpression
  | MemberExpression
  | CallExpression;

export interface ExpressionBase {
  type: string;
  span: Span;
}

export interface IdentifierExpression extends ExpressionBase {
  type: "Identifier";
  name: string;
}

export interface LiteralExpression extends ExpressionBase {
  type: "Literal";
  value: null | boolean | number | string;
  raw: string;
}

export interface RegexExpression extends ExpressionBase {
  type: "Regex";
  pattern: string;
  flags: string;
  raw: string;
}

export interface ArrayExpression extends ExpressionBase {
  type: "Array";
  elements: Expression[];
}

export interface ObjectExpression extends ExpressionBase {
  type: "Object";
  properties: Array<{
    key: string;
    value: Expression;
    span: Span;
  }>;
}

export interface UnaryExpression extends ExpressionBase {
  type: "Unary";
  operator: "!" | "-" | "+";
  argument: Expression;
}

export interface BinaryExpression extends ExpressionBase {
  type: "Binary";
  operator:
    | "+"
    | "-"
    | "*"
    | "/"
    | "%"
    | "=="
    | "!="
    | ">"
    | "<"
    | ">="
    | "<="
    | "&&"
    | "||";
  left: Expression;
  right: Expression;
}

export interface MemberExpression extends ExpressionBase {
  type: "Member";
  object: Expression;
  property: string | Expression;
  computed: boolean;
}

export interface CallExpression extends ExpressionBase {
  type: "Call";
  callee: Expression;
  args: Expression[];
}

export interface Diagnostic {
  code: string;
  message: string;
  severity: "error" | "warning" | "info";
  span: Span;
}
