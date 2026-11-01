const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const Module = require("node:module");

const notices = [];

class FakeEl {
  constructor() {
    this.text = "";
    this.classes = [];
    this.attrs = {};
    this.handlers = {};
    this.children = [];
  }
  setText(value) {
    this.text = value;
  }
  addClass(value) {
    this.classes.push(value);
  }
  removeClass(value) {
    this.classes = this.classes.filter((item) => item !== value);
  }
  setAttr(key, value) {
    this.attrs[key] = value;
  }
  addEventListener(name, handler) {
    this.handlers[name] = handler;
  }
  empty() {
    this.children = [];
  }
  createDiv(options) {
    const el = new FakeEl();
    if (options && options.text) el.text = options.text;
    this.children.push(el);
    return el;
  }
}

const stubObsidian = {
  Plugin: class {
    constructor(app) {
      this.app = app || {};
      this._data = null;
      this._commands = [];
    }
    async loadData() {
      return this._data;
    }
    async saveData(data) {
      this._data = JSON.parse(JSON.stringify(data));
    }
    registerEditorExtension(extension) {
      this.extension = extension;
    }
    addCommand(command) {
      this._commands.push(command);
    }
    addSettingTab(tab) {
      this.settingTab = tab;
    }
    addStatusBarItem() {
      return new FakeEl();
    }
  },
  PluginSettingTab: class {
    constructor(app, plugin) {
      this.app = app;
      this.plugin = plugin;
      this.containerEl = new FakeEl();
    }
  },
  Setting: class {
    setName() {
      return this;
    }
    setDesc() {
      return this;
    }
    addToggle() {
      return this;
    }
    addDropdown() {
      return this;
    }
    addSlider() {
      return this;
    }
    addText() {
      return this;
    }
    addTextArea() {
      return this;
    }
    addButton() {
      return this;
    }
  },
  Notice: class {
    constructor(message) {
      notices.push(message);
    }
  },
  Menu: class {
    constructor() {
      this.items = [];
    }
    addItem(factory) {
      const item = {
        setTitle: () => item,
        setChecked: () => item,
        onClick: (callback) => {
          item.callback = callback;
          return item;
        },
      };
      factory(item);
      this.items.push(item);
      return this;
    }
    showAtMouseEvent() {}
  },
};

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "obsidian") return stubObsidian;
  if (request === "@codemirror/view") {
    return { EditorView: { domEventHandlers: (handlers) => handlers } };
  }
  if (request === "@codemirror/state") {
    return { Prec: { highest: (extension) => extension } };
  }
  return originalLoad.call(this, request, parent, isMain);
};
const PluginClass = require(path.join(__dirname, "..", "main.js"));
Module._load = originalLoad;

const core = require("../src/core.js");

function makeView(text, pos, overrides) {
  let value = text;
  const selection = {
    ranges: [{}],
    main: { empty: true, head: pos, from: pos, to: pos },
  };
  const view = {
    composing: false,
    state: { doc: { toString: () => value }, selection },
    dispatch(spec) {
      value = value.slice(0, spec.changes.from) + spec.changes.insert + value.slice(spec.changes.to);
      if (spec.selection && typeof spec.selection.anchor === "number") {
        selection.main.head = spec.selection.anchor;
        selection.main.from = spec.selection.anchor;
        selection.main.to = spec.selection.anchor;
      }
    },
  };
  Object.assign(view, overrides || {});
  Object.defineProperty(view, "text", { get: () => value });
  return view;
}

async function makePlugin(data) {
  const plugin = new PluginClass({});
  plugin._data = Object.assign({}, data || {});
  await plugin.loadSettings();
  return plugin;
}

function key(k, extra) {
  let prevented = false;
  return {
    key: k,
    preventDefault() {
      prevented = true;
    },
    get prevented() {
      return prevented;
    },
    ...extra,
  };
}

