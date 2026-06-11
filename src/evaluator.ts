import moment from "moment";
import type { Diagnostic, Expression, MemberExpression } from "./ast.js";
import { parseExpression } from "./parser.js";
import {
  addDuration,
  boolValue,
  dateValue,
  durationToMilliseconds,
  durationValue,
  errorValue,
  fileValue,
  fromJs,
  isEmpty,
  isTruthy,
  linkValue,
  listValue,
  nullValue,
  numberValue,
  objectValue,
  parseDuration,
  regexpValue,
  scaleDuration,
  stringValue,
  stringifyValue,
  toPlain,
  type FileValueInput,
  type FileValue,
  type LinkValue,
  type RuntimeValue,
} from "./value.js";

export interface EvaluationContext {
  note?: Record<string, unknown>;
  objects?: Record<string, unknown>;
  file?: Partial<FileValueInput> & { path?: string };
  thisFile?: Partial<FileValueInput> & { path?: string };
  files?: FileValueInput[];
  linkResolutions?: Record<string, string | null>;
  formulas?: Record<string, string | Expression>;
  propertyTypes?: Record<string, "date" | "string" | "number" | "boolean" | "list" | "object" | "link">;
  now?: Date | string | number;
  random?: () => number;
  functions?: Record<string, (...args: RuntimeValue[]) => RuntimeValue>;
}

export interface EvaluationResult {
  value: RuntimeValue;
  ast: Expression | null;
  diagnostics: Diagnostic[];
}

type Scope = Record<string, RuntimeValue>;

export function evaluateExpression(sourceOrAst: string | Expression, context: EvaluationContext = {}): EvaluationResult {
  const parsed = typeof sourceOrAst === "string" ? parseExpression(sourceOrAst) : { ast: sourceOrAst, diagnostics: [], tokens: [] };
  if (!parsed.ast || parsed.diagnostics.some((d) => d.severity === "error")) {
    if (parsed.diagnostics.some((diagnostic) => diagnostic.code === "unsupported-object-literal")) {
      return {
        value: nullValue(),
        ast: parsed.ast,
        diagnostics: parsed.diagnostics,
      };
    }
    return {
      value: errorValue(parsed.diagnostics[0]?.message ?? "Invalid expression"),
      ast: parsed.ast,
      diagnostics: parsed.diagnostics,
    };
  }
  const evaluator = new Evaluator(context);
  return {
    value: evaluator.eval(parsed.ast),
    ast: parsed.ast,
    diagnostics: parsed.diagnostics,
  };
}

export class Evaluator {
  private readonly now: Date;
  private readonly formulaCache = new Map<string, RuntimeValue>();
  private readonly formulaStack = new Set<string>();

  constructor(private readonly context: EvaluationContext = {}) {
    this.now = context.now ? new Date(context.now) : new Date();
  }

  eval(expr: Expression, scope: Scope = {}): RuntimeValue {
    try {
      switch (expr.type) {
        case "Literal":
          return fromJs(expr.value);
        case "Regex":
          return regexpValue(new RegExp(expr.pattern, expr.flags));
        case "Identifier":
          return this.resolveIdentifier(expr.name, scope);
        case "Array":
          return listValue(expr.elements.map((element) => this.eval(element, scope)));
        case "Object":
          return objectValue(Object.fromEntries(expr.properties.map((property) => [property.key, this.eval(property.value, scope)])));
        case "Unary":
          return this.evalUnary(expr.operator, this.eval(expr.argument, scope));
        case "Binary":
          return this.evalBinary(expr.operator, expr.left, expr.right, scope);
        case "Member":
          return this.evalMember(expr, scope);
        case "Call":
          return this.evalCall(expr.callee, expr.args, scope);
      }
    } catch (error) {
      return errorValue(error instanceof Error ? error.message : String(error));
    }
  }

