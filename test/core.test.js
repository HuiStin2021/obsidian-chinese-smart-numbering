const test = require("node:test");
const assert = require("node:assert/strict");
const core = require("../src/core.js");

const GONGWEN = { scheme: core.PRESETS.gongwen };
const POINTS = { scheme: core.PRESETS.points };
const OUTLINE = { scheme: core.PRESETS.outline };

function withOpts(extra) {
  return Object.assign({ scheme: core.PRESETS.gongwen }, extra || {});
}

function applyEdit(text, res) {
  return text.slice(0, res.from) + res.insert + text.slice(res.to);
}

function enter(text, pos, extra) {
  const res = core.handleEnter(text, pos, withOpts(extra));
  return res ? { text: applyEdit(text, res), cursor: res.cursor, res } : null;
}

function tab(text, pos, dir, extra) {
  const res = core.handleTab(text, pos, dir, withOpts(extra));
  return res ? { text: applyEdit(text, res), cursor: res.cursor, res } : null;
}

function backspace(text, pos, extra) {
  const res = core.handleBackspace(text, pos, withOpts(extra));
  return res ? { text: applyEdit(text, res), cursor: res.cursor, res } : null;
}

function renumber(text, pos, extra) {
  const res = core.renumber(text, pos, withOpts(extra));
  return res ? { text: applyEdit(text, res), cursor: res.cursor, res } : null;
}

function renumberText(text, extra) {
  const res = renumber(text, 0, extra);
  return res ? res.text : text;
}

// ---------------------------------------------------------------- 解析

test("解析：公文五级与层级编号", () => {
  const samples = [
    ["一、总体要求", 1, "cn", 1, "一、"],
    ["（二）指导思想", 2, "cn", 2, "（二）"],
    ["3、重点任务", 3, "n", 3, "3、"],
    ["（4）具体措施", 4, "n", 4, "（4）"],
    ["⑤台账", 5, "c", 5, "⑤"],
  ];
  for (const [line, level, kind, number, marker] of samples) {
    const parsed = core.parseLine(line, GONGWEN);
    assert.ok(parsed, line + " 应被识别");
    assert.equal(parsed.level, level);
    assert.equal(parsed.kind, kind);
    assert.equal(parsed.number, number);
    assert.equal(parsed.marker, marker);
  }
});

test("解析：分隔符变体与半角括号", () => {
  for (const line of ["1．内容", "1。内容", "1、内容"]) {
    const parsed = core.parseLine(line, GONGWEN);
    assert.ok(parsed, line);
    assert.equal(parsed.number, 1);
    assert.equal(parsed.level, 3);
  }
  assert.equal(core.parseLine("(三)内容", GONGWEN).number, 3);
  assert.equal(core.parseLine("(3)内容", GONGWEN).number, 3);
});

test("解析：缩进、引用前缀、中文数字", () => {
  const indented = core.parseLine("    （二）内容", GONGWEN);
  assert.equal(indented.indent, "    ");
  assert.equal(indented.markerStart, 4);
  assert.equal(indented.content, "内容");

  const quoted = core.parseLine("> 一、内容", GONGWEN);
  assert.equal(quoted.prefix, "> ");
  assert.equal(quoted.number, 1);

  assert.equal(core.parseLine("十二、内容", GONGWEN).number, 12);
  assert.equal(core.parseLine("一百零三、内容", GONGWEN).number, 103);
});

test("解析：不该误判的行", () => {
  assert.equal(core.parseLine("1.5 亿元", GONGWEN), null);
  assert.equal(core.parseLine("2023 年总结", GONGWEN), null);
  assert.equal(core.parseLine("1. Markdown 列表", GONGWEN), null);
  assert.equal(core.parseLine("这是一个普通段落", GONGWEN), null);
  assert.equal(core.parseLine("", GONGWEN), null);
  assert.equal(core.parseLine("2）括号不配对", GONGWEN), null);
});

test("解析：多级路径按段数区分层级", () => {
  const two = core.parseLine("  1.1、现状", OUTLINE);
  assert.equal(two.level, 2);
  assert.deepEqual(two.path, [1, 1]);

  const three = core.parseLine("    1.1.1、细节", OUTLINE);
  assert.equal(three.level, 3);
  assert.deepEqual(three.path, [1, 1, 1]);

  assert.equal(core.parseLine("1.5 亿元", OUTLINE), null);
  assert.equal(core.parseLine("1.1、", POINTS), null);
});

test("解析：{n}. 列表默认交给 Obsidian，可显式接管", () => {
  const scheme = {
    id: "dot",
    name: "dot",
    levels: ["{cn}、", "{n}. "],
    indent: 0,
    numbering: "independent",
    separator: ".",
  };
  assert.equal(core.parseLine("1. 内容", { scheme }), null);
  const parsed = core.parseLine("1. 内容", { scheme, handleMarkdown: true });
  assert.equal(parsed.level, 2);
  assert.equal(parsed.marker, "1. ");
});