test("插件入口：main.js 导出插件类，onload 注册扩展与命令", async () => {
  assert.equal(typeof PluginClass, "function");
  const plugin = new PluginClass({});
  await plugin.onload();
  assert.ok(plugin.extension, "应注册编辑器扩展");
  assert.equal(plugin.runtime.scheme.id, "gongwen");
  assert.equal(plugin.statusEl.text, "编号：公文");
  assert.ok(plugin._commands.length >= 8);
});

test("键盘：公文回车续号并移动光标", async () => {
  const plugin = await makePlugin();
  const view = makeView("1、A", 3);
  const event = key("Enter");
  assert.equal(plugin.handleKeydown(event, view), true);
  assert.equal(view.text, "1、A\n2、");
  assert.equal(view.state.selection.main.head, 6);
  assert.equal(event.prevented, true);
});

test("键盘：普通行回车不拦截", async () => {
  const plugin = await makePlugin();
  const view = makeView("普通段落", 4);
  const event = key("Enter");
  assert.equal(plugin.handleKeydown(event, view), false);
  assert.equal(view.text, "普通段落");
  assert.equal(event.prevented, false);
});

test("键盘：分点方案 Tab 缩进、回车保持缩进", async () => {
  const plugin = await makePlugin({ schemeId: "points" });
  const view = makeView("一、A", 3);
  assert.equal(plugin.handleKeydown(key("Tab"), view), true);
  assert.equal(view.text, "  1、A");

  const view2 = makeView("  1、A", 5);
  assert.equal(plugin.handleKeydown(key("Enter"), view2), true);
  assert.equal(view2.text, "  1、A\n  2、");
});

test("键盘：多级方案回车后自动重排整块", async () => {
  const plugin = await makePlugin({ schemeId: "outline" });
  const text = "一、背景\n  1.1、现状";
  const view = makeView(text, 4); // 在第一行末尾回车
  assert.equal(plugin.handleKeydown(key("Enter"), view), true);
  assert.equal(view.text, "一、背景\n二、\n  2.1、现状");
});

test("键盘：多级方案 Tab 后自动重排同级编号", async () => {
  const plugin = await makePlugin({ schemeId: "outline" });
  const text = "一、背景\n  1.1、现状";
  const view = makeView(text, 4); // 在第一行 Tab
  assert.equal(plugin.handleKeydown(key("Tab"), view), true);
  assert.equal(view.text, "  1.1、背景\n  1.2、现状");
});

test("键盘：多级方案退格清除编号", async () => {
  const plugin = await makePlugin({ schemeId: "outline" });
  const text = "  1.1、现状";
  const view = makeView(text, 6);
  assert.equal(plugin.handleKeydown(key("Backspace"), view), true);
  assert.equal(view.text, "  现状"); // 保留缩进，只删编号
});

test("键盘：普通方案开启自动重排后重排", async () => {
  const plugin = await makePlugin({ autoRenumber: true });
  const view = makeView("1、A\n1、B", 3);
  assert.equal(plugin.handleKeydown(key("Enter"), view), true);
  assert.equal(view.text, "1、A\n2、\n3、B");
});

test("键盘：停用、输入法、多光标、选区、修饰键都不介入", async () => {
  const disabled = await makePlugin({ enabled: false });
  assert.equal(disabled.handleKeydown(key("Enter"), makeView("1、A", 3)), false);

  const plugin = await makePlugin();
  const composing = makeView("1、A", 3, { composing: true });
  assert.equal(plugin.handleKeydown(key("Enter"), composing), false);
  assert.equal(plugin.handleKeydown(key("Enter", { isComposing: true }), makeView("1、A", 3)), false);

  const multi = makeView("1、A", 3);
  multi.state.selection.ranges.push({});
  assert.equal(plugin.handleKeydown(key("Enter"), multi), false);

  const selected = makeView("1、A", 3);
  selected.state.selection.main.empty = false;
  assert.equal(plugin.handleKeydown(key("Enter"), selected), false);

  for (const extra of [{ metaKey: true }, { ctrlKey: true }, { altKey: true }]) {
    assert.equal(plugin.handleKeydown(key("Enter", extra), makeView("1、A", 3)), false);
  }
});