  private resolveIdentifier(name: string, scope: Scope): RuntimeValue {
    if (Object.prototype.hasOwnProperty.call(scope, name)) return scope[name]!;
    if (name === "note") return this.noteObject();
    if (name === "file") return this.fileObject(this.context.file);
    if (name === "this") return objectValue({ file: this.fileObject(this.context.thisFile ?? this.context.file) });
    if (name === "formula") return objectValue({});
    if (name === "values") return this.noteProperty("values");
    const objects = this.context.objects ?? {};
    if (Object.prototype.hasOwnProperty.call(objects, name)) return fromJs(objects[name]);
    const note = this.context.note ?? {};
    if (Object.prototype.hasOwnProperty.call(note, name)) return this.noteProperty(name);
    return nullValue();
  }

  private evalUnary(operator: string, value: RuntimeValue): RuntimeValue {
    if (operator === "!") return boolValue(!isTruthy(value));
    if (operator === "-") return numberValue(-this.asNumber(value));
    if (operator === "+") return numberValue(this.asNumber(value));
    return errorValue(`Unsupported unary operator ${operator}`);
  }

  private evalBinary(operator: string, leftExpr: Expression, rightExpr: Expression, scope: Scope): RuntimeValue {
    if (operator === "&&") {
      const left = this.eval(leftExpr, scope);
      return isTruthy(left) ? boolValue(isTruthy(this.eval(rightExpr, scope))) : boolValue(false);
    }
    if (operator === "||") {
      const left = this.eval(leftExpr, scope);
      return isTruthy(left) ? boolValue(true) : boolValue(isTruthy(this.eval(rightExpr, scope)));
    }
    const left = this.eval(leftExpr, scope);
    const right = this.eval(rightExpr, scope);
    if (left.type === "Error") return left;
    if (right.type === "Error") return right;
    switch (operator) {
      case "+":
        return this.add(left, right);
      case "-":
        return this.subtract(left, right);
      case "*":
        if (left.type === "Duration" && right.type === "Number") return durationValue(scaleDuration(left.value, right.value));
        if (left.type === "Number" && right.type === "Duration") return errorValue("Invalid operator between Number and Duration");
        return numberValue(this.asNumber(left) * this.asNumber(right));
      case "/":
        return numberValue(this.asNumber(left) / this.asNumber(right));
      case "%":
        return numberValue(this.asNumber(left) % this.asNumber(right));
      case "==":
        return boolValue(this.equals(left, right));
      case "!=":
        return boolValue(!this.equals(left, right));
      case ">":
      case "<":
      case ">=":
      case "<=":
        return boolValue(this.compare(left, right, operator));
      default:
        return errorValue(`Unsupported operator ${operator}`);
    }
  }

  private add(left: RuntimeValue, right: RuntimeValue): RuntimeValue {
    const duration = this.coerceDuration(right);
    if (left.type === "Date" && duration) return dateValue(addDuration(left.value, duration), left.dateOnly);
    if (left.type === "String" || right.type === "String") return stringValue(stringifyValue(left) + stringifyValue(right));
    if (left.type === "Duration" && right.type === "Duration") {
      return durationValue({
        years: left.value.years + right.value.years,
        months: left.value.months + right.value.months,
        weeks: left.value.weeks + right.value.weeks,
        days: left.value.days + right.value.days,
        hours: left.value.hours + right.value.hours,
        minutes: left.value.minutes + right.value.minutes,
        seconds: left.value.seconds + right.value.seconds,
        milliseconds: left.value.milliseconds + right.value.milliseconds,
      });
    }
    return numberValue(this.asNumber(left) + this.asNumber(right));
  }

  private subtract(left: RuntimeValue, right: RuntimeValue): RuntimeValue {
    const duration = this.coerceDuration(right);
    if (left.type === "Date" && right.type === "Date") return durationValue({ milliseconds: left.value.getTime() - right.value.getTime() });
    if (left.type === "Date" && duration) return dateValue(addDuration(left.value, duration, -1), left.dateOnly);
    return numberValue(this.asNumber(left) - this.asNumber(right));
  }

