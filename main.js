/*
 * 中文智能编号 (Smart Chinese Numbering) v1.1.4
 * 本文件由 build.mjs 生成，请勿直接编辑；修改 src/core.js 或 src/plugin-entry.js 后运行 node build.mjs
 */
"use strict";

/*
 * 中文智能编号 · Obsidian 胶水层
 *
 * 这里只做四件事：监听按键、调用 src/core.js 的纯文本逻辑、把结果 dispatch 回编辑器、
 * 管理“编号方案”（公文 / 分点 / 多级 / 自定义）。
 * main.js 由 build.mjs 生成（内联 core.js），请不要直接改 main.js。
 */

const { Plugin, PluginSettingTab, Setting, Notice, Menu } = require("obsidian");
const { EditorView } = require("@codemirror/view");
const { Prec } = require("@codemirror/state");

const SCNCore = (function () {
  "use strict";
  const CIRCLED_CHARS = "①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳";
const CN_DIGITS = "零一二三四五六七八九";
const CN_VALUES = {
  零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4,
  五: 5, 六: 6, 七: 7, 八: 8, 九: 9,
};
const CN_RE = "[一二三四五六七八九十百零〇两]+";

/** 行首缩进 + 引用前缀，例如 "  > " */
const PREFIX_RE = /^(?:[ \t]*>)*[ \t]*/;

const PLACEHOLDER_RE = /\{(cn|n|c|p)\}/;
const MAX_LEVELS = 9;
const MAX_TEMPLATE_LENGTH = 40;

const PRESETS = {
  gongwen: {
    id: "gongwen",
    name: "公文",
    levels: ["{cn}、", "（{cn}）", "{n}、", "（{n}）", "{c}"],
    indent: 0,
    numbering: "independent",
    separator: ".",
    pathBase: 1,
  },
  points: {
    id: "points",
    name: "微信 / IM",
    levels: ["{cn}、", "{n}、"],
    indent: 2,
    numbering: "independent",
    separator: ".",
    pathBase: 1,
  },
  outline: {
    id: "outline",
    name: "邮件",
    levels: ["{cn}、", "{n}、", "{p}、"],
    indent: 2,
    numbering: "hierarchical",
    separator: ".",
    pathBase: 2,
  },
};

const DEFAULT_SCHEME_ID = "gongwen";

const DEFAULTS = {
  continueOnEnter: true,
  tabSwitch: true,
  backspaceDelete: true,
  autoRenumber: false,
  spaceAfterMarker: false,
  handleMarkdown: false,
  scheme: PRESETS[DEFAULT_SCHEME_ID],
};

function merge(opts) {
  return Object.assign({}, DEFAULTS, opts || {});
}

function toChinese(n) {
  if (!Number.isInteger(n) || n < 1 || n > 999) return null;
  if (n < 10) return CN_DIGITS[n];
  if (n < 20) return "十" + (n % 10 ? CN_DIGITS[n % 10] : "");
  if (n < 100) {
    return CN_DIGITS[Math.floor(n / 10)] + "十" + (n % 10 ? CN_DIGITS[n % 10] : "");
  }
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  let out = CN_DIGITS[hundreds] + "百";
  if (rest === 0) return out;
  if (rest < 10) return out + "零" + CN_DIGITS[rest];
  if (rest < 20) return out + "一十" + (rest % 10 ? CN_DIGITS[rest % 10] : "");
  return out + toChinese(rest);
}

function fromChinese(text) {
  let total = 0;
  let digit = 0;
  for (const ch of text) {
    if (ch in CN_VALUES) {
      digit = CN_VALUES[ch];
    } else if (ch === "十") {
      total += (digit || 1) * 10;
      digit = 0;
    } else if (ch === "百") {
      total += (digit || 1) * 100;
      digit = 0;
    } else {
      return NaN;
    }
  }
  return total + digit;
}

function toCircled(n) {
  return n >= 1 && n <= CIRCLED_CHARS.length ? CIRCLED_CHARS[n - 1] : null;
}

function fromCircled(ch) {
  return CIRCLED_CHARS.indexOf(ch) + 1;
}

function escapeRegex(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** 模板里的字面量：标点做等价类，其余转义 */
function literalSource(ch) {
  if (ch === "、") return "[、．。]";
  if (ch === "（" || ch === "(") return "[（(]";
  if (ch === "）" || ch === ")") return "[）)]";
  return escapeRegex(ch);
}

function tokenizeTemplate(template) {
  const parts = [];
  let i = 0;
  while (i < template.length) {
    const match = template.slice(i).match(/^\{(cn|n|c|p)\}/);
    if (match) {
      parts.push({ type: "placeholder", kind: match[1] });
      i += match[0].length;
      continue;
    }
    const codePoint = template.codePointAt(i);
    const ch = String.fromCodePoint(codePoint);
    parts.push({ type: "literal", ch });
    i += ch.length;
  }
  return parts;
}

function formatValue(kind, value, scheme) {
  if (kind === "p") {
    if (!Array.isArray(value) || !value.length) return null;
    return value.map((n) => String(n)).join(scheme.separator || ".");
  }
  if (kind === "cn") return toChinese(value);
  if (kind === "c") return toCircled(value);
  if (kind === "n") return String(value);
  return null;
}

function placeholderSource(kind, index, separator, segments) {
  if (kind === "cn") return CN_RE;
  if (kind === "c") return "[①-⑳]";
  if (kind === "n") return "\\d{1,3}(?!\\d)";
  // {p}：按 pathBase 算出的段数精确匹配（如 pathBase=2、第 3 级 → 两段 1.1）
  const sep = separator || ".";
  const sepEscaped = escapeRegex(sep);
  return (
    "\\d{1,3}(?:" + sepEscaped + "\\d{1,3}){" + (segments - 1) + "}" +
    "(?!\\d)(?!" + sepEscaped + "\\d)"
  );
}

/** {p} 在某一级需要几段路径；pathBase=1 时第 k 级 k 段，pathBase=2 时第 k 级 k-1 段 */
function pathSegments(levelIndex, pathBase) {
  return levelIndex + 2 - (pathBase || 1);
}

function compileLevel(template, index, scheme) {
  const parts = tokenizeTemplate(template);
  const placeholders = parts.filter((part) => part.type === "placeholder");
  if (placeholders.length !== 1) {
    throw new Error("第 " + (index + 1) + " 级必须且只能有一个占位符");
  }
  const kind = placeholders[0].kind;
  if (kind === "p" && scheme.numbering !== "hierarchical") {
    throw new Error("第 " + (index + 1) + " 级使用了 {p}，需要把编号方式设为“多级”");
  }
  const segments = kind === "p" ? pathSegments(index, scheme.pathBase) : 0;
  if (kind === "p" && segments < 1) {
    throw new Error(
      "第 " + (index + 1) + " 级在多级路径起点之前，不能用 {p}（路径起点是第 " +
        (scheme.pathBase || 1) + " 级）"
    );
  }

  let source = "^";
  for (const part of parts) {
    source += part.type === "literal"
      ? literalSource(part.ch)
      : "(" + placeholderSource(kind, index, scheme.separator, segments) + ")";
  }

  return {
    template,
    kind,
    index,
    segments,
    regex: new RegExp(source, "d"),
    markdownLike: template.trim() === "{n}.",
    /** 示例取值：多级路径按段数补 1 */
    sampleValue() {
      return kind === "p" ? new Array(segments).fill(1) : 1;
    },
    canonical(value) {
      const formatted = formatValue(kind, value, scheme);
      if (formatted == null) return null;
      return template.replace(PLACEHOLDER_RE, () => formatted);
    },
  };
}

const compiledSchemes = new WeakMap();

function compileScheme(raw) {
  const scheme = raw || PRESETS[DEFAULT_SCHEME_ID];
  if (scheme.__compiled) return scheme;
  const cached = compiledSchemes.get(scheme);
  if (cached) return cached;
  const levels = (scheme.levels || []).map((template, index) =>
    compileLevel(template, index, scheme)
  );
  const compiled = Object.assign({}, scheme, { __compiled: true, levels });
  compiledSchemes.set(scheme, compiled);
  return compiled;
}

/**
 * 校验自定义方案，返回 { ok, errors, warnings }，供设置页实时提示。
 */
function validateScheme(raw) {
  const errors = [];
  const warnings = [];
  if (!raw || !Array.isArray(raw.levels) || raw.levels.length === 0) {
    return { ok: false, errors: ["至少需要一个层级"], warnings };
  }
  if (raw.levels.length > MAX_LEVELS) {
    errors.push("最多支持 " + MAX_LEVELS + " 级");
  }
  const seen = new Map();
  raw.levels.forEach((template, index) => {
    const label = "第 " + (index + 1) + " 级";
    if (typeof template !== "string" || template.trim() === "") {
      errors.push(label + "不能为空");
      return;
    }
    if (template.length > MAX_TEMPLATE_LENGTH) {
      errors.push(label + "超过 " + MAX_TEMPLATE_LENGTH + " 个字符");
    }
    const placeholders = template.match(/\{(cn|n|c|p)\}/g) || [];
    if (placeholders.length === 0) {
      errors.push(label + "缺少占位符（{cn}、{n}、{c} 或 {p}）");
    } else if (placeholders.length > 1) {
      errors.push(label + "只能有一个占位符");
    }
    const braces = (template.match(/[{}]/g) || []).length;
    if (braces !== placeholders.length * 2) {
      errors.push(label + "的花括号写法不对");
    }
    if (placeholders[0] === "{p}" && raw.numbering !== "hierarchical") {
      errors.push(label + "使用了 {p}，请把编号方式设为“多级”");
    }
  });
  if (raw.numbering !== "independent" && raw.numbering !== "hierarchical") {
    errors.push("编号方式只能是“独立”或“多级”");
  }
  if (raw.numbering === "hierarchical" && !raw.separator) {
    errors.push("多级编号需要分隔符");
  }
  if (typeof raw.indent !== "number" || raw.indent < 0 || raw.indent > 8) {
    errors.push("缩进需要在 0–8 之间");
  }
  const pathBase = raw.pathBase == null ? 1 : raw.pathBase;
  if (
    !Number.isInteger(pathBase) ||
    pathBase < 1 ||
    pathBase > Math.max(1, raw.levels.length)
  ) {
    errors.push("多级路径起点需要在 1–" + Math.max(1, raw.levels.length) + " 之间");
  }
  if (errors.length === 0) {
    try {
      const compiled = compileScheme(raw);
      compiled.levels.forEach((level) => {
        const key = level.regex.source;
        if (seen.has(key)) {
          warnings.push(
            "第 " + (seen.get(key) + 1) + " 级与第 " + (level.index + 1) + " 级的匹配规则相同，先定义者优先"
          );
        } else {
          seen.set(key, level.index);
        }
      });
    } catch (error) {
      errors.push(error.message);
    }
  }
  return { ok: errors.length === 0, errors, warnings };
}

/** 给设置页 / demo 用的示例：每级一个示例标记 */
function schemeSample(raw) {
  const scheme = compileScheme(raw);
  return scheme.levels.map((level, index) => {
    const token = level.canonical(level.sampleValue()) || "";
    return " ".repeat((raw.indent || 0) * index) + token;
  });
}

const EXAMPLE_TEXT = ["背景与目标", "现状", "具体细节", "存在的问题", "下一步安排"];

/**
 * 生成一段“配置后的样子”：三级嵌套 + 同级第二条 + 回到上级，用户一眼能看出续号与层级。
 * 返回字符串数组，交给设置页 / demo 直接渲染。
 */
function schemeExample(raw) {
  const scheme = compileScheme(raw);
  const unit = " ".repeat(scheme.indent || 0);
  const depth = Math.min(scheme.levels.length, 3);
  const lines = [];

  function line(level, value, text) {
    const target = scheme.levels[level - 1];
    if (!target) return;
    const token = target.canonical(value);
    if (!token) return;
    lines.push(unit.repeat(level - 1) + token + text);
  }

  line(1, 1, EXAMPLE_TEXT[0]);
  if (depth >= 2) line(2, 1, EXAMPLE_TEXT[1]);
  if (depth >= 3) line(3, scheme.levels[2].sampleValue(), EXAMPLE_TEXT[2]);
  if (depth >= 2) line(2, 2, EXAMPLE_TEXT[3]);
  line(1, 2, EXAMPLE_TEXT[4]);
  return lines;
}

function lineStarts(text) {
  const starts = [0];
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10) starts.push(i + 1);
  }
  return starts;
}

function locateLine(text, pos) {
  const starts = lineStarts(text);
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= pos) lo = mid;
    else hi = mid - 1;
  }
  const start = starts[lo];
  const end = lo + 1 < starts.length ? starts[lo + 1] - 1 : text.length;
  return { index: lo, start, end, text: text.slice(start, end), starts };
}

