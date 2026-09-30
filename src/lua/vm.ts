/**
 * Lua 5.1 tree-walk VM. Executes the AST from parser.ts against a JS host that
 * installs the `cliamp.*` plugin API (see host.ts). Values map: nil→null,
 * boolean/number/string native, tables→LuaTable, functions→LuaFunction (native
 * host or closure). Closures capture the enclosing Env as their scope parent,
 * so upvalues resolve. Control flow (break/return) via Control exceptions.
 */
import type { Expr, FnDef, Stmt, Target } from "./parser";

export type Value = null | boolean | number | string | LuaTable | LuaFunction;

export class LuaTable {
  // Array part (1-based) and hash part. Kept separate so # and ipairs work.
  arr: Value[] = [];
  hash: Record<string, Value> = {};
  metatable?: LuaTable;
  get(k: Value): Value {
    if (typeof k === "number" && Number.isInteger(k) && k >= 1) {
      const v = this.arr[k - 1];
      if (v !== undefined) return v;
    }
    const key = keyOf(k);
    if (key !== null && key in this.hash) return this.hash[key];
    return null;
  }
  set(k: Value, v: Value): void {
    if (typeof k === "number" && Number.isInteger(k) && k >= 1) {
      if (k === this.arr.length + 1) this.arr.push(v);
      else this.arr[k - 1] = v;
      return;
    }
    const key = keyOf(k);
    if (key !== null) this.hash[key] = v;
  }
  len(): number {
    if (this.arr.length) return this.arr.length;
    let n = 0;
    for (const k of Object.keys(this.hash)) if (/^[1-9]\d*$/.test(k) && this.hash[k] !== null) n = Math.max(n, parseInt(k, 10));
    return n;
  }
  // iteration order: array part then hash keys (stable)
  keys(): Value[] {
    const out: Value[] = [];
    for (let i = 1; i <= this.arr.length; i++) if (this.arr[i - 1] !== null) out.push(i);
    for (const k of Object.keys(this.hash)) {
      if (this.hash[k] === null) continue;
      out.push(/^[1-9]\d*$/.test(k) ? parseInt(k, 10) : k);
    }
    return out;
  }
}

export type NativeFn = (self: Value, args: Value[]) => Value[];
export interface Closure { fn: FnDef; env: Env; }
export class LuaFunction {
  constructor(public native?: NativeFn, public closure?: Closure) {}
  isNative(): boolean { return typeof this.native === "function"; }
  call(self: Value, args: Value[], vm: VM): Value[] {
    if (this.isNative()) return this.native!(self, args);
    const c = this.closure!;
    const env = new Env(c.env);
    env.vm = vm;
    // For a :method call, self is the receiver and becomes the first param.
    const fullArgs = self !== null ? [self, ...args] : args;
    const params = c.fn.params;
    for (let i = 0; i < params.length; i++) env.local(params[i], i < fullArgs.length ? fullArgs[i] : null);
    if (c.fn.vararg) { const vt = new LuaTable(); vt.arr = fullArgs.slice(params.length); env.local("__vararg", vt); }
    try {
      return vm.evalBlock(c.fn.body, env);
    } catch (e) {
      if (e instanceof Control && e.kind === "return") return e.values;
      throw e;
    }
  }
}

class Env {
  constructor(public parent: Env | null) {}
  vm?: VM;
  private locals: Record<string, Value> = {};
  local(name: string, v: Value): void { this.locals[name] = v; }
  get(name: string): Value | undefined {
    let e: Env | null = this;
    while (e) { if (name in e.locals) return e.locals[name]; e = e.parent; }
    return undefined;
  }
  set(name: string, v: Value): void {
    let e: Env | null = this;
    while (e) { if (name in e.locals) { e.locals[name] = v; return; } e = e.parent; }
    this.root().setGlobal(name, v);
  }
  private root(): VM {
    let e: Env | null = this;
    while (e?.parent) e = e.parent;
    return e!.vm!;
  }
}

export class Control {
  constructor(public kind: "break" | "return", public values: Value[]) {}
}

export class LuaError extends Error {}

export class VM {
  globals: LuaTable = new LuaTable();
  globalsEnv: Env;
  private stringLib: LuaTable | null = null;
  constructor() {
    this.globalsEnv = new Env(null);
    this.globalsEnv.vm = this;
  }
  getGlobal(name: string): Value { return this.globals.get(name) ?? null; }
  setGlobal(name: string, v: Value): void { this.globals.set(name, v); }

