const test = require("node:test");
const assert = require("node:assert/strict");
const core = require("../src/core.js");

function custom(overrides) {
  return Object.assign(
    {
      id: "custom",
      name: "自定义",
      levels: ["{n}、"],
      indent: 0,
      numbering: "independent",
      separator: ".",
    },
    overrides || {}
  );
}

test("方案：内置方案都能通过校验", () => {
  for (const id of ["gongwen", "points", "outline"]) {
    const result = core.validateScheme(core.PRESETS[id]);
    assert.equal(result.ok, true, id + "：" + result.errors.join("；"));
  }
});

test("方案：编译结果缓存，同一对象只编译一次", () => {
  const scheme = core.PRESETS.gongwen;
  const first = core.compileScheme(scheme);
  const second = core.compileScheme(scheme);
  assert.equal(first, second);
  assert.equal(first.levels.length, 5);
  assert.equal(first.levels[0].kind, "cn");
  assert.equal(first.levels[2].kind, "n");
});

test("方案：示例标记（含缩进）", () => {
  assert.deepEqual(core.schemeSample(core.PRESETS.gongwen), ["一、", "（一）", "1、", "（1）", "①"]);
  assert.deepEqual(core.schemeSample(core.PRESETS.points), ["一、", "  1、", "    （1）", "      ①"]);
  assert.deepEqual(core.schemeSample(core.PRESETS.outline), ["一、", "  1.1、", "    1.1.1、"]);
  assert.deepEqual(
    core.schemeSample(custom({ levels: ["第{n}条 "], numbering: "independent" })),
    ["第1条 "]
  );
});

test("方案：校验错误——空模板 / 缺占位符 / 多占位符", () => {
  assert.equal(core.validateScheme(custom({ levels: [] })).ok, false);
  assert.equal(core.validateScheme(custom({ levels: ["  "] })).ok, false);
  assert.equal(core.validateScheme(custom({ levels: ["一、"] })).ok, false);
  const two = core.validateScheme(custom({ levels: ["{n}-{cn}"] }));
  assert.equal(two.ok, false);
  assert.match(two.errors.join(""), /只能有一个占位符/);
});

test("方案：校验错误——花括号写法不对", () => {
  const result = core.validateScheme(custom({ levels: ["{n、"] }));
  assert.equal(result.ok, false);
  assert.match(result.errors.join(""), /花括号/);
});

test("方案：校验错误——{p} 需要多级编号", () => {
  const result = core.validateScheme(custom({ levels: ["{p}、"], numbering: "independent" }));
  assert.equal(result.ok, false);
  assert.match(result.errors.join(""), /多级/);
  assert.equal(
    core.validateScheme(custom({ levels: ["{cn}、", "{p}、"], numbering: "hierarchical" })).ok,
    true
  );
});

test("方案：校验错误——层级过多 / 缩进越界 / 分隔符为空", () => {
  const many = core.validateScheme(custom({ levels: new Array(10).fill("{n}、") }));
  assert.equal(many.ok, false);
  assert.match(many.errors.join(""), /最多支持/);

  assert.equal(core.validateScheme(custom({ indent: 9 })).ok, false);
  assert.equal(core.validateScheme(custom({ indent: -1 })).ok, false);

  const noSep = core.validateScheme(
    custom({ levels: ["{cn}、", "{p}、"], numbering: "hierarchical", separator: "" })
  );
  assert.equal(noSep.ok, false);
});

test("方案：重复模板给出 warning 而不是错误", () => {
  const result = core.validateScheme(custom({ levels: ["{n}、", "{n}、"] }));
  assert.equal(result.ok, true);
  assert.equal(result.warnings.length, 1);
  assert.match(result.warnings[0], /匹配规则相同/);
});

test("方案：标点等价类（1． / 1。 / (一)）", () => {
  assert.equal(core.parseLine("1．A", { scheme: core.PRESETS.gongwen }).number, 1);
  assert.equal(core.parseLine("1。A", { scheme: core.PRESETS.gongwen }).number, 1);
  assert.equal(core.parseLine("(一)A", { scheme: core.PRESETS.gongwen }).level, 2);
  assert.equal(core.parseLine("（一）A", { scheme: core.PRESETS.points }), null);
});

test("方案：{p} 只在对应段数的层级命中", () => {
  const outline = core.PRESETS.outline;
  assert.equal(core.parseLine("1.1、A", { scheme: outline }).level, 2);
  assert.equal(core.parseLine("1.1.1、A", { scheme: outline }).level, 3);
  assert.equal(core.parseLine("1.1.1.1、A", { scheme: outline }), null);
});

test("方案：{n}. 的 Markdown 边界", () => {
  const dot = custom({ levels: ["{cn}、", "{n}."] });
  assert.equal(core.parseLine("1. 内容", { scheme: dot }), null); // 交给 Obsidian 原生列表
  assert.equal(core.parseLine("1.内容", { scheme: dot }).level, 2);
  const parsed = core.parseLine("1. 内容", { scheme: dot, handleMarkdown: true });
  assert.equal(parsed.level, 2);
  assert.equal(core.buildMarker(parsed, 2, { scheme: dot, handleMarkdown: true }), "2. ");
});

test("方案：自定义分隔符 -", () => {
  const scheme = custom({
    levels: ["{cn}、", "{p}、"],
    numbering: "hierarchical",
    separator: "-",
  });
  const parsed = core.parseLine("  1-2、A", { scheme });
  assert.equal(parsed.level, 2);
  assert.deepEqual(parsed.path, [1, 2]);
  assert.equal(core.buildMarker(parsed, [1, 3], { scheme }), "1-3、");
});