/**
 * 解析一行：返回编号标记及其位置；不是编号行则返回 null。
 */
function parseLine(text, opts) {
  const o = merge(opts);
  const scheme = compileScheme(o.scheme);
  const prefixMatch = text.match(PREFIX_RE);
  const prefix = prefixMatch ? prefixMatch[0] : "";
  const rest = text.slice(prefix.length);

  for (let index = 0; index < scheme.levels.length; index++) {
    const level = scheme.levels[index];
    const match = level.regex.exec(rest);
    if (!match) continue;

    if (level.markdownLike && !o.handleMarkdown) {
      const after = rest.slice(match[0].length);
      // “1. ” 是 Obsidian 原生 Markdown 列表，默认交回去
      if (/[ \t]$/.test(match[0]) || /^[ \t]|^$/.test(after)) continue;
    }

    const captured = match[1];
    let number;
    let path = null;
    if (level.kind === "p") {
      path = captured.split(scheme.separator || ".").map(Number);
      number = path[path.length - 1];
    } else if (level.kind === "cn") {
      number = fromChinese(captured);
    } else if (level.kind === "c") {
      number = fromCircled(captured);
    } else {
      number = Number(captured);
    }
    if (!(number >= 1)) continue;

    const indices = match.indices && match.indices[1];
    const numberStart = indices ? indices[0] : match[0].indexOf(captured);
    const numberEnd = indices ? indices[1] : numberStart + captured.length;
    const trailingMatch = rest.slice(match[0].length).match(/^[ \t]+/);
    const trailing = trailingMatch ? trailingMatch[0] : "";
    const markerEnd = prefix.length + match[0].length + trailing.length;

    return {
      level: index + 1,
      kind: level.kind,
      template: level.template,
      number,
      path,
      token: match[0],
      numberStart,
      numberEnd,
      prefix,
      indent: prefix.match(/^[ \t]*/)[0],
      markerStart: prefix.length,
      markerEnd,
      marker: text.slice(prefix.length, markerEnd),
      trailing,
      content: text.slice(markerEnd),
    };
  }
  return null;
}