  private evalMember(expr: MemberExpression, scope: Scope): RuntimeValue {
    if (!expr.computed && typeof expr.property === "string") {
      if (expr.object.type === "Identifier" && expr.object.name === "formula") return this.evalFormula(expr.property);
      if (expr.object.type === "Identifier" && expr.object.name === "note") return this.noteProperty(expr.property);
    }
    const object = this.eval(expr.object, scope);
    const property = expr.computed ? this.eval(expr.property as Expression, scope) : stringValue(expr.property as string);
    return this.getProperty(object, stringifyValue(property));
  }

  private evalCall(callee: Expression, args: Expression[], scope: Scope): RuntimeValue {
    if (callee.type === "Identifier") {
      if (callee.name === "if") return this.callIf(args, scope);
      const values = args.map((arg) => this.eval(arg, scope));
      const custom = this.context.functions?.[callee.name];
      if (custom) return custom(...values);
      return this.callGlobal(callee.name, values);
    }
    if (callee.type === "Member" && !callee.computed && typeof callee.property === "string") {
      const receiver = this.eval(callee.object, scope);
      return this.callMethod(receiver, callee.property, args, scope);
    }
    return errorValue("Expression is not callable");
  }

  private callIf(args: Expression[], scope: Scope): RuntimeValue {
    const condition = args[0] ? this.eval(args[0], scope) : nullValue();
    if (isTruthy(condition)) return args[1] ? this.eval(args[1], scope) : nullValue();
    return args[2] ? this.eval(args[2], scope) : nullValue();
  }

  private callGlobal(name: string, args: RuntimeValue[]): RuntimeValue {
    switch (name) {
      case "escapeHTML":
        return stringValue(escapeHtml(stringifyValue(args[0] ?? nullValue())));
      case "date":
        return dateValue(stringifyValue(args[0] ?? nullValue()));
      case "duration": {
        const parsed = parseDuration(stringifyValue(args[0] ?? nullValue()));
        return parsed ? durationValue(parsed) : errorValue("Invalid duration");
      }
      case "file": {
        const arg = args[0] ?? nullValue();
        if (arg.type === "File") return arg;
        if (arg.type === "Link") return this.fileFromLink(arg.value);
        return this.fileFromTarget(stringifyValue(arg));
      }
      case "html":
        return { type: "HTML", value: stringifyValue(args[0] ?? nullValue()) };
      case "image": {
        const arg = args[0] ?? nullValue();
        return { type: "Image", value: arg.type === "File" || arg.type === "Link" ? arg.value : stringifyValue(arg) };
      }
      case "icon":
        return { type: "Icon", value: stringifyValue(args[0] ?? nullValue()) };
      case "link":
        return this.makeLink(stringifyValue(args[0] ?? nullValue()), args[1]);
      case "list": {
        const value = args[0] ?? nullValue();
        return value.type === "List" ? value : listValue([value]);
      }
      case "max":
        return numberValue(Math.max(...args.map((arg) => this.asNumber(arg))));
      case "min":
        return numberValue(Math.min(...args.map((arg) => this.asNumber(arg))));
      case "now":
        return dateValue(this.now);
      case "number":
        return numberValue(this.asNumber(args[0] ?? nullValue()));
      case "today":
        return dateValue(moment(this.now).startOf("day").toDate(), true);
      case "random":
        return numberValue((this.context.random ?? Math.random)());
      default:
        return errorValue(`Cannot find function "${name}"`);
    }
  }

