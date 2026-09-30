/**
 * Lua 5.1 parser — produces an AST consumed by the tree-walk VM in vm.ts.
 * Supports the statement/expression grammar the bundled plugins use: locals,
 * globals, assignments, function definitions (named/local), calls (., :,
 * parens, string/table), if/while/repeat/for (numeric + generic), return,
 * break, do, and table constructors.
 */
import { lex, type Tok } from "./lexer";

export type Expr =
  | { t: "num"; value: number }
  | { t: "str"; value: string }
  | { t: "bool"; value: boolean }
  | { t: "nil" }
  | { t: "var"; name: string }
  | { t: "vararg" }
  | { t: "index"; obj: Expr; key: Expr | null; method: boolean }
  | { t: "call"; callee: Expr; args: Expr[] }
  | { t: "fn"; fn: FnDef }
  | { t: "table"; items: TableItem[] }
  | { t: "bin"; op: string; l: Expr; r: Expr }
  | { t: "concat"; parts: Expr[] }
  | { t: "unary"; op: string; e: Expr }
  | { t: "and"; l: Expr; r: Expr }
  | { t: "or"; l: Expr; r: Expr }
  | { t: "compare"; op: string; l: Expr; r: Expr };

export interface TableItem { key: Expr | null; value: Expr; }
export interface FnDef { params: string[]; vararg: boolean; body: Stmt[]; }
export type Target = { t: "var"; name: string } | { t: "index"; obj: Expr; key: Expr; method: boolean };

export type Stmt =
  | { t: "local"; vars: string[]; exprs: Expr[] }
  | { t: "assign"; targets: Target[]; exprs: Expr[] }
  | { t: "call"; expr: Expr }
  | { t: "func"; name: string; fn: FnDef }
  | { t: "localfunc"; name: string; fn: FnDef }
  | { t: "if"; cond: Expr; then: Stmt[]; elseifs: { cond: Expr; body: Stmt[] }[]; else?: Stmt[] }
  | { t: "while"; cond: Expr; body: Stmt[] }
  | { t: "repeat"; cond: Expr; body: Stmt[] }
  | { t: "nfor"; var: string; from: Expr; to: Expr; step: Expr | null; body: Stmt[] }
  | { t: "gfor"; vars: string[]; iters: Expr[]; body: Stmt[] }
  | { t: "return"; exprs: Expr[] }
  | { t: "break" }
  | { t: "do"; body: Stmt[] };

export class ParseError extends Error {}

class Parser {
  private pos = 0;
  constructor(private toks: Tok[]) {}
  private cur(): Tok { return this.toks[this.pos] ?? { kind: "eof" }; }
  private next(): Tok { return this.toks[this.pos++]; }
  private peek(n = 0): Tok { return this.toks[this.pos + n] ?? { kind: "eof" }; }
  private check(op: string): boolean { const t = this.cur(); return t.kind === "op" && t.value === op; }
  private checkName(name: string): boolean { const t = this.cur(); return t.kind === "name" && t.value === name; }
  private expect(op: string): void {
    if (!this.check(op)) throw new ParseError(`expected '${op}', got ${JSON.stringify(this.cur())}`);
    this.next();
  }
  private expectName(name: string): void {
    if (!this.checkName(name)) throw new ParseError(`expected '${name}', got ${JSON.stringify(this.cur())}`);
    this.next();
  }
  private atBlockEnd(): boolean {
    const t = this.cur();
    if (t.kind === "eof") return true;
    if (t.kind === "name") return t.value === "end" || t.value === "else" || t.value === "elseif" || t.value === "until";
    return false;
  }

  parseChunk(): Stmt[] {
    const body = this.parseBlock();
    if (this.cur().kind !== "eof") throw new ParseError(`unexpected token ${JSON.stringify(this.cur())}`);
    return body;
  }

  private parseBlock(): Stmt[] {
    const body: Stmt[] = [];
    while (!this.atBlockEnd()) body.push(this.parseStmt());
    return body;
  }