/**
 * 生成序号标记。
 * - 不指定 forcedLevel：保留 line 里原有的标点/括号写法，只替换数字（或路径）；
 * - 指定 forcedLevel：用目标级模板规范重建。
 */
function buildMarker(parsed, value, opts, forcedLevel) {
  const o = merge(opts);
  const scheme = compileScheme(o.scheme);
  const trailing = o.spaceAfterMarker ? " " : (parsed.trailing || "");
  const level = forcedLevel ? scheme.levels[forcedLevel - 1] : scheme.levels[parsed.level - 1];
  if (!level) return null;

  const formatted = formatValue(level.kind, value, scheme);
  if (formatted == null) return null;

  if (forcedLevel) {
    return level.template.replace(PLACEHOLDER_RE, () => formatted) + trailing;
  }
  const token = parsed.token.slice(0, parsed.numberStart) + formatted + parsed.token.slice(parsed.numberEnd);
  return token + trailing;
}

function applyEdit(text, edit) {
  return text.slice(0, edit.from) + edit.insert + text.slice(edit.to);
}

/**
 * 回车：编号行 → 下一行同款编号（序号 +1，多级则路径末段 +1）。
 * 空编号行 → 去掉标记（退出编号）。
 * 非编号行 → null（交回默认换行）。
 */
function handleEnter(text, pos, opts) {
  const o = merge(opts);
  const line = locateLine(text, pos);
  const parsed = parseLine(line.text, o);
  if (!parsed) return null;
  if (pos < line.start + parsed.markerEnd) return null;

  if (line.text.slice(parsed.markerEnd).trim() === "") {
    const from = line.start + parsed.markerStart;
    const to = line.start + parsed.markerEnd;
    return { from, to, insert: "", cursor: from };
  }

  let value;
  if (parsed.kind === "p") {
    value = parsed.path.slice();
    value[value.length - 1] += 1;
  } else {
    value = parsed.number + 1;
  }
  const next = buildMarker(parsed, value, o);
  if (!next) return null;
  const insert = "\n" + parsed.prefix + next;
  return { from: pos, to: pos, insert, cursor: pos + insert.length };
}

/**
 * Tab / Shift-Tab：按方案的层级顺序换级，序号取前一个同级项 +1；
 * 方案带 indent 时，缩进随层级增量调整。
 */