  private callMethod(receiver: RuntimeValue, name: string, argExprs: Expression[], scope: Scope): RuntimeValue {
    if (receiver.type === "Error") return receiver;
    if (name === "isTruthy") return boolValue(isTruthy(receiver));
    if (name === "isType") return boolValue(receiver.type.toLowerCase() === stringifyValue(this.eval(argExprs[0]!, scope)).toLowerCase());
    if (name === "toString") return stringValue(stringifyValue(receiver));
    if (name === "isEmpty") return boolValue(isEmpty(receiver));

    if (receiver.type === "String") return this.callString(receiver.value, name, argExprs.map((arg) => this.eval(arg, scope)));
    if (receiver.type === "Number") return this.callNumber(receiver.value, name, argExprs.map((arg) => this.eval(arg, scope)));
    if (receiver.type === "Date") return this.callDate(receiver.value, name, argExprs.map((arg) => this.eval(arg, scope)));
    if (receiver.type === "List") return this.callList(receiver.value, name, argExprs, scope);
    if (receiver.type === "Object") return this.callObject(receiver.value, name);
    if (receiver.type === "RegExp" && name === "matches") return boolValue(receiver.value.test(stringifyValue(this.eval(argExprs[0]!, scope))));
    if (receiver.type === "File") return this.callFile(receiver.value, name, argExprs.map((arg) => this.eval(arg, scope)));
    if (receiver.type === "Link") return this.callLink(receiver.value, name, argExprs.map((arg) => this.eval(arg, scope)));
    return this.methodNotFound(receiver, name);
  }

  private callString(value: string, name: string, args: RuntimeValue[]): RuntimeValue {
    switch (name) {
      case "contains":
        return boolValue(value.includes(stringifyValue(args[0] ?? nullValue())));
      case "containsAll":
        return boolValue(args.every((arg) => value.includes(stringifyValue(arg))));
      case "containsAny":
        return boolValue(args.some((arg) => value.includes(stringifyValue(arg))));
      case "endsWith":
        return boolValue(value.endsWith(stringifyValue(args[0] ?? nullValue())));
      case "lower":
        return stringValue(value.toLowerCase());
      case "replace": {
        const pattern = args[0] ?? nullValue();
        const replacement = stringifyValue(args[1] ?? stringValue(""));
        return stringValue(pattern.type === "RegExp" ? value.replace(pattern.value, replacement) : value.split(stringifyValue(pattern)).join(replacement));
      }
      case "repeat":
        return stringValue(value.repeat(this.asNumber(args[0] ?? numberValue(0))));
      case "reverse":
        return stringValue([...value].reverse().join(""));
      case "slice":
        return stringValue(value.slice(this.asNumber(args[0] ?? numberValue(0)), args[1] ? this.asNumber(args[1]) : undefined));
      case "split": {
        const sep = args[0] ?? stringValue("");
        const pieces = sep.type === "RegExp" ? value.split(sep.value) : value.split(stringifyValue(sep));
        const limit = args[1] ? this.asNumber(args[1]) : undefined;
        return listValue(pieces.slice(0, limit).map(stringValue));
      }
      case "startsWith":
        return boolValue(value.startsWith(stringifyValue(args[0] ?? nullValue())));
      case "title":
        return stringValue(value.replace(/\p{L}+/gu, (word) => word[0]!.toUpperCase() + word.slice(1).toLowerCase()));
      case "trim":
        return stringValue(value.trim());
      default:
        return this.methodNotFound("String", name);
    }
  }

  private callNumber(value: number, name: string, args: RuntimeValue[]): RuntimeValue {
    switch (name) {
      case "abs":
        return numberValue(Math.abs(value));
      case "ceil":
        return numberValue(Math.ceil(value));
      case "floor":
        return numberValue(Math.floor(value));
      case "round": {
        const digits = args[0] ? this.asNumber(args[0]) : 0;
        const factor = 10 ** digits;
        return numberValue(Math.round(value * factor) / factor);
      }
      case "toFixed":
        return stringValue(value.toFixed(this.asNumber(args[0] ?? numberValue(0))));
      default:
        return this.methodNotFound("Number", name);
    }
  }

  private callDate(value: Date, name: string, args: RuntimeValue[]): RuntimeValue {
    const m = moment(value);
    switch (name) {
      case "date":
        return dateValue(m.startOf("day").toDate(), true);
      case "format":
        return stringValue(m.format(stringifyValue(args[0] ?? stringValue(""))));
      case "time":
        return stringValue(m.format("HH:mm:ss"));
      case "relative":
        return stringValue(m.from(moment(this.now)));
      default:
        return this.methodNotFound("Date", name);
    }
  }