  private parseStmt(): Stmt {
    const t = this.cur();
    if (this.check(";")) { this.next(); return { t: "do", body: [] }; }
    if (t.kind === "name") {
      switch (t.value) {
        case "local": return this.parseLocal();
        case "function": return this.parseFunc();
        case "if": return this.parseIf();
        case "while": return this.parseWhile();
        case "repeat": return this.parseRepeat();
        case "for": return this.parseFor();
        case "return": return this.parseReturn();
        case "break": this.next(); return { t: "break" };
        case "do": { this.next(); const b = this.parseBlock(); this.expectName("end"); return { t: "do", body: b }; }
      }
    }
    const e = this.parseExpr();
    if (this.check(",") || this.check("=")) {
      const targets: Target[] = [targetOf(e)];
      const exprs: Expr[] = [];
      while (this.check(",")) { this.next(); targets.push(targetOf(this.parseExpr())); }
      this.expect("=");
      exprs.push(this.parseExpr());
      while (this.check(",")) { this.next(); exprs.push(this.parseExpr()); }
      if (this.check(";")) this.next();
      return { t: "assign", targets, exprs };
    }
    if (e.t === "call") return { t: "call", expr: e };
    throw new ParseError(`illegal statement (${e.t})`);
  }

  private parseLocal(): Stmt {
    this.expectName("local");
    if (this.checkName("function")) {
      this.next();
      const name = this.parseName();
      return { t: "localfunc", name, fn: this.parseFnDef() };
    }
    const vars = [this.parseName()];
    const exprs: Expr[] = [];
    while (this.check(",")) { this.next(); vars.push(this.parseName()); }
    if (this.check("=")) {
      this.next();
      exprs.push(this.parseExpr());
      while (this.check(",")) { this.next(); exprs.push(this.parseExpr()); }
    }
    if (this.check(";")) this.next();
    return { t: "local", vars, exprs };
  }

  private parseFunc(): Stmt {
    this.expectName("function");
    const parts = [this.parseName()];
    while (this.check(".")) { this.next(); parts.push(this.parseName()); }
    let method = false;
    if (this.check(":")) { this.next(); parts.push(this.parseName()); method = true; }
    let fn = this.parseFnDef();
    if (method) fn = { ...fn, params: ["self", ...fn.params] };
    if (parts.length === 1) return { t: "func", name: parts[0], fn };
    // a.b.c = function...  (or a.b:method -> a.b.c with implicit self)
    let obj: Expr = { t: "var", name: parts[0] };
    for (let i = 1; i < parts.length - 1; i++) obj = { t: "index", obj, key: { t: "str", value: parts[i] }, method: false };
    const target: Target = { t: "index", obj, key: { t: "str", value: parts[parts.length - 1] }, method: false };
    return { t: "assign", targets: [target], exprs: [{ t: "fn", fn }] };
  }

  private parseFnDef(): FnDef {
    this.expect("(");
    const params: string[] = [];
    let vararg = false;
    if (!this.check(")")) {
      for (;;) {
        if (this.check("...")) { this.next(); vararg = true; break; }
        params.push(this.parseName());
        if (this.check(",")) { this.next(); continue; }
        break;
      }
    }
    this.expect(")");
    const body = this.parseBlock();
    this.expectName("end");
    return { params, vararg, body };
  }

  private parseIf(): Stmt {
    this.expectName("if");
    const cond = this.parseExpr();
    this.expectName("then");
    const then = this.parseBlock();
    const elseifs: { cond: Expr; body: Stmt[] }[] = [];
    let elseBody: Stmt[] | undefined;
    for (;;) {
      if (this.checkName("elseif")) {
        this.next();
        const c = this.parseExpr();
        this.expectName("then");
        elseifs.push({ cond: c, body: this.parseBlock() });
        continue;
      }
      if (this.checkName("else")) { this.next(); elseBody = this.parseBlock(); break; }
      break;
    }
    this.expectName("end");
    return { t: "if", cond, then, elseifs, else: elseBody };
  }

  private parseWhile(): Stmt {
    this.expectName("while");
    const cond = this.parseExpr();
    this.expectName("do");
    const body = this.parseBlock();
    this.expectName("end");
    return { t: "while", cond, body };
  }