function handleTab(text, pos, dir, opts) {
  const o = merge(opts);
  const scheme = compileScheme(o.scheme);
  const line = locateLine(text, pos);
  const parsed = parseLine(line.text, o);
  if (!parsed) return null;

  const target = parsed.level + dir;
  if (target < 1 || target > scheme.levels.length) return null;

  const targetLevel = scheme.levels[target - 1];
  let value;
  if (targetLevel.kind === "p") {
    const pathBase = scheme.pathBase || 1;
    const width = Math.max(0, target - pathBase);
    const base = Array.isArray(parsed.path) ? parsed.path.slice(0, width) : [];
    while (base.length < width) base.push(1);
    // 当前行正好是目标级的父级时，用它的序号当路径首段（如 2、 → 2.1、）
    const offset = parsed.level - pathBase;
    if (offset >= 0 && offset < base.length) base[offset] = parsed.number;
    value = base.concat([1]);
  } else {
    const lines = text.split("\n");
    let n = 1;
    for (let i = line.index - 1; i >= 0; i--) {
      const prev = parseLine(lines[i], o);
      if (!prev) break;
      if (prev.level === target) n++;
      else if (prev.level < target) break;
    }
    value = n;
  }

  const marker = buildMarker(parsed, value, o, target);
  if (!marker) return null;

  let indent = parsed.indent;
  const delta = (target - parsed.level) * (scheme.indent || 0);
  if (delta > 0) indent = indent + " ".repeat(delta);
  else if (delta < 0) indent = indent.slice(0, Math.max(0, indent.length + delta));
  const prefix = indent + parsed.prefix.slice(parsed.indent.length);

  const insert = prefix + marker;
  const oldMarkerEnd = line.start + parsed.markerEnd;
  const newMarkerEnd = line.start + insert.length;
  const newLineEnd = newMarkerEnd + parsed.content.length;
  // 光标在正文里（常见：行尾）就保持相对位置；在编号内则落到新编号之后
  const cursor = pos >= oldMarkerEnd
    ? newMarkerEnd + Math.min(pos - oldMarkerEnd, parsed.content.length)
    : newMarkerEnd;
  return { from: line.start, to: line.start + parsed.markerEnd, insert, cursor };
}

/** 退格：光标正好在标记之后 → 整段删除标记，保留正文 */
function handleBackspace(text, pos, opts) {
  const o = merge(opts);
  const line = locateLine(text, pos);
  const parsed = parseLine(line.text, o);
  if (!parsed) return null;
  if (pos !== line.start + parsed.markerEnd) return null;
  const from = line.start + parsed.markerStart;
  return { from, to: line.start + parsed.markerEnd, insert: "", cursor: from };
}

/**
 * 重排光标所在的整块连续编号。
 * - 独立编号：同级递增，下级遇到新的上级重新从 1 开始，保留块首序号作为起点；
 * - 多级编号：按路径重算（1.1 / 1.2 / 2.1），父级变化时下级自动重置。
 */
function renumber(text, pos, opts) {
  const o = merge(opts);
  const scheme = compileScheme(o.scheme);
  const hierarchical = scheme.numbering === "hierarchical";
  const pathBase = scheme.pathBase || 1;
  const levelCount = scheme.levels.length;
  const lines = text.split("\n");
  const caret = locateLine(text, pos);
  if (!parseLine(lines[caret.index], o)) return null;

  let start = caret.index;
  let end = caret.index;
  while (start > 0 && parseLine(lines[start - 1], o)) start--;
  while (end < lines.length - 1 && parseLine(lines[end + 1], o)) end++;

  const out = lines.slice();
  const counters = new Array(levelCount + 2).fill(0);
  const startNumbers = new Map();
  let seeded = false;
  let changed = false;
  let deltaBefore = 0;
  let cursor = pos;

  for (let i = start; i <= end; i++) {
    const parsed = parseLine(lines[i], o);
    const level = parsed.level;
    let value;

    for (let deeper = level + 1; deeper <= levelCount; deeper++) counters[deeper] = 0;

    if (hierarchical) {
      if (!seeded) {
        if (parsed.kind === "p") {
          parsed.path.forEach((n, offset) => {
            const target2 = pathBase + offset;
            if (target2 <= levelCount) counters[target2] = n;
          });
        } else {
          counters[level] = parsed.number;
        }
        seeded = true;
      } else {
        counters[level] += 1;
      }
      for (let parent = pathBase; parent < level; parent++) {
        if (!counters[parent]) counters[parent] = 1;
      }
      value = scheme.levels[level - 1].kind === "p"
        ? counters.slice(pathBase, level + 1)
        : counters[level];
    } else {
      if (!startNumbers.has(level)) startNumbers.set(level, parsed.number);
      if (!counters[level]) counters[level] = startNumbers.get(level) - 1;
      counters[level] += 1;
      value = counters[level];
    }

    const marker = buildMarker(parsed, value, o);
    if (!marker) continue;

    if (marker !== parsed.marker) {
      out[i] = lines[i].slice(0, parsed.markerStart) + marker + lines[i].slice(parsed.markerEnd);
      changed = true;
    }

    if (i === caret.index) {
      if (pos <= caret.start + parsed.markerStart) {
        cursor = pos + deltaBefore;
      } else if (pos < caret.start + parsed.markerEnd) {
        cursor = caret.start + parsed.markerStart + marker.length + deltaBefore;
      } else {
        cursor = pos + deltaBefore + (marker.length - parsed.marker.length);
      }
    } else if (i < caret.index) {
      deltaBefore += out[i].length - lines[i].length;
    }
  }

  if (!changed) return null;

  const from = caret.starts[start];
  const to = end + 1 < caret.starts.length ? caret.starts[end + 1] - 1 : text.length;
  const insert = out.slice(start, end + 1).join("\n");
  cursor = Math.min(Math.max(cursor, from), from + insert.length);
  return { from, to, insert, cursor };
}

