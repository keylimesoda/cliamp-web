import { describe, expect, it } from "vitest";
import { parse } from "./parser";
import { VM, valueToString, LuaFunction } from "./vm";

function run(src: string): string[] {
  const vm = new VM();
  const outs: string[] = [];
  vm.setGlobal("print", new LuaFunction((_, a) => { outs.push(a.map((x) => valueToString(x)).join("\t")); return []; }));
  vm.run(parse(src));
  return outs;
}
function one(src: string): string {
  const o = run(src);
  return o[o.length - 1] ?? "";
}

describe("Lua VM — expressions", () => {
  it("arithmetic, concat, modulo", () => {
    expect(one(`print(1 + 2 * 3, "a" .. "b", 10 % 3)`)).toBe("7\tab\t1");
  });
  it("if / elseif / else", () => {
    expect(one(`local x = 5; if x < 0 then print("neg") elseif x == 5 then print("five") else print("other") end`)).toBe("five");
  });
  it("multi-assign", () => {
    expect(one(`local a, b, c = 1, 2, 3; a, b, c = c, a, b; print(a, b, c)`)).toBe("3\t1\t2");
  });
});

describe("Lua VM — control flow", () => {
  it("numeric for (sum 1..5)", () => {
    expect(one(`local s = 0; for i = 1, 5 do s = s + i end; print(s)`)).toBe("15");
  });
  it("numeric for with negative step", () => {
    expect(one(`local o = {}; for i = 5, 1, -2 do table.insert(o, i) end; print(table.concat(o, ","))`)).toBe("5,3,1");
  });
  it("generic for over pairs", () => {
    expect(one(`local t = {a = 1, b = 2, c = 3}; local s = 0; for _, v in pairs(t) do s = s + v end; print(s)`)).toBe("6");
  });
  it("generic for over ipairs (1-based)", () => {
    expect(one(`local t = {10, 20, 30}; local s = 0; for i, v in ipairs(t) do s = s + (i * 10) + v end; print(s)`)).toBe("120");
  });
  it("while loop", () => {
    expect(one(`local i, s = 0, 0; while i < 4 do s = s + i; i = i + 1 end; print(s)`)).toBe("6");
  });
  it("repeat-until runs until condition true", () => {
    expect(one(`local i = 0; repeat i = i + 1 until i >= 3; print(i)`)).toBe("3");
  });
  it("break exits the loop", () => {
    expect(one(`local s = 0; for i = 1, 10 do if i == 4 then break end s = s + i end; print(s)`)).toBe("6");
  });
});

describe("Lua VM — functions", () => {
  it("closures capture upvalues", () => {
    expect(one(`
      local function counter()
        local n = 0
        return function() n = n + 1; return n end
      end
      local c = counter()
      c(); c(); c()
      print(c())
    `)).toBe("4");
  });
  it(": method calls pass self", () => {
    expect(one(`
      local t = {}
      function t:inc(x) self.v = (self.v or 0) + x; return self.v end
      t:inc(5)
      print(t:inc(3), t.v)
    `)).toBe("8\t8");
  });
  it("varargs with select", () => {
    expect(one(`
      local function sum(...)
        local s = 0
        for i = 1, select("#", ...) do s = s + select(i, ...) end
        return s
      end
      print(sum(1, 2, 3, 4))
    `)).toBe("10");
  });
  it("multiple return values expand in multi-assign", () => {
    expect(one(`local function pair() return 1, 2, 3 end; local a, b, c = pair(); print(a, b, c)`)).toBe("1\t2\t3");
  });
  it("named local recursion", () => {
    expect(one(`local function fact(n) if n <= 1 then return 1 end return n * fact(n - 1) end; print(fact(5))`)).toBe("120");
  });
  it("nested closures sharing a table upvalue", () => {
    expect(one(`
      local function make()
        local acc = {}
        return function(x) table.insert(acc, x); return #acc end
      end
      local f = make()
      f(1); f(2)
      print(f(3))
    `)).toBe("3");
  });
  it("function sets a global", () => {
    expect(one(`local function setIt() global_x = 42 end; setIt(); print(global_x)`)).toBe("42");
  });
});

describe("Lua VM — standard library", () => {
  it("string lib (dot form)", () => {
    expect(one(`print(string.upper("hello"), string.len("hi"), string.sub("abcdef", 2, 4), string.find("hello", "ll", 1, true))`)).toBe("HELLO\t2\tbcd\t3");
  });
  it("string method calls via : (lower/find/sub)", () => {
    expect(one(`local g = "Rock"; print(g:lower(), g:find("ck", 1, true), g:sub(1, 1):upper())`)).toBe("rock\t3\tR");
  });
  it("string concat with .. and #", () => {
    expect(one(`local s = "a" .. "b" .. "c"; print(s, #s)`)).toBe("abc\t3");
  });
  it("table lib (sort + concat)", () => {
    expect(one(`local t = {3, 1, 2}; table.sort(t); print(table.concat(t, "-"), t[1])`)).toBe("1-2-3\t1");
  });
  it("table.insert appends (2-arg form)", () => {
    expect(one(`local o = {}; table.insert(o, "a"); table.insert(o, "b"); print(table.concat(o, ","))`)).toBe("a,b");
  });
  it("math lib", () => {
    expect(one(`print(math.floor(3.7), math.max(1, 9, 4), math.abs(-5))`)).toBe("3\t9\t5");
  });
});