  run(chunk: Stmt[]): Value[] {
    this.installBase();
    return this.evalBlock(chunk, this.globalsEnv);
  }

  private installBase(): void {
    this.setGlobal("tostring", new LuaFunction((_, a) => [valueToString(a[0] ?? null)]));
    this.setGlobal("tonumber", new LuaFunction((_, a) => {
      const v = a[0];
      if (typeof v === "number") return [v];
      if (typeof v === "string") { const n = parseFloat(v); return [Number.isNaN(n) ? null : n]; }
      return [null];
    }));
    this.setGlobal("type", new LuaFunction((_, a) => [luaType(a[0] ?? null)]));
    this.setGlobal("pairs", new LuaFunction((_, a) => {
      const t = a[0];
      if (!(t instanceof LuaTable)) return [null];
      let i = 0;
      const keys = t.keys();
      return [new LuaFunction(() => {
        i++;
        if (i > keys.length) return [null, null];
        const k = keys[i - 1];
        return [k, t.get(k)];
      })];
    }));
    this.setGlobal("ipairs", new LuaFunction((_, a) => {
      const t = a[0];
      if (!(t instanceof LuaTable)) return [null];
      let i = 1;
      return [new LuaFunction(() => {
        const v = t.get(i);
        if (v === null) return [null, null];
        const idx = i;
        i++;
        return [idx, v];
      })];
    }));
    this.setGlobal("error", new LuaFunction((_, a) => { throw new LuaError(valueToString(a[0] ?? null)); }));
    this.setGlobal("select", new LuaFunction((_, a) => {
      const n = a[0];
      const rest = a.slice(1);
      if (n === "#") return [rest.length];
      const idx = num(n);
      if (idx === -1) return [rest[rest.length - 1]];
      return [rest[idx - 1] ?? null];
    }));
    this.setGlobal("unpack", new LuaFunction((_, a) => (a[0] instanceof LuaTable ? a[0].arr.slice() : [])));
    this.setGlobal("pcall", new LuaFunction((_, a) => {
      const fn = a[0];
      try {
        if (!(fn instanceof LuaFunction)) throw new LuaError("not a function");
        const r = fn.call(null, a.slice(1), this);
        return [true, ...r];
      } catch (e) {
        return [false, e instanceof Error ? e.message : String(e)];
      }
    }));
    this.setGlobal("setmetatable", new LuaFunction((_, a) => {
      const t = a[0];
      if (t instanceof LuaTable) t.metatable = a[1] instanceof LuaTable ? a[1] : undefined;
      return [a[0]];
    }));
    this.setGlobal("getmetatable", new LuaFunction((_, a) => [a[0] instanceof LuaTable ? (a[0].metatable ?? null) : null]));
    this.installTableLib();
    this.installStringLib();
    this.installMathLib();
  }

  private installTableLib(): void {
    const t = new LuaTable();
    t.set("insert", new LuaFunction((_, a) => {
      const tbl = a[0];
      if (!(tbl instanceof LuaTable)) return [];
      if (a.length === 2) { tbl.arr.push(a[1]); return []; }
      const pos = num(a[1], tbl.arr.length + 1);
      tbl.arr.splice(pos - 1, 0, a[2] ?? null);
      return [];
    }));
    t.set("remove", new LuaFunction((_, a) => {
      const tbl = a[0];
      if (!(tbl instanceof LuaTable)) return [null];
      const pos = typeof a[1] === "number" ? a[1] : tbl.arr.length;
      return [tbl.arr.splice(pos - 1, 1)[0] ?? null];
    }));
    t.set("concat", new LuaFunction((_, a) => {
      const tbl = a[0];
      if (!(tbl instanceof LuaTable)) return [""];
      const sep = str(a[1]);
      const i = num(a[2], 1), j = num(a[3], tbl.arr.length);
      let s = "";
      for (let k = i; k <= j; k++) { s += valueToString(tbl.get(k)); if (k < j) s += sep; }
      return [s];
    }));
    t.set("sort", new LuaFunction((_, a) => {
      const tbl = a[0];
      if (!(tbl instanceof LuaTable)) return [];
      tbl.arr.sort((x, y) => (num(x) < num(y) ? -1 : num(x) > num(y) ? 1 : 0));
      return [];
    }));
    this.setGlobal("table", t);
  }