return {
  PRESETS,
  DEFAULT_SCHEME_ID,
  DEFAULTS,
  MAX_LEVELS,
  compileScheme,
  validateScheme,
  schemeSample,
  schemeExample,
  parseLine,
  buildMarker,
  handleEnter,
  handleTab,
  handleBackspace,
  renumber,
  applyEdit,
  toChinese,
  fromChinese,
  toCircled,
  fromCircled,
};
})();

const SCHEME_SHORT_NAME = {
  gongwen: "公文",
  points: "微信",
  outline: "邮件",
  custom: "自定义",
};

const DEFAULT_SETTINGS = {
  enabled: true,
  schemeId: SCNCore.DEFAULT_SCHEME_ID,
  // 自定义 · 独立编号（1、2、3 平铺）
  customLevels: SCNCore.PRESETS.gongwen.levels.slice(),
  customIndent: 0,
  // 自定义 · 多级标号（1.1、1.1.1）
  customMultiLevels: SCNCore.PRESETS.outline.levels.slice(),
  customMultiIndent: 2,
  customMultiSeparator: ".",
  customPathBase: 2,
  // 当前用哪一套
  customNumbering: "independent",
  continueOnEnter: true,
  tabSwitch: true,
  backspaceDelete: true,
  autoRenumber: false,
  spaceAfterMarker: false,
  handleMarkdown: false,
};

const CUSTOM_LEVEL_HINT = "每行一级，可用占位符：{cn} 中文数字、{n} 阿拉伯数字、{c} 圈号、{p} 多级路径";

class SmartChineseNumberingPlugin extends Plugin {
  async onload() {
    await this.loadSettings();

    this.registerEditorExtension(
      Prec.highest(
        EditorView.domEventHandlers({
          keydown: (event, view) => this.handleKeydown(event, view),
        })
      )
    );

    this.addCommand({
      id: "renumber-current-block",
      name: "重排当前编号块",
      editorCallback: (editor) => this.renumberBlock(editor),
    });

    this.addCommand({
      id: "level-down",
      name: "编号降一级（相当于 Tab）",
      editorCallback: (editor) => this.shiftLevel(editor, 1),
    });

    this.addCommand({
      id: "level-up",
      name: "编号升一级（相当于 Shift-Tab）",
      editorCallback: (editor) => this.shiftLevel(editor, -1),
    });

    for (const [id, label] of [
      ["gongwen", "使用公文编号"],
      ["points", "使用微信 / IM 编号"],
      ["outline", "使用邮件编号（1、 + 1.1、）"],
      ["custom", "使用自定义编号"],
    ]) {
      this.addCommand({
        id: "use-scheme-" + id,
        name: label,
        callback: () => this.setScheme(id),
      });
    }

    this.addCommand({
      id: "toggle-smart-numbering",
      name: "开关智能编号",
      callback: async () => {
        this.settings.enabled = !this.settings.enabled;
        await this.saveSettings();
        new Notice(this.settings.enabled ? "中文智能编号：已开启" : "中文智能编号：已暂停");
      },
    });

    this.settingTab = new SmartChineseNumberingSettingTab(this.app, this);
    this.addSettingTab(this.settingTab);

    if (typeof this.addStatusBarItem === "function") {
      this.statusEl = this.addStatusBarItem();
      this.statusEl.addClass("scn-status");
      this.statusEl.addEventListener("click", (event) => this.openSchemeMenu(event));
      this.updateStatusBar();
    }
  }

  // ------------------------------------------------------------ 方案

  resolveScheme() {
    if (this.settings.schemeId !== "custom") {
      return SCNCore.PRESETS[this.settings.schemeId] || SCNCore.PRESETS[SCNCore.DEFAULT_SCHEME_ID];
    }
    const multi = this.settings.customNumbering === "hierarchical";
    return {
      id: "custom",
      name: "自定义",
      levels: multi ? this.settings.customMultiLevels : this.settings.customLevels,
      indent: multi ? this.settings.customMultiIndent : this.settings.customIndent,
      numbering: this.settings.customNumbering,
      separator: this.settings.customMultiSeparator || ".",
      pathBase: multi ? this.settings.customPathBase || 1 : 1,
    };
  }

  rebuildRuntime() {
    const scheme = this.resolveScheme();
    const validation = SCNCore.validateScheme(scheme);
    this.schemeError = validation.ok ? null : validation.errors[0];
    const effective = validation.ok ? scheme : SCNCore.PRESETS[SCNCore.DEFAULT_SCHEME_ID];
    this.effectiveScheme = effective;
    this.runtime = Object.assign({}, this.settings, { scheme: effective });
  }

  schemeName() {
    if (this.settings.schemeId === "custom") {
      return this.schemeError ? "自定义（模板有误）" : "自定义";
    }
    return SCHEME_SHORT_NAME[this.settings.schemeId] || "公文";
  }

  async setScheme(id) {
    this.settings.schemeId = id;
    await this.saveSettings();
    new Notice("编号方案：" + this.schemeName());
    if (this.settingTab) this.settingTab.refresh();
  }

  updateStatusBar() {
    if (!this.statusEl) return;
    this.statusEl.setText("编号：" + this.schemeName());
    this.statusEl.setAttr(
      "aria-label",
      "点击切换编号方案（公文 / 微信 / 邮件 / 自定义）"
    );
  }

  openSchemeMenu(event) {
    const menu = new Menu();
    const options = [
      ["gongwen", "公文：一、 （一） 1、 （1） ①"],
      ["points", "微信 / IM：一、 → 1、，每级缩进 2"],
      ["outline", "邮件：一、 → 1、 → 1.1、，每级缩进 2"],
      ["custom", "自定义模板"],
    ];
    for (const [id, title] of options) {
      menu.addItem((item) =>
        item
          .setTitle(title)
          .setChecked(this.settings.schemeId === id)
          .onClick(() => this.setScheme(id))
      );
    }
    menu.showAtMouseEvent(event);
  }