  private callList(values: RuntimeValue[], name: string, argExprs: Expression[], scope: Scope): RuntimeValue {
    switch (name) {
      case "contains":
        return boolValue(values.some((value) => this.equals(value, this.eval(argExprs[0]!, scope))));
      case "containsAll":
        return boolValue(argExprs.every((arg) => values.some((value) => this.equals(value, this.eval(arg, scope)))));
      case "containsAny":
        return boolValue(argExprs.some((arg) => values.some((value) => this.equals(value, this.eval(arg, scope)))));
      case "filter":
        return listValue(values.filter((value, index) => isTruthy(this.eval(argExprs[0]!, { ...scope, value, index: numberValue(index) }))));
      case "flat":
        return listValue(values.flatMap((value) => (value.type === "List" ? value.value : [value])));
      case "join":
        return stringValue(values.map(stringifyValue).join(stringifyValue(this.eval(argExprs[0]!, scope))));
      case "map":
        return listValue(values.map((value, index) => this.eval(argExprs[0]!, { ...scope, value, index: numberValue(index) })));
      case "reduce": {
        let acc = argExprs[1] ? this.eval(argExprs[1], scope) : nullValue();
        for (let index = 0; index < values.length; index++) {
          acc = this.eval(argExprs[0]!, { ...scope, acc, value: values[index]!, index: numberValue(index) });
        }
        return acc;
      }
      case "reverse":
        return listValue([...values].reverse());
      case "slice":
        return listValue(values.slice(this.asNumber(this.eval(argExprs[0]!, scope)), argExprs[1] ? this.asNumber(this.eval(argExprs[1], scope)) : undefined));
      case "sort":
        return listValue([...values].sort((a, b) => this.sortKey(a).localeCompare(this.sortKey(b), undefined, { numeric: true })));
      case "unique": {
        const seen = new Set<string>();
        return listValue(values.filter((value) => {
          const key = this.uniqueKey(value);
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        }));
      }
      case "sum":
        return numberValue(values.reduce((acc, value) => acc + this.asNumber(value), 0));
      case "mean":
        return values.length ? numberValue(values.reduce((acc, value) => acc + this.asNumber(value), 0) / values.length) : nullValue();
      default:
        return this.methodNotFound("List", name);
    }
  }

  private callObject(value: Record<string, RuntimeValue>, name: string): RuntimeValue {
    if (name === "keys") return listValue(Object.keys(value).map(stringValue));
    if (name === "values") return listValue(Object.values(value));
    return this.methodNotFound("Object", name);
  }

  private callFile(value: FileValue, name: string, args: RuntimeValue[]): RuntimeValue {
    switch (name) {
      case "asLink":
        return linkValue(value.path, args[0]);
      case "hasLink": {
        const target = args[0] ?? nullValue();
        return boolValue(value.links.some((link) => this.linkMatchesTarget(link, target)));
      }
      case "hasProperty":
        return boolValue(Object.prototype.hasOwnProperty.call(value.properties, stringifyValue(args[0] ?? nullValue())));
      case "hasTag": {
        const needles = args.map((arg) => normalizeTag(stringifyValue(arg)));
        return boolValue(needles.some((needle) => value.tags.some((tag) => normalizeTag(tag) === needle || normalizeTag(tag).startsWith(`${needle}/`))));
      }
      case "inFolder": {
        const folder = stringifyValue(args[0] ?? nullValue()).replace(/\/+$/, "");
        return boolValue(value.folder === folder || value.folder.startsWith(`${folder}/`));
      }
      default:
        return this.methodNotFound("File", name);
    }
  }

  private callLink(value: LinkValue, name: string, args: RuntimeValue[]): RuntimeValue {
    if (name === "asFile") return this.fileFromLink(value);
    if (name === "linksTo") {
      const file = this.fileFromLink(value);
      if (file.type !== "File") return errorValue("Could not coerce link to file");
      return this.callFile(file.value, "hasLink", args);
    }
    return this.methodNotFound("Link", name);
  }