  private installStringLib(): void {
    const s = new LuaTable();
    s.set("len", new LuaFunction((_, a) => [str(a[0]).length]));
    s.set("sub", new LuaFunction((_, a) => {
      const strv = str(a[0]);
      let i = num(a[1], 1), j = num(a[2], -1);
      if (i < 0) i = strv.length + i + 1;
      if (j < 0) j = strv.length + j + 1;
      if (j < i) return [""];
      return [strv.slice(i - 1, j)];
    }));
    s.set("lower", new LuaFunction((_, a) => [str(a[0]).toLowerCase()]));
    s.set("upper", new LuaFunction((_, a) => [str(a[0]).toUpperCase()]));
    s.set("rep", new LuaFunction((_, a) => [str(a[0]).repeat(Math.max(0, num(a[1])))]));
    s.set("find", new LuaFunction((_, a) => {
      const strv = str(a[0]);
      const pat = str(a[1]);
      const start = num(a[2], 1) - 1;
      const plain = a[3] === true;
      if (plain) {
        const idx = strv.indexOf(pat, start);
        return idx === -1 ? [] : [idx + 1, idx + pat.length];
      }
      const re = new RegExp(patternToRegex(pat));
      re.lastIndex = start;
      const m = re.exec(strv);
      return m ? [m.index + 1, m.index + m[0].length] : [];
    }));
    s.set("match", new LuaFunction((_, a) => {
      const strv = str(a[0]);
      const m = strv.match(new RegExp(patternToRegex(str(a[1]))));
      return m ? [m[0], ...(m.length > 1 ? m.slice(1) : [])] : [];
    }));
    s.set("gmatch", new LuaFunction((_, a) => {
      const strv = str(a[0]);
      const re = new RegExp(patternToRegex(str(a[1])), "g");
      let m: RegExpExecArray | null;
      return [new LuaFunction(() => {
        m = re.exec(strv);
        if (!m) return [null];
        return [m[0], ...(m.length > 1 ? m.slice(1) : [])];
      })];
    }));
    s.set("gsub", new LuaFunction((_, a) => {
      const strv = str(a[0]);
      const pat = str(a[1]);
      const repl = a[2];
      const hasMax = typeof a[3] === "number";
      const max = num(a[3]);
      let count = 0;
      const out = strv.replace(new RegExp(patternToRegex(pat), "g"), () => {
        count++;
        if (hasMax && count > max) return pat;
        if (typeof repl === "string") return repl.replace(/%%/g, "%");
        if (repl instanceof LuaTable) return valueToString(repl.get(0) ?? null);
        return "";
      });
      return [out, count];
    }));
    s.set("format", new LuaFunction((_, a) => [fmtString(str(a[0]), a.slice(1))]));
    this.stringLib = s;
    this.setGlobal("string", s);
  }

  private installMathLib(): void {
    const m = new LuaTable();
    const wrap = (f: (x: number) => number) => new LuaFunction((_, a) => [f(num(a[0]))]);
    m.set("abs", wrap(Math.abs));
    m.set("floor", wrap(Math.floor));
    m.set("ceil", wrap(Math.ceil));
    m.set("sqrt", wrap(Math.sqrt));
    m.set("max", new LuaFunction((_, a) => [Math.max(...a.map((x) => num(x)))]));
    m.set("min", new LuaFunction((_, a) => [Math.min(...a.map((x) => num(x)))]));
    m.set("fmod", new LuaFunction((_, a) => [num(a[0]) - Math.floor(num(a[0]) / num(a[1])) * num(a[1])]));
    m.set("random", new LuaFunction((_, a) => {
      if (a.length === 0) return [Math.random()];
      const lo = num(a[0], 1), hi = num(a[1], lo);
      return [Math.floor(Math.random() * (hi - lo + 1)) + lo];
    }));
    this.setGlobal("math", m);
  }

  // ---- evaluation ----
  evalBlock(stmts: Stmt[], env: Env): Value[] {
    for (const s of stmts) this.evalStmt(s, env);
    return [];
  }