  private parseRepeat(): Stmt {
    this.expectName("repeat");
    const body = this.parseBlock();
    this.expectName("until");
    const cond = this.parseExpr();
    return { t: "repeat", cond, body };
  }

  private parseFor(): Stmt {
    this.expectName("for");
    const var1 = this.parseName();
    if (this.check("=")) {
      this.next();
      const from = this.parseExpr();
      this.expect(",");
      const to = this.parseExpr();
      let step: Expr | null = null;
      if (this.check(",")) { this.next(); step = this.parseExpr(); }
      this.expectName("do");
      const body = this.parseBlock();
      this.expectName("end");
      return { t: "nfor", var: var1, from, to, step, body };
    }
    const vars = [var1];
    while (this.check(",")) { this.next(); vars.push(this.parseName()); }
    this.expectName("in");
    const iters: Expr[] = [this.parseExpr()];
    while (this.check(",")) { this.next(); iters.push(this.parseExpr()); }
    this.expectName("do");
    const body = this.parseBlock();
    this.expectName("end");
    return { t: "gfor", vars, iters, body };
  }

  private parseReturn(): Stmt {
    this.expectName("return");
    const exprs: Expr[] = [];
    if (!this.atBlockEnd()) {
      exprs.push(this.parseExpr());
      while (this.check(",")) { this.next(); exprs.push(this.parseExpr()); }
    }
    if (this.check(";")) this.next();
    return { t: "return", exprs };
  }

  private parseName(): string {
    const t = this.cur();
    if (t.kind !== "name") throw new ParseError(`expected name, got ${JSON.stringify(t)}`);
    this.next();
    return t.value;
  }

  // ---- expressions ----
  parseExpr(): Expr { return this.parseOr(); }
  private parseOr(): Expr {
    let l = this.parseAnd();
    while (this.checkName("or")) { this.next(); l = { t: "or", l, r: this.parseAnd() }; }
    return l;
  }
  private parseAnd(): Expr {
    let l = this.parseComparison();
    while (this.checkName("and")) { this.next(); l = { t: "and", l, r: this.parseComparison() }; }
    return l;
  }
  private parseComparison(): Expr {
    const l = this.parseConcat();
    const t = this.cur();
    if (t.kind === "op" && ["<", ">", "<=", ">=", "==", "~="].includes(t.value)) {
      const opTok = this.next();
      if (opTok.kind !== "op") throw new ParseError("expected operator");
      return { t: "compare", op: opTok.value, l, r: this.parseConcat() };
    }
    return l;
  }
  private parseConcat(): Expr {
    const parts: Expr[] = [this.parseAdd()];
    while (this.check("..")) { this.next(); parts.push(this.parseAdd()); }
    return parts.length === 1 ? parts[0] : { t: "concat", parts };
  }
  private parseAdd(): Expr {
    let l = this.parseMul();
    for (;;) {
      if (this.check("+")) { this.next(); l = { t: "bin", op: "+", l, r: this.parseMul() }; }
      else if (this.check("-")) { this.next(); l = { t: "bin", op: "-", l, r: this.parseMul() }; }
      else break;
    }
    return l;
  }
  private parseMul(): Expr {
    let l = this.parseUnary();
    for (;;) {
      if (this.check("*")) { this.next(); l = { t: "bin", op: "*", l, r: this.parseUnary() }; }
      else if (this.check("/")) { this.next(); l = { t: "bin", op: "/", l, r: this.parseUnary() }; }
      else if (this.check("%")) { this.next(); l = { t: "bin", op: "%", l, r: this.parseUnary() }; }
      else break;
    }
    return l;
  }
  private parseUnary(): Expr {
    if (this.check("#")) { this.next(); return { t: "unary", op: "#", e: this.parseUnary() }; }
    if (this.check("-")) { this.next(); return { t: "unary", op: "-", e: this.parseUnary() }; }
    if (this.checkName("not")) { this.next(); return { t: "unary", op: "not", e: this.parseUnary() }; }
    return this.parsePow();
  }
  private parsePow(): Expr {
    const base = this.parsePrimary();
    if (this.check("^")) { this.next(); return { t: "bin", op: "^", l: base, r: this.parseUnary() }; }
    return base;
  }