  private getProperty(object: RuntimeValue, property: string): RuntimeValue {
    switch (object.type) {
      case "Null":
        return nullValue();
      case "String":
        if (property === "length") return numberValue([...object.value].length);
        return this.memberNotFound("String", property);
      case "List":
        if (property === "length") return numberValue(object.value.length);
        if (/^-?\d+$/.test(property)) return object.value[Number(property)] ?? nullValue();
        return this.memberNotFound("List", property);
      case "Object":
        return object.value[property] ?? nullValue();
      case "Date":
        return this.getDateField(object.value, property);
      case "File":
        return this.getFileField(object.value, property);
      case "Link":
        return this.memberNotFound("Link", property);
      case "Error":
        return object;
      default:
        return this.memberNotFound(object.type, property);
    }
  }

  private getDateField(value: Date, property: string): RuntimeValue {
    const m = moment(value);
    switch (property) {
      case "year":
        return numberValue(m.year());
      case "month":
        return numberValue(m.month() + 1);
      case "day":
        return numberValue(m.date());
      case "hour":
        return numberValue(m.hour());
      case "minute":
        return numberValue(m.minute());
      case "second":
        return numberValue(m.second());
      case "millisecond":
        return numberValue(m.millisecond());
      default:
        return this.memberNotFound("Date", property);
    }
  }

  private getFileField(value: FileValue, property: string): RuntimeValue {
    switch (property) {
      case "name":
        return stringValue(value.basename);
      case "basename":
        return stringValue(value.basename);
      case "path":
      case "folder":
      case "ext":
        return stringValue(value[property]);
      case "size":
        return numberValue(value.size);
      case "properties":
        return fromJs(value.properties);
      case "tags":
        return listValue(value.tags.map(stringValue));
      case "links":
        return listValue(value.links.map((link) => ({ type: "Link", value: link })));
      case "embeds":
        return listValue(value.embeds.map((link) => ({ type: "Link", value: link })));
      case "backlinks":
        return listValue(value.backlinks.map((link) => ({ type: "Link", value: link })));
      case "ctime":
      case "mtime":
        return dateValue(value[property]);
      case "file":
        return { type: "File", value };
      default:
        return this.memberNotFound("File", property);
    }
  }

  private memberNotFound(type: RuntimeValue["type"], property: string): RuntimeValue {
    return errorValue(`Cannot find "${property}" on type ${type}`);
  }

  private methodNotFound(receiver: RuntimeValue | RuntimeValue["type"], name: string): RuntimeValue {
    const type = typeof receiver === "string" ? receiver : receiver.type;
    return errorValue(`Cannot find function "${name}" on type ${type}`);
  }

  private evalFormula(name: string): RuntimeValue {
    if (this.formulaCache.has(name)) return this.formulaCache.get(name)!;
    const formula = this.context.formulas?.[name];
    if (!formula) return nullValue();
    if (this.formulaStack.has(name)) return errorValue(`Circular formula reference ${name}`);
    this.formulaStack.add(name);
    const ast = typeof formula === "string" ? parseExpression(formula).ast : formula;
    const value = ast ? this.eval(ast) : errorValue(`Invalid formula ${name}`);
    this.formulaStack.delete(name);
    this.formulaCache.set(name, value);
    return value;
  }

  private noteObject(): RuntimeValue {
    const result: Record<string, RuntimeValue> = {};
    for (const key of Object.keys(this.context.note ?? {})) result[key] = this.noteProperty(key);
    return objectValue(result);
  }

  private noteProperty(name: string): RuntimeValue {
    const raw = this.context.note?.[name];
    if (this.context.propertyTypes?.[name] === "link") {
      const value = fromJs(raw);
      return value.type === "Link" ? value : this.makeLink(stringifyValue(value));
    }
    return fromJs(raw, this.context.propertyTypes?.[name]);
  }