  private evalStmt(s: Stmt, env: Env): Value[] | null {
    switch (s.t) {
      case "do": { this.evalBlock(s.body, env); return null; }
      case "local": {
        const vals = this.evalExprsAll(s.exprs, env);
        for (let i = 0; i < s.vars.length; i++) env.local(s.vars[i], vals[i] ?? null);
        return null;
      }
      case "localfunc": {
        const fn = this.makeFn(s.fn, env);
        env.local(s.name, fn);
        return null;
      }
      case "func": {
        this.assignTarget({ t: "var", name: s.name }, this.makeFn(s.fn, env), env);
        return null;
      }
      case "assign": {
        const vals = this.evalExprsAll(s.exprs, env);
        for (let i = 0; i < s.targets.length; i++) this.assignTarget(s.targets[i], vals[i] ?? null, env);
        return null;
      }
      case "call": { this.evalExpr(s.expr, env); return null; }
      case "if": {
        if (this.isTruthy(this.evalExpr(s.cond, env))) {
          this.evalBlock(s.then, env);
        } else {
          let matched = false;
          for (const el of s.elseifs) {
            if (!matched && this.isTruthy(this.evalExpr(el.cond, env))) { this.evalBlock(el.body, env); matched = true; }
          }
          if (!matched && s.else) this.evalBlock(s.else, env);
        }
        return null;
      }
      case "while": {
        while (this.isTruthy(this.evalExpr(s.cond, env))) {
          try { this.evalBlock(s.body, env); }
          catch (e) { if (e instanceof Control && e.kind === "break") break; throw e; }
        }
        return null;
      }
      case "repeat": {
        do {
          try { this.evalBlock(s.body, env); }
          catch (e) { if (e instanceof Control && e.kind === "break") break; throw e; }
        } while (!this.isTruthy(this.evalExpr(s.cond, env)));
        return null;
      }
      case "nfor": {
        const from = num(this.evalExpr(s.from, env));
        const to = num(this.evalExpr(s.to, env));
        const step = s.step ? num(this.evalExpr(s.step, env)) : 1;
        for (let v = from; step > 0 ? v <= to : v >= to; v += step) {
          env.local(s.var, v);
          try { this.evalBlock(s.body, env); }
          catch (e) { if (e instanceof Control && e.kind === "break") break; throw e; }
        }
        return null;
      }
      case "gfor": {
        const iters = s.iters.map((e) => this.evalExpr(e, env));
        const gen = iters[0];
        if (!(gen instanceof LuaFunction)) throw new LuaError("iterator not a function");
        for (;;) {
          const vals = gen.call(null, [], this);
          if (vals[0] === null || vals[0] === undefined) break;
          for (let i = 0; i < s.vars.length; i++) env.local(s.vars[i], vals[i] ?? null);
          try { this.evalBlock(s.body, env); }
          catch (e) { if (e instanceof Control && e.kind === "break") break; throw e; }
        }
        return null;
      }
      case "return": {
        const vals = s.exprs.map((e) => this.evalExpr(e, env));
        throw new Control("return", vals);
      }
      case "break": throw new Control("break", []);
    }
  }

  private makeFn(fn: FnDef, env: Env): LuaFunction {
    return new LuaFunction(undefined, { fn, env });
  }

  // Evaluate call args; a trailing `...` vararg expands to its values.
  private evalArgs(env: Env, args: Expr[]): Value[] {
    const out: Value[] = [];
    const last = args[args.length - 1];
    const expand = last !== undefined && last.t === "vararg";
    const n = expand ? args.length - 1 : args.length;
    for (let i = 0; i < n; i++) out.push(this.evalExpr(args[i], env));
    if (expand) {
      const vt = env.get("__vararg");
      if (vt instanceof LuaTable) out.push(...vt.arr);
    }
    return out;
  }

  // Evaluate a call expression, returning all return values.
  private evalCall(e: { t: "call"; callee: Expr; args: Expr[] }, env: Env): Value[] {
    const args = this.evalArgs(env, e.args);
    if (e.callee.t === "index" && e.callee.method) {
      // obj:method(args) -> f = obj[method]; f(obj, args...)
      const obj = this.evalExpr(e.callee.obj, env);
      const k = this.evalExpr(e.callee.key ?? { t: "nil" }, env);
      const callee = obj instanceof LuaTable ? obj.get(k) : this.metaIndex(obj, k);
      if (!(callee instanceof LuaFunction)) throw new LuaError(`attempt to call non-function (${luaType(callee)})`);
      return callee.call(obj, args, this);
    }
    const callee = this.evalExpr(e.callee, env);
    if (!(callee instanceof LuaFunction)) throw new LuaError(`attempt to call non-function (${luaType(callee)})`);
    return callee.call(null, args, this);
  }

