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
  /*__CORE__*/
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
    if (this.saveTimer) window.clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(async () => {
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