  private parsePrimary(): Expr {
    const t = this.cur();
    if (t.kind === "num") { this.next(); return { t: "num", value: t.value }; }
    if (t.kind === "str") { this.next(); return { t: "str", value: t.value }; }
    if (t.kind === "name") {
      if (t.value === "nil") { this.next(); return { t: "nil" }; }
      if (t.value === "true") { this.next(); return { t: "bool", value: true }; }
      if (t.value === "false") { this.next(); return { t: "bool", value: false }; }
      if (t.value === "function") { this.next(); return { t: "fn", fn: this.parseFnDef() }; }
      this.parseName();
      return this.parsePostfix({ t: "var", name: t.value });
    }
    if (t.kind === "op" && t.value === "...") { this.next(); return { t: "vararg" }; }
    if (this.check("(")) { this.next(); const e = this.parseExpr(); this.expect(")"); return this.parsePostfix(e); }
    if (this.check("{")) return this.parseTable();
    throw new ParseError(`unexpected token in expression: ${JSON.stringify(t)}`);
  }

  private parsePostfix(e: Expr): Expr {
    for (;;) {
      if (this.check("(") || this.check("{")) {
        const args = this.parseCallArgs();
        e = { t: "call", callee: e, args };
      } else if (this.cur().kind === "str" && e.t !== "str") {
        const st = this.next();
        if (st.kind !== "str") throw new ParseError("expected string");
        e = { t: "call", callee: e, args: [{ t: "str", value: st.value }] };
      } else if (this.check(".")) {
        this.next();
        const keyTok = this.cur();
        if (keyTok.kind !== "name") throw new ParseError("expected field name");
        this.next();
        e = { t: "index", obj: e, key: { t: "str", value: keyTok.value }, method: false };
      } else if (this.check(":")) {
        this.next();
        const keyTok = this.cur();
        if (keyTok.kind !== "name") throw new ParseError("expected method name");
        this.next();
        e = { t: "index", obj: e, key: { t: "str", value: keyTok.value }, method: true };
      } else if (this.check("[")) {
        this.next();
        const key = this.parseExpr();
        this.expect("]");
        e = { t: "index", obj: e, key, method: false };
      } else break;
    }
    return e;
  }

  private parseCallArgs(): Expr[] {
    if (this.check("{")) return [this.parseTable()];
    if (this.cur().kind === "str") { const t = this.next(); if (t.kind !== "str") throw new ParseError("expected string"); return [{ t: "str", value: t.value }]; }
    this.expect("(");
    const args: Expr[] = [];
    if (!this.check(")")) {
      args.push(this.parseExpr());
      while (this.check(",")) { this.next(); args.push(this.parseExpr()); }
    }
    this.expect(")");
    return args;
  }

  private parseTable(): Expr {
    this.expect("{");
    const items: TableItem[] = [];
    while (!this.check("}")) {
      const ct = this.cur(), pt = this.peek(1);
      if (ct.kind === "name" && pt.kind === "op" && pt.value === "=") {
        const key = this.parseName();
        this.next();
        items.push({ key: { t: "str", value: key }, value: this.parseExpr() });
      } else if (this.check("[")) {
        this.next();
        const key = this.parseExpr();
        this.expect("]");
        this.expect("=");
        items.push({ key, value: this.parseExpr() });
      } else {
        items.push({ key: null, value: this.parseExpr() });
      }
      if (this.check(",")) { this.next(); continue; }
      if (this.check(";")) { this.next(); continue; }
      break;
    }
    this.expect("}");
    return { t: "table", items };
  }
}

function targetOf(e: Expr): Target {
  if (e.t === "var") return { t: "var", name: e.name };
  if (e.t === "index") return { t: "index", obj: e.obj, key: e.key ?? { t: "nil" }, method: e.method };
  throw new ParseError("invalid assignment target");
}

export function parse(src: string): Stmt[] {
  return new Parser(lex(src)).parseChunk();
}