  // Evaluate a list of RHS expressions; a trailing call/vararg expands to all its values.
  private evalExprsAll(exprs: Expr[], env: Env): Value[] {
    const out: Value[] = [];
    const last = exprs.length - 1;
    for (let i = 0; i < last; i++) out.push(this.evalExpr(exprs[i], env));
    if (last >= 0) out.push(...this.evalExprAll(exprs[last], env));
    return out;
  }
  private evalExprAll(e: Expr, env: Env): Value[] {
    if (e.t === "call") return this.evalCall(e, env);
    if (e.t === "vararg") {
      const vt = env.get("__vararg");
      if (vt instanceof LuaTable) return vt.arr.slice();
      return [];
    }
    return [this.evalExpr(e, env)];
  }

  private assignTarget(target: Target, v: Value, env: Env): void {
    if (target.t === "var") { env.set(target.name, v); return; }
    const obj = this.evalExpr(target.obj, env);
    if (!(obj instanceof LuaTable)) throw new LuaError("attempt to index non-table");
    const key = target.key ? this.evalExpr(target.key, env) : null;
    if (key === null) throw new LuaError("invalid index");
    obj.set(key, v);
  }

  evalExpr(e: Expr, env: Env): Value {
    switch (e.t) {
      case "num": return e.value;
      case "str": return e.value;
      case "bool": return e.value;
      case "nil": return null;
      case "var": {
        const v = env.get(e.name);
        if (v !== undefined) return v;
        return this.getGlobal(e.name);
      }
      case "vararg": {
        const v = env.get("__vararg");
        return v ?? null;
      }
      case "index": {
        if (e.method) {
          // `a:b` used as an expression (rare): resolve the method function.
          const obj = this.evalExpr(e.obj, env);
          const k = this.evalExpr(e.key ?? { t: "nil" }, env);
          return obj instanceof LuaTable ? obj.get(k) : this.metaIndex(obj, k);
        }
        const obj = this.evalExpr(e.obj, env);
        const key = e.key ? this.evalExpr(e.key, env) : null;
        if (key === null) throw new LuaError("invalid index");
        if (obj instanceof LuaTable) return obj.get(key);
        return this.metaIndex(obj, key);
      }
      case "call": {
        return this.evalCall(e, env)[0] ?? null;
      }
      case "fn": return this.makeFn(e.fn, env);
      case "table": {
        const t = new LuaTable();
        let anon = 1;
        for (const item of e.items) {
          const v = this.evalExpr(item.value, env);
          if (item.key === null) t.set(anon++, v);
          else t.set(this.evalExpr(item.key, env), v);
        }
        return t;
      }
      case "bin": {
        const l = this.evalExpr(e.l, env), r = this.evalExpr(e.r, env);
        return this.binop(e.op, l, r);
      }
      case "concat": {
        return e.parts.map((p) => valueToString(this.evalExpr(p, env))).join("");
      }
      case "unary": {
        const v = this.evalExpr(e.e, env);
        if (e.op === "-") return -num(v);
        if (e.op === "not") return !this.isTruthy(v);
        if (e.op === "#") {
          if (typeof v === "string") return v.length;
          if (v instanceof LuaTable) return v.len();
          throw new LuaError("invalid # operand");
        }
        throw new LuaError(`bad unary ${e.op}`);
      }
      case "and": {
        const l = this.evalExpr(e.l, env);
        return this.isTruthy(l) ? this.evalExpr(e.r, env) : l;
      }
      case "or": {
        const l = this.evalExpr(e.l, env);
        return this.isTruthy(l) ? l : this.evalExpr(e.r, env);
      }
      case "compare": {
        const l = this.evalExpr(e.l, env), r = this.evalExpr(e.r, env);
        return this.compare(e.op, l, r);
      }
    }
  }