  private fileObject(file: EvaluationContext["file"]): RuntimeValue {
    const path = file?.path ?? "";
    const registered = this.context.files?.find((item) => item.path === path);
    return fileValue({
      ...registered,
      ...file,
      path,
      properties: file?.properties ?? registered?.properties ?? this.context.note ?? {},
    });
  }

  private makeLink(target: string, display?: RuntimeValue): RuntimeValue {
    const parsed = parseLinkText(target);
    return linkValue(parsed.target, display ?? (parsed.display === undefined ? undefined : stringValue(parsed.display)), this.resolveLinkPath(parsed.target));
  }

  private fileFromTarget(target: string): RuntimeValue {
    const parsed = parseLinkText(target);
    const resolved = this.resolveLinkPath(parsed.target);
    if (resolved === null) return nullValue();
    return this.fileObject({ path: resolved ?? stripLinkSubpath(parsed.target) });
  }

  private fileFromLink(link: LinkValue): RuntimeValue {
    const resolved = link.resolvedPath ?? this.resolveLinkPath(link.path);
    if (resolved === null) return nullValue();
    return this.fileObject({ path: resolved ?? stripLinkSubpath(link.path) });
  }

  private resolveLinkPath(target: string): string | null | undefined {
    const parsed = parseLinkText(target);
    const baseTarget = stripLinkSubpath(parsed.target);
    const table = this.context.linkResolutions;
    for (const candidate of linkResolutionKeys(parsed.target, baseTarget)) {
      if (table && Object.prototype.hasOwnProperty.call(table, candidate)) return table[candidate] ?? null;
    }

    const file = this.findFileByLinkTarget(baseTarget);
    return file?.path;
  }

  private findFileByLinkTarget(target: string): FileValueInput | undefined {
    const files = this.context.files ?? [];
    const normalizedTarget = normalizePath(target);
    const markdownTarget = normalizePath(ensureMarkdownExtension(target));
    const basenameTarget = withoutMarkdownExtension(target);
    const normalizedTargetLower = normalizedTarget.toLowerCase();
    const markdownTargetLower = markdownTarget.toLowerCase();
    const basenameTargetLower = basenameTarget.toLowerCase();
    return (
      files.find((file) => normalizePath(file.path) === normalizedTarget) ??
      files.find((file) => normalizePath(file.path) === markdownTarget) ??
      files.find((file) => normalizePath(file.path).endsWith(`/${markdownTarget}`)) ??
      files.find((file) => file.basename === target || withoutMarkdownExtension(file.name ?? "") === target) ??
      files.find((file) => normalizePath(file.path).toLowerCase() === normalizedTargetLower) ??
      files.find((file) => normalizePath(file.path).toLowerCase() === markdownTargetLower) ??
      files.find((file) => normalizePath(file.path).toLowerCase().endsWith(`/${markdownTargetLower}`)) ??
      files.find(
        (file) =>
          (file.basename ?? "").toLowerCase() === basenameTargetLower ||
          withoutMarkdownExtension(file.name ?? "").toLowerCase() === basenameTargetLower,
      )
    );
  }

  private linkMatchesTarget(link: LinkValue, target: RuntimeValue): boolean {
    const targetPath = target.type === "File" ? target.value.path : target.type === "Link" ? target.value.path : parseLinkText(stringifyValue(target)).target;
    if (link.path === targetPath) return true;

    const linkResolved = link.resolvedPath ?? this.resolveLinkPath(link.path);
    const targetResolved = target.type === "File" ? target.value.path : target.type === "Link" ? target.value.resolvedPath ?? this.resolveLinkPath(target.value.path) : this.resolveLinkPath(targetPath);
    if (linkResolved !== null && targetResolved !== null && linkResolved !== undefined && targetResolved !== undefined) {
      return linkResolved === targetResolved;
    }

    if (linkResolved === null || targetResolved === null) return false;
    return sameMarkdownPathVariant(stripLinkSubpath(link.path), stripLinkSubpath(targetPath));
  }