// ---------------------------------------------------------------- 回车

test("回车：1、 → 2、（用户核心诉求）", () => {
  const text = "1、加强组织领导";
  const res = enter(text, text.length);
  assert.equal(res.text, text + "\n2、");
  assert.equal(res.cursor, res.text.length);
});

test("回车：五种层级各自续号", () => {
  assert.equal(enter("一、总体要求", 6).text, "一、总体要求\n二、");
  assert.equal(enter("（一）指导思想", 8).text, "（一）指导思想\n（二）");
  assert.equal(enter("（1）具体措施", 7).text, "（1）具体措施\n（2）");
  assert.equal(enter("①建立台账", 6).text, "①建立台账\n②");
});

test("回车：中文数字与圈号边界", () => {
  assert.equal(enter("九、内容", 5).text, "九、内容\n十、");
  assert.equal(enter("十一、内容", 6).text, "十一、内容\n十二、");
  assert.equal(enter("九十九、内容", 7).text, "九十九、内容\n一百、");
  assert.equal(enter("⑳内容", 3), null);
  assert.equal(enter("九百九十九、内容", 8), null);
});

test("回车：保留分隔符、尾随空格、缩进与引用", () => {
  assert.equal(enter("1．内容", 4).text, "1．内容\n2．");
  assert.equal(enter("1、 内容", 5).text, "1、 内容\n2、 ");
  assert.equal(enter("    1、内容", 8).text, "    1、内容\n    2、");
  assert.equal(enter("> 一、内容", 7).text, "> 一、内容\n> 二、");
});

test("回车：空编号行退出编号", () => {
  assert.equal(enter("1、", 2).text, "");
  assert.equal(enter("1、   ", 5).text, "");
  assert.equal(enter("（一）", 3).text, "");
});

test("回车：行中回车从光标处断开", () => {
  const res = enter("1、abcd", 3);
  assert.equal(res.text, "1、a\n2、bcd");
  assert.equal(res.cursor, "1、a\n2、".length);
});

test("回车：普通行不接管，光标在编号内部不接管", () => {
  assert.equal(enter("普通段落", 4), null);
  assert.equal(enter("一、内容", 1), null);
});

// ---------------------------------------------------------------- 退格

test("退格：标记末尾一键清除编号", () => {
  assert.equal(backspace("1、事项", 2).text, "事项");
  assert.equal(backspace("1、 事项", 3).text, "事项");
  assert.equal(backspace("（一）事项", 3).text, "事项");
});

test("退格：正文中间不清除", () => {
  assert.equal(backspace("1、事项", 3), null);
  assert.equal(backspace("1、事项", 0), null);
  assert.equal(backspace("普通段落", 2), null);
});

// ---------------------------------------------------------------- Tab 换级

test("Tab：公文逐级下沉与上浮", () => {
  assert.equal(tab("一、内容", 1, 1).text, "（一）内容");
  assert.equal(tab("（一）内容", 1, 1).text, "1、内容");
  assert.equal(tab("1、内容", 1, 1).text, "（1）内容");
  assert.equal(tab("（1）内容", 1, 1).text, "①内容");
  assert.equal(tab("①内容", 1, 1), null);
  assert.equal(tab("（一）内容", 1, -1).text, "一、内容");
  assert.equal(tab("1、内容", 1, -1).text, "（一）内容");
  assert.equal(tab("（1）内容", 1, -1).text, "1、内容");
  assert.equal(tab("①内容", 1, -1).text, "（1）内容");
  assert.equal(tab("一、内容", 1, -1), null);
});

test("Tab：序号取上一个同级项 +1", () => {
  const text = "一、A\n（一）a\n1、x\n（1）p\n1、y";
  const pos = text.lastIndexOf("1、y");
  assert.equal(tab(text, pos, 1).text, "一、A\n（一）a\n1、x\n（1）p\n（2）y");
});

// ---------------------------------------------------------------- 整块重排

test("重排：同级顺序化", () => {
  assert.equal(renumberText("1、A\n1、B\n1、C"), "1、A\n2、B\n3、C");
  assert.equal(renumberText("9、A\n9、B"), "9、A\n10、B");
});

test("重排：下级遇到上级重新从一开始", () => {
  assert.equal(renumberText("1、A\n（1）a\n1、B\n（1）b"), "1、A\n（1）a\n2、B\n（1）b");
});

test("重排：只影响连续编号块", () => {
  const text = "前言\n1、A\n1、B\n\n1、C";
  assert.equal(renumber(text, text.indexOf("1、A")).text, "前言\n1、A\n2、B\n\n1、C");
});

test("重排：保留分隔符、括号、缩进与圈号", () => {
  assert.equal(renumberText("1．A\n1．B"), "1．A\n2．B");
  assert.equal(renumberText("(1)A\n(1)B"), "(1)A\n(2)B");
  assert.equal(renumberText("    1、A\n    1、B"), "    1、A\n    2、B");
  assert.equal(renumberText("①A\n①B"), "①A\n②B");
});