  private metaIndex(obj: Value, key: Value): Value {
    // String method calls: s:lower() -> string.lower(s). The string-lib natives
    // expect the string as args[0] (dot convention), so bind it as the first arg.
    if (typeof obj === "string" && typeof key === "string" && this.stringLib) {
      const m = this.stringLib.get(key);
      if (m instanceof LuaFunction) return new LuaFunction((_, args) => m.call(null, [obj, ...args], this));
    }
    throw new LuaError(`attempt to index ${luaType(obj)} value`);
  }

  private isTruthy(v: Value): boolean { return v !== null && v !== false; }

  private binop(op: string, l: Value, r: Value): Value {
    const a = num(l), b = num(r);
    switch (op) {
      case "+": return a + b;
      case "-": return a - b;
      case "*": return a * b;
      case "/": return a / b;
      case "%": return a - Math.floor(a / b) * b;
      case "^": return Math.pow(a, b);
    }
    throw new LuaError(`bad binary ${op}`);
  }

  private compare(op: string, l: Value, r: Value): boolean {
    switch (op) {
      case "==": return looseEq(l, r);
      case "~=": return !looseEq(l, r);
      case "<": return num(l) < num(r);
      case "<=": return num(l) <= num(r);
      case ">": return num(l) > num(r);
      case ">=": return num(l) >= num(r);
    }
    throw new LuaError(`bad compare ${op}`);
  }
}

function keyOf(k: Value): string | null {
  if (k === null) return null;
  if (typeof k === "string") return k;
  if (typeof k === "number") return String(k);
  if (typeof k === "boolean") return String(k);
  return null;
}
function luaType(v: Value): string {
  if (v === null) return "nil";
  if (typeof v === "boolean") return "boolean";
  if (typeof v === "number") return "number";
  if (typeof v === "string") return "string";
  if (v instanceof LuaTable) return "table";
  if (v instanceof LuaFunction) return "function";
  return "nil";
}
function valueToString(v: Value): string {
  if (v === null) return "nil";
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "number") return String(v);
  if (typeof v === "string") return v;
  return "<object>";
}
function looseEq(l: Value, r: Value): boolean {
  if (l instanceof LuaTable || r instanceof LuaTable) return l === r;
  if (typeof l === "number" && typeof r === "string") return String(l) === r;
  if (typeof r === "number" && typeof l === "string") return l === String(r);
  return l === r;
}
// Coerce a Lua value to a number (strings parsed; nil/false -> default).
function num(v: Value | undefined, d = 0): number {
  if (typeof v === "number") return v;
  if (typeof v === "string" && v.trim() !== "") { const n = parseFloat(v); if (!Number.isNaN(n)) return n; }
  return d;
}
// Coerce a Lua value to a string (nil -> "").
function str(v: Value | undefined): string {
  if (typeof v === "string") return v;
  if (v === null || v === undefined) return "";
  return valueToString(v);
}
// Lua pattern -> regex (minimal: %d %w %s %a %A %x %% and literals, * + ?).
function patternToRegex(pat: string): string {
  let out = "";
  for (let i = 0; i < pat.length; i++) {
    const c = pat[i];
    if (c === "%") {
      const n = pat[i + 1];
      switch (n) {
        case "d": out += "\\d"; break;
        case "w": out += "\\w"; break;
        case "s": out += "\\s"; break;
        case "a": out += "[a-zA-Z]"; break;
        case "A": out += "[^a-zA-Z]"; break;
        case "x": out += "[0-9a-fA-F]"; break;
        case "%": out += "%"; break;
        default: out += "%" + (n ?? "");
      }
      i++;
    } else if ("^$.|()+[]{}".includes(c)) out += "\\" + c;
    else out += c;
  }
  return out;
}
function fmtString(fmt: string, args: Value[]): string {
  let i = 0;
  return fmt.replace(/%[-+ #0]*(\d+)?(\.(\d+))?([%dioxXeEfFgGsu])|%(%)?/g, (_m, _w, _z, _p, conv) => {
    if (conv === "%") return "%";
    const a = args[i++] ?? null;
    switch (conv) {
      case "d": return String(Math.trunc(num(a)));
      case "s": return valueToString(a);
      case "u": return String(Math.trunc(num(a)));
      case "f": case "F": case "g": case "G": return String(num(a));
      case "x": return (num(a) & 0xffffffff).toString(16);
      case "o": return num(a).toString(8);
      case "e": case "E": return num(a).toExponential();
      case "i": return String(Math.trunc(num(a)));
    }
    return _m;
  });
}

export { luaType, valueToString };