test("键盘：命令式换级在多级方案下也会重排", async () => {
  const plugin = await makePlugin({ schemeId: "outline" });
  const editor = {
    value: "一、背景\n  1.1、现状",
    cursor: 0,
    getValue() {
      return this.value;
    },
    getCursor() {
      return { line: 0, ch: 0 };
    },
    posToOffset() {
      return this.cursor;
    },
    offsetToPos(offset) {
      return { line: 0, ch: offset };
    },
    replaceRange(insert, from, to) {
      this.value = this.value.slice(0, from.ch) + insert + this.value.slice(to.ch);
    },
    setCursor(pos) {
      this.cursor = pos.ch;
    },
  };
  plugin.shiftLevel(editor, 1);
  assert.equal(editor.value, "  1.1、背景\n  1.2、现状");
});

test("命令：重排当前编号块", async () => {
  const plugin = await makePlugin();
  const editor = {
    value: "1、A\n1、B\n1、C",
    cursor: 0,
    getValue() {
      return this.value;
    },
    getCursor() {
      return { line: 0, ch: 0 };
    },
    posToOffset() {
      return this.cursor;
    },
    offsetToPos(offset) {
      return { line: 0, ch: offset };
    },
    replaceRange(insert, from, to) {
      this.value = this.value.slice(0, from.ch) + insert + this.value.slice(to.ch);
    },
    setCursor(pos) {
      this.cursor = pos.ch;
    },
  };
  plugin.renumberBlock(editor);
  assert.equal(editor.value, "1、A\n2、B\n3、C");
});

test("命令：光标不在编号行时提示而不改文本", async () => {
  const plugin = await makePlugin();
  notices.length = 0;
  const editor = {
    value: "普通段落",
    getValue() {
      return this.value;
    },
    getCursor() {
      return { line: 0, ch: 0 };
    },
    posToOffset() {
      return 0;
    },
    offsetToPos(offset) {
      return { line: 0, ch: offset };
    },
    replaceRange() {
      throw new Error("不应改动文本");
    },
    setCursor() {},
  };
  plugin.renumberBlock(editor);
  assert.match(notices[0] || "", /编号/);
});

test("方案：切换后运行时、状态栏、通知同步", async () => {
  const plugin = new PluginClass({});
  await plugin.onload();
  notices.length = 0;
  await plugin.setScheme("outline");
  assert.equal(plugin.settings.schemeId, "outline");
  assert.equal(plugin.runtime.scheme.id, "outline");
  assert.equal(plugin.statusEl.text, "编号：多级");
  assert.match(notices.pop(), /多级/);

  await plugin.setScheme("custom");
  assert.equal(plugin.runtime.scheme.id, "custom");
  assert.match(plugin.statusEl.text, /自定义/);
});

test("设置：旧版 indentOnTab 迁移到自定义方案", async () => {
  const plugin = await makePlugin({ indentOnTab: true, indentWidth: 3 });
  assert.equal(plugin.settings.schemeId, "custom");
  assert.equal(plugin.settings.customIndent, 3);
  assert.equal(plugin.runtime.scheme.indent, 3);
  assert.equal("indentOnTab" in plugin.settings, false);
  assert.equal("indentWidth" in plugin.settings, false);
});

test("设置：非法自定义模板回退到公文并记录错误", async () => {
  const plugin = await makePlugin({
    schemeId: "custom",
    customLevels: ["没有占位符"],
  });
  assert.match(plugin.schemeError, /占位符/);
  assert.equal(plugin.runtime.scheme.id, "gongwen");
  assert.equal(plugin.statusEl ? plugin.statusEl.text : "", "");
});

test("设置：自定义模板生效（第{n}条）", async () => {
  const plugin = await makePlugin({
    schemeId: "custom",
    customLevels: ["第{n}条 "],
    customNumbering: "independent",
    customIndent: 0,
  });
  assert.equal(plugin.schemeError, null);
  const text = "第1条 总则";
  const view = makeView(text, text.length);
  assert.equal(plugin.handleKeydown(key("Enter"), view), true);
  assert.equal(view.text, "第1条 总则\n第2条 ");
});