test("重排：已经连续时不做改动", () => {
  assert.equal(renumber("1、A\n2、B\n3、C", 0), null);
  assert.equal(renumber("普通段落", 0), null);
});

test("重排：光标位置随编号长度变化", () => {
  const text = "9、A\n9、B";
  const res = renumber(text, 4 + 3);
  assert.equal(res.text, "9、A\n10、B");
  assert.equal(res.cursor, res.text.length);
});

// ---------------------------------------------------------------- 分点（微信/IM）

test("分点：Tab 后光标仍在行尾", () => {
  const res = tab("一、A", 3, 1, POINTS);
  assert.equal(res.text, "  1、A");
  assert.equal(res.cursor, "  1、A".length);
});

test("分点：Tab 缩进 2，回车保持缩进，Shift-Tab 缩回", () => {
  assert.equal(tab("一、A", 0, 1, POINTS).text, "  1、A");
  assert.equal(enter("  1、A", 5, POINTS).text, "  1、A\n  2、");
  assert.equal(tab("  1、A", 2, 1, POINTS).text, "    （1）A");
  assert.equal(tab("    （1）A", 4, -1, POINTS).text, "  1、A");
  assert.equal(tab("  1、A", 2, -1, POINTS).text, "一、A");
});

// ---------------------------------------------------------------- 多级（邮件 1.1、）

test("多级：一、下面接 1.1、，路径按父级走", () => {
  assert.equal(tab("一、背景", 0, 1, OUTLINE).text, "  1.1、背景");
  assert.equal(enter("  1.1、现状", 8, OUTLINE).text, "  1.1、现状\n  1.2、");
  assert.equal(enter("    1.1.1、细节", 12, OUTLINE).text, "    1.1.1、细节\n    1.1.2、");
});

test("多级：Tab / Shift-Tab 逐级切换", () => {
  assert.equal(tab("  1.1、现状", 2, 1, OUTLINE).text, "    1.1.1、现状");
  assert.equal(tab("    1.1.1、细节", 4, -1, OUTLINE).text, "  1.1、细节");
});

test("多级：整块重排按父级重算路径", () => {
  const text = "一、背景\n  1.1、现状\n  1.1、问题\n二、方案\n  1.1、措施";
  assert.equal(
    renumberText(text, OUTLINE),
    "一、背景\n  1.1、现状\n  1.2、问题\n二、方案\n  2.1、措施"
  );
});

test("多级：1.5 亿元 不被当成编号", () => {
  assert.equal(enter("1.5 亿元", 6, OUTLINE), null);
});

test("多级：超过方案层级后不再换级", () => {
  assert.equal(tab("    1.1.1、细节", 4, 1, OUTLINE), null);
});

// ---------------------------------------------------------------- 自定义

test("自定义：第{n}条 续号", () => {
  const scheme = {
    id: "custom",
    name: "第X条",
    levels: ["第{n}条 "],
    indent: 0,
    numbering: "independent",
    separator: ".",
  };
  const text = "第1条 总则";
  const res = enter(text, text.length, { scheme });
  assert.equal(res.text, "第1条 总则\n第2条 ");
});

test("自定义：纯数字大纲 1、 1.1、 1.1.1、", () => {
  const scheme = {
    id: "custom",
    name: "纯数字",
    levels: ["{n}、", "{p}、", "{p}、"],
    indent: 2,
    numbering: "hierarchical",
    separator: ".",
  };
  assert.equal(tab("1、背景", 0, 1, { scheme }).text, "  1.1、背景");
  assert.equal(enter("  1.1、现状", 8, { scheme }).text, "  1.1、现状\n  1.2、");
  assert.equal(
    renumberText("1、背景\n  1.1、现状\n  1.1、问题\n2、方案\n  1.1、措施", { scheme }),
    "1、背景\n  1.1、现状\n  1.2、问题\n2、方案\n  2.1、措施"
  );
});

// ---------------------------------------------------------------- 数字工具

test("中文数字：双向转换", () => {
  const cases = {
    1: "一", 2: "二", 9: "九", 10: "十", 11: "十一", 19: "十九", 20: "二十",
    99: "九十九", 100: "一百", 101: "一百零一", 110: "一百一十", 111: "一百一十一",
    999: "九百九十九",
  };
  for (const [n, cn] of Object.entries(cases)) {
    assert.equal(core.toChinese(Number(n)), cn);
    assert.equal(core.fromChinese(cn), Number(n));
  }
  for (let n = 1; n <= 999; n++) {
    assert.equal(core.fromChinese(core.toChinese(n)), n);
  }
  assert.equal(core.toChinese(0), null);
  assert.equal(core.toChinese(1000), null);
});

test("圈号：双向转换与上限", () => {
  assert.equal(core.toCircled(1), "①");
  assert.equal(core.toCircled(20), "⑳");
  assert.equal(core.toCircled(21), null);
  assert.equal(core.fromCircled("⑳"), 20);
});