  // ------------------------------------------------------------ 按键

  handleKeydown(event, view) {
    if (!this.settings.enabled) return false;
    // 中文输入法组词期间绝不介入，否则会打断选词
    if (view.composing || event.isComposing || event.keyCode === 229) return false;
    if (event.altKey || event.ctrlKey || event.metaKey) return false;

    const isEnter = event.key === "Enter" && !event.shiftKey;
    const isTab = event.key === "Tab";
    const isBackspace = event.key === "Backspace";
    if (!isEnter && !isTab && !isBackspace) return false;

    const selection = view.state.selection;
    if (selection.ranges.length > 1) return false; // 多光标交给默认行为
    if (!selection.main.empty) return false; // 有选区交给默认行为

    const text = view.state.doc.toString();
    const pos = selection.main.head;
    let edit = null;

    if (isEnter && this.settings.continueOnEnter) {
      edit = SCNCore.handleEnter(text, pos, this.runtime);
    } else if (isTab && this.settings.tabSwitch) {
      edit = SCNCore.handleTab(text, pos, event.shiftKey ? -1 : 1, this.runtime);
    } else if (isBackspace && this.settings.backspaceDelete) {
      edit = SCNCore.handleBackspace(text, pos, this.runtime);
    }
    if (!edit) return false;

    event.preventDefault();
    view.dispatch({
      changes: { from: edit.from, to: edit.to, insert: edit.insert },
      selection: { anchor: edit.cursor },
      scrollIntoView: true,
    });

    if (isEnter || isTab) this.afterStructuralEdit(view);
    return true;
  }

  /** 多级方案必须重排整块，才能保证 1.1 / 1.2 连续；普通方案只在开启时重排 */
  afterStructuralEdit(view) {
    const hierarchical = this.runtime.scheme.numbering === "hierarchical";
    if (hierarchical || this.settings.autoRenumber) this.renumberAt(view);
  }

  renumberAt(view) {
    const text = view.state.doc.toString();
    const edit = SCNCore.renumber(text, view.state.selection.main.head, this.runtime);
    if (!edit) return;
    // 不指定 selection，让 CodeMirror 自己映射光标
    view.dispatch({ changes: { from: edit.from, to: edit.to, insert: edit.insert } });
  }

  // ------------------------------------------------------------ 命令

  shiftLevel(editor, dir) {
    const text = editor.getValue();
    const pos = editor.posToOffset(editor.getCursor());
    const edit = SCNCore.handleTab(text, pos, dir, this.runtime);
    if (!edit) return;
    this.applyEditorEdit(editor, edit);
    if (this.runtime.scheme.numbering === "hierarchical") {
      const nextText = editor.getValue();
      const nextPos = editor.posToOffset(editor.getCursor());
      const renumbered = SCNCore.renumber(nextText, nextPos, this.runtime);
      if (renumbered) this.applyEditorEdit(editor, renumbered);
    }
  }

  renumberBlock(editor) {
    const text = editor.getValue();
    const pos = editor.posToOffset(editor.getCursor());
    const edit = SCNCore.renumber(text, pos, this.runtime);
    if (!edit) {
      new Notice("光标不在自动编号的行上");
      return;
    }
    this.applyEditorEdit(editor, edit);
  }

  applyEditorEdit(editor, edit) {
    if (!edit) return;
    editor.replaceRange(edit.insert, editor.offsetToPos(edit.from), editor.offsetToPos(edit.to));
    editor.setCursor(editor.offsetToPos(edit.cursor));
  }

  // ------------------------------------------------------------ 设置

  async loadSettings() {
    const data = (await this.loadData()) || {};
    const settings = Object.assign({}, DEFAULT_SETTINGS, data);
    if (data.indentOnTab === true && !data.schemeId) {
      settings.schemeId = "custom";
      settings.customLevels = SCNCore.PRESETS.gongwen.levels.slice();
      settings.customIndent = typeof data.indentWidth === "number" ? data.indentWidth : 2;
      settings.customNumbering = "independent";
    }
    // 旧版只有一个 customSeparator，迁移到多级标号的分隔符
    if (data.customSeparator && !data.customMultiSeparator) {
      settings.customMultiSeparator = data.customSeparator;
    }
    if (!Array.isArray(settings.customMultiLevels) || !settings.customMultiLevels.length) {
      settings.customMultiLevels = SCNCore.PRESETS.outline.levels.slice();
    }
    if (!Array.isArray(settings.customLevels) || !settings.customLevels.length) {
      settings.customLevels = SCNCore.PRESETS.gongwen.levels.slice();
    }
    const base = Number(settings.customPathBase);
    settings.customPathBase = base === 2 || base === 3 ? base : 1;
    delete settings.indentOnTab;
    delete settings.indentWidth;
    delete settings.customSeparator;
    this.settings = settings;
    this.rebuildRuntime();
  }

  async saveSettings() {
    this.rebuildRuntime();
    await this.saveData(this.settings);
    this.updateStatusBar();
  }
}

class SmartChineseNumberingSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
    this.saveTimer = null;
    this.dynamic = [];
  }

  refresh() {
    if (this.containerEl && this.containerEl.isShown && this.containerEl.isShown()) {
      this.display();
    }
  }

  /** 自定义方案里指定的一套（independent / hierarchical） */
  customSchemeOf(kind) {
    const settings = this.plugin.settings;
    const multi = kind === "hierarchical";
    return {
      id: "custom",
      name: "自定义",
      levels: multi ? settings.customMultiLevels : settings.customLevels,
      indent: multi ? settings.customMultiIndent : settings.customIndent,
      numbering: kind,
      separator: settings.customMultiSeparator || ".",
      pathBase: multi ? settings.customPathBase || 1 : 1,
    };
  }

  scheduleSave() {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(async () => {
      this.saveTimer = null;
      await this.plugin.saveSettings();
      this.refreshDynamic();
    }, 400);
  }

  /** 登记一块“随配置变化”的区域，输入时只刷新它，避免整页重绘抢光标 */
  track(exampleEl, getScheme, validationEl) {
    this.dynamic.push({ exampleEl, getScheme, validationEl });
  }

  refreshDynamic() {
    for (const item of this.dynamic) {
      let scheme = null;
      try {
        scheme = item.getScheme();
      } catch (error) {
        scheme = null;
      }
      if (scheme) {
        this.renderValidation(item.validationEl, scheme);
        this.renderExample(item.exampleEl, scheme);
      }
    }
  }

  renderValidation(el, scheme) {
    if (!el) return;
    const validation = SCNCore.validateScheme(scheme);
    if (validation.ok) {
      el.setText(
        "✔ 模板可用" + (validation.warnings.length ? "（" + validation.warnings.join("；") + "）" : "")
      );
      el.removeClass("mod-error");
    } else {
      el.setText("✖ " + validation.errors[0]);
      el.addClass("mod-error");
    }
  }

  renderExample(el, scheme) {
    if (!el) return;
    el.empty();
    let lines;
    try {
      lines = SCNCore.schemeExample(scheme);
    } catch (error) {
      const bad = el.createDiv({ cls: "scn-example-body mod-error" });
      bad.createDiv({ text: "模板有误：" + error.message });
      return;
    }
    el.createDiv({ text: "配置后长这样", cls: "scn-example-title" });
    const body = el.createDiv({ cls: "scn-example-body" });
    for (const line of lines) body.createDiv({ text: line });
  }

  display() {
    const { containerEl } = this;
    const settings = this.plugin.settings;
    containerEl.empty();
    this.dynamic = [];

    containerEl.createEl("h2", { text: "中文智能编号" });
    containerEl.createEl("p", {
      text: "公文、邮件、微信 / IM 都能用的中文序号：回车续号，Tab 换级，退格清除。",
      cls: "setting-item-description",
    });

    new Setting(containerEl)
      .setName("编号方案")
      .setDesc("公文＝一、（一）1、；微信 / IM＝一、→ 1、；邮件＝一、→ 1、→ 1.1、。")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("gongwen", "公文：一、 （一） 1、 （1） ①")
          .addOption("points", "微信 / IM：一、 → 1、")
          .addOption("outline", "邮件：一、 → 1、 → 1.1、")
          .addOption("custom", "自定义")
          .setValue(settings.schemeId)
          .onChange(async (value) => {
            settings.schemeId = value;
            await this.plugin.saveSettings();
            this.display();
          })
      );

    const activeExample = containerEl.createDiv({ cls: "scn-example" });
    this.renderExample(activeExample, this.plugin.effectiveScheme);
    this.track(activeExample, () => this.plugin.effectiveScheme, null);

    new Setting(containerEl)
      .setName("启用插件")
      .setDesc("关闭后所有按键交回 Obsidian，不改动任何文本。")
      .addToggle((toggle) =>
        toggle.setValue(settings.enabled).onChange(async (value) => {
          settings.enabled = value;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("回车自动续号")
      .setDesc("在编号行按回车，下一行自动写成同款编号并 +1；空的编号行回车则退出编号。")
      .addToggle((toggle) =>
        toggle.setValue(settings.continueOnEnter).onChange(async (value) => {
          settings.continueOnEnter = value;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("Tab / Shift-Tab 切换层级")
      .setDesc("Tab 下沉一级，Shift-Tab 上浮一级；邮件 / IM 方案会同时缩进。")
      .addToggle((toggle) =>
        toggle.setValue(settings.tabSwitch).onChange(async (value) => {
          settings.tabSwitch = value;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("退格清除编号")
      .setDesc("光标紧跟在编号后面时，按退格删除整段编号，正文保留。")
      .addToggle((toggle) =>
        toggle.setValue(settings.backspaceDelete).onChange(async (value) => {
          settings.backspaceDelete = value;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("回车后重排后续编号")
      .setDesc("普通方案下在中间插入条目后，把同一块内的序号自动改成连续；多级方案总是会重排。")
      .addToggle((toggle) =>
        toggle.setValue(settings.autoRenumber).onChange(async (value) => {
          settings.autoRenumber = value;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("编号后加一个空格")
      .setDesc("默认写成「1、正文」；开启后写成「1、 正文」。")
      .addToggle((toggle) =>
        toggle.setValue(settings.spaceAfterMarker).onChange(async (value) => {
          settings.spaceAfterMarker = value;
          await this.plugin.saveSettings();
        })
      );

    if (settings.schemeId === "custom") {
      this.renderCustomSection(containerEl);
    } else {
      containerEl.createEl("h3", { text: "自定义方案" });
      containerEl.createEl("p", {
        text: "开启后可以分别设置「独立编号」和「多级标号」两套写法，并实时预览配置结果。",
        cls: "setting-item-description",
      });
      new Setting(containerEl)
        .setName("启用自定义方案")
        .setDesc("自定义模板只在选择「自定义」方案时生效。")
        .addButton((button) =>
          button.setButtonText("开启自定义").onClick(async () => {
            settings.schemeId = "custom";
            await this.plugin.saveSettings();
            this.display();
          })
        );
    }

    containerEl.createEl("h4", { text: "使用提示" });
    const tips = containerEl.createEl("ul");
    tips.createEl("li", { text: "输入「1、」后写正文，回车即得「2、」；再回车得「3、」。" });
    tips.createEl("li", { text: "微信方案只有两级：一、 →（Tab）1、，每级缩进 2 格。" });
    tips.createEl("li", { text: "邮件方案三级：一、 →（Tab）1、 →（Tab）1.1、；回车 / Tab 后整块自动重排。" });
    tips.createEl("li", { text: "空的编号行回车退出编号；光标在编号后按退格可整段删掉编号。" });
    tips.createEl("li", { text: "状态栏「编号：公文」点一下可直接切换方案。" });
    tips.createEl("li", { text: "中文输入法组词时插件不介入，回车选词不受影响。" });
  }

  renderCustomSection(containerEl) {
    const settings = this.plugin.settings;
    containerEl.createEl("h3", { text: "自定义方案" });
    containerEl.createEl("p", {
      text: "两套写法各自独立配置，「当前使用」决定哪一套生效；下面会实时显示配置后的样子。",
      cls: "setting-item-description",
    });

    new Setting(containerEl)
      .setName("当前使用")
      .setDesc("独立编号＝平铺递进（1、2、3）；多级标号＝带层级路径（1.1、1.1.1）。")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("independent", "独立编号")
          .addOption("hierarchical", "多级标号")
          .setValue(settings.customNumbering)
          .onChange(async (value) => {
            settings.customNumbering = value;
            await this.plugin.saveSettings();
            this.display();
          })
      );

    this.renderCustomGroup(containerEl, "independent");
    this.renderCustomGroup(containerEl, "hierarchical");
  }

  renderCustomGroup(containerEl, kind) {
    const settings = this.plugin.settings;
    const multi = kind === "hierarchical";
    const active = settings.customNumbering === kind;
    const group = containerEl.createDiv({ cls: "scn-group" });

    group.createEl("h4", {
      text: (multi ? "多级标号" : "独立编号") + (active ? "（当前生效）" : "（未生效）"),
    });
    group.createEl("p", { text: CUSTOM_LEVEL_HINT, cls: "setting-item-description" });

    new Setting(group)
      .setName(multi ? "多级层级模板" : "独立层级模板")
      .setDesc(
        multi
          ? "示例：{cn}、 / {n}、 / {p}、；{p} 是路径，段数由「路径从第几级开始」决定。"
          : "示例：{cn}、 / （{cn}） / {n}、 / （{n}） / {c}；每行一级。"
      )
      .addTextArea((area) => {
        area
          .setValue((multi ? settings.customMultiLevels : settings.customLevels).join("\n"))
          .onChange((value) => {
            const levels = value
              .split("\n")
              .map((line) => line.trim())
              .filter((line) => line.length > 0);
            if (multi) settings.customMultiLevels = levels;
            else settings.customLevels = levels;
            this.scheduleSave();
          });
        area.inputEl.rows = 6;
        area.inputEl.addClass("scn-templates");
      });

    const validationEl = group.createDiv({ cls: "scn-validation" });
    const exampleEl = group.createDiv({ cls: "scn-example" });
    const getScheme = () => this.customSchemeOf(kind);
    this.renderValidation(validationEl, getScheme());
    this.renderExample(exampleEl, getScheme());
    this.track(exampleEl, getScheme, validationEl);

    new Setting(group)
      .setName("每级缩进（空格）")
      .setDesc("每下沉一级增加的缩进；公文式一般 0，消息 / 邮件式常用 2。")
      .addSlider((slider) =>
        slider
          .setLimits(0, 8, 1)
          .setValue(multi ? settings.customMultiIndent : settings.customIndent)
          .setDynamicTooltip()
          .onChange(async (value) => {
            if (multi) settings.customMultiIndent = value;
            else settings.customIndent = value;
            await this.plugin.saveSettings();
            this.refreshDynamic();
          })
      );

    if (multi) {
      new Setting(group)
        .setName("路径从第几级开始")
        .setDesc("第 1 级：第 2 级就写成 1.1、；第 2 级：第 2 级是 1、，第 3 级才是 1.1、。")
        .addDropdown((dropdown) =>
          dropdown
            .addOption("1", "第 1 级（1.1、 1.1.1、）")
            .addOption("2", "第 2 级（1、→ 1.1、）")
            .addOption("3", "第 3 级")
            .setValue(String(settings.customPathBase || 1))
            .onChange(async (value) => {
              settings.customPathBase = Number(value) || 1;
              await this.plugin.saveSettings();
              this.display();
            })
        );

      new Setting(group)
        .setName("多级分隔符")
        .setDesc("默认「.」，可改成「-」等。")
        .addText((text) =>
          text.setValue(settings.customMultiSeparator || ".").onChange((value) => {
            settings.customMultiSeparator = value.trim() || ".";
            this.scheduleSave();
          })
        );
    }

    new Setting(group)
      .setName("快捷操作")
      .addButton((button) =>
        button
          .setButtonText(multi ? "恢复邮件式模板" : "恢复公文式模板")
          .onClick(async () => {
            if (multi) {
              settings.customMultiLevels = SCNCore.PRESETS.outline.levels.slice();
              settings.customMultiIndent = SCNCore.PRESETS.outline.indent;
              settings.customMultiSeparator = SCNCore.PRESETS.outline.separator;
              settings.customPathBase = SCNCore.PRESETS.outline.pathBase;
            } else {
              settings.customLevels = SCNCore.PRESETS.gongwen.levels.slice();
              settings.customIndent = SCNCore.PRESETS.gongwen.indent;
            }
            await this.plugin.saveSettings();
            this.display();
          })
      )
      .addButton((button) =>
        button
          .setButtonText("用这一套")
          .setDisabled(active)
          .onClick(async () => {
            settings.customNumbering = kind;
            await this.plugin.saveSettings();
            this.display();
          })
      );
  }
}

module.exports = SmartChineseNumberingPlugin;
