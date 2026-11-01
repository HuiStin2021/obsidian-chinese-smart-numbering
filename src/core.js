/*!
 * 中文智能编号 (Smart Chinese Numbering) · 核心逻辑
 *
 * 只做纯文本的“识别 / 续号 / 换级 / 重排”，不依赖 Obsidian、CodeMirror，
 * 因此可以在 Node（单测）、浏览器（demo）和 Obsidian 插件里共用同一份代码。
 *
 * 方案（scheme）由若干“层级模板”组成，占位符：
 *   {cn} 中文数字    {n} 阿拉伯数字    {c} 圈号    {p} 多级路径（1.1 / 1.1.1）
 *
 * 内置方案：
 *   公文        一、 （一） 1、 （1） ①        不缩进
 *   微信 / IM   一、 1、                      每级缩进 2 空格
 *   邮件        一、 1、 1.1、                每级缩进 2 空格（路径从第 2 级起算）
 *
 * pathBase 表示“多级路径从第几级开始算第一段”：
 *   pathBase = 1 → 第 2 级写成 1.1、（路径含一级序号）
 *   pathBase = 2 → 第 2 级仍是 1、，第 3 级才是 1.1、（路径从二级起算）
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.SCNCore = factory();
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  // @core-begin
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
  // @core-end
});