  private asNumber(value: RuntimeValue): number {
    switch (value.type) {
      case "Number":
        return value.value;
      case "Boolean":
        return value.value ? 1 : 0;
      case "String": {
        const n = Number(value.value);
        if (Number.isNaN(n)) throw new Error(`Unable to parse ${JSON.stringify(value.value)} as a number.`);
        return n;
      }
      case "Date":
        return value.value.getTime();
      case "Duration":
        return durationToMilliseconds(value.value);
      case "Null":
        return 0;
      default:
        throw new Error(`Cannot convert ${value.type} to number`);
    }
  }

  private coerceDuration(value: RuntimeValue) {
    if (value.type === "Duration") return value.value;
    if (value.type === "String") return parseDuration(value.value);
    return null;
  }

  private equals(left: RuntimeValue, right: RuntimeValue): boolean {
    if (left.type === "Link" && right.type === "Link") return this.linkIdentity(left.value) === this.linkIdentity(right.value);
    if (left.type === "Link" && right.type === "File") return this.linkResolvedPath(left.value) === right.value.path;
    if (left.type === "File" && right.type === "Link") return left.value.path === this.linkResolvedPath(right.value);
    if (left.type === "Date" && right.type === "Date") return left.value.getTime() === right.value.getTime();
    return JSON.stringify(toPlain(left)) === JSON.stringify(toPlain(right));
  }

  private linkIdentity(link: LinkValue): string {
    const resolved = this.linkResolvedPath(link);
    if (resolved !== null) return `file:${resolved}`;
    return `link:${link.path}`;
  }

  private linkResolvedPath(link: LinkValue): string | null {
    const resolved = link.resolvedPath ?? this.resolveLinkPath(link.path);
    return resolved === undefined ? stripLinkSubpath(link.path) : resolved;
  }

  private uniqueKey(value: RuntimeValue): string {
    return value.type === "Link" ? stringifyValue(value) : JSON.stringify(toPlain(value));
  }

  private compare(left: RuntimeValue, right: RuntimeValue, op: string): boolean {
    const a = left.type === "String" && right.type === "String" ? left.value : this.asNumber(left);
    const b = left.type === "String" && right.type === "String" ? right.value : this.asNumber(right);
    if (op === ">") return a > b;
    if (op === "<") return a < b;
    if (op === ">=") return a >= b;
    return a <= b;
  }

  private sortKey(value: RuntimeValue): string {
    if (value.type === "Number") return value.value.toString().padStart(20, "0");
    return stringifyValue(value);
  }
}

function normalizeTag(tag: string): string {
  return tag.replace(/^#/, "");
}

function parseLinkText(input: string): { target: string; display?: string } {
  let value = input.trim();
  if (value.startsWith("!")) value = value.slice(1).trim();
  if (value.startsWith("[[") && value.endsWith("]]")) value = value.slice(2, -2);
  const pipe = value.indexOf("|");
  if (pipe < 0) return { target: value };
  return { target: value.slice(0, pipe), display: value.slice(pipe + 1) };
}

function stripLinkSubpath(target: string): string {
  const hash = target.indexOf("#");
  return hash < 0 ? target : target.slice(0, hash);
}

function linkResolutionKeys(target: string, baseTarget: string): string[] {
  return [...new Set([target, baseTarget, ensureMarkdownExtension(target), ensureMarkdownExtension(baseTarget), withoutMarkdownExtension(target), withoutMarkdownExtension(baseTarget)])];
}

function ensureMarkdownExtension(path: string): string {
  const hash = path.indexOf("#");
  const head = hash < 0 ? path : path.slice(0, hash);
  const tail = hash < 0 ? "" : path.slice(hash);
  return /\.[^/.]+$/.test(head) ? path : `${head}.md${tail}`;
}

function withoutMarkdownExtension(path: string): string {
  return path.replace(/\.md(?=#|$)/, "");
}

function sameMarkdownPathVariant(left: string, right: string): boolean {
  return normalizePath(withoutMarkdownExtension(left)) === normalizePath(withoutMarkdownExtension(right));
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\/+/, "");
}

function escapeHtml(input: string): string {
  return input
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
