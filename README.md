# 中文智能编号 · Smart Chinese Numbering

**Smart Chinese Numbering** is an Obsidian plugin that lets you write Chinese-style numbered outlines — `一、` `1、` `1.1、` — and stops Markdown from rewriting them into `1.`. It ships four presets (Gongwen / WeChat / Mail / Custom), switches from the status bar, continues the sequence when you press Enter, and changes level with Tab. No network access, no telemetry, zero runtime dependencies.

> 给 Obsidian 写中文序号的插件：回车自动续号、Tab 换级，再也不会被 Markdown 改写成 `1.`。公文 / 微信 / 邮件 / 自定义四套方案，状态栏一键切换。

![交互演示](demo/screenshot.png)

---

## 📖 中文说明（中文用户看这里）

### 这是什么
一个专门为中文写作习惯做的 Obsidian 插件。你只管按平时的方式写 `一、` `1、` `1.1、`，**回车就自动续号、Tab 就自动换级**，序号永远是中文写法，不会被 Markdown 偷偷改成 `1. 2. 3.`。

四个开箱即用的方案，点状态栏的「编号：公文」随时切换：

| 方案 | 写出来长这样 | 适合场景 |
| --- | --- | --- |
| **公文** | `一、` `（一）` `1、` `（1）` `①`（不缩进） | 通知、报告、请示、纪要、简报 |
| **微信 / IM** | `一、` → `  1、`（每级 2 空格） | 微信长回复、即时消息 |
| **邮件** | `一、` → `  1、` → `    1.1、`（每级 2 空格） | 邮件、周报、方案、项目同步 |
| **自定义** | 独立编号 / 多级标号两套模板，边配边看示例 | `第X条`、纯数字大纲等 |

### 快速开始

**方式一 · 官方插件市场（推荐）**
1. Obsidian → `设置` → `第三方插件`，先关掉「安全模式（Restricted Mode）」；
2. 点 `浏览` 打开社区插件市场，搜索 **`中文智能编号`**（或 `Smart Chinese Numbering`）；
3. 点安装，再启用即可。

**方式二 · 手动安装**
```bash
VAULT="/path/to/your/vault"
mkdir -p "$VAULT/.obsidian/plugins/chinese-smart-numbering"
cp main.js manifest.json styles.css "$VAULT/.obsidian/plugins/chinese-smart-numbering/"
```
然后在 `设置 → 第三方插件` 里重载并启用。

### 怎么用（键位）

| 操作 | 效果 |
| --- | --- |
| `Enter`（编号行末尾） | 下一行自动写同款编号 +1；邮件方案会顺便把整块重新排号 |
| `Enter`（空编号行） | 删掉编号、退出编号（和原生列表一致） |
| `Tab` / `Shift+Tab` | 换级 / 升一级；微信、邮件方案按设置自动缩进或取消缩进 |
| `Backspace`（光标紧跟编号） | 删除整段编号（含编号后空格），正文和缩进都保留 |

小贴士：中文输入法正在组词时，插件完全不介入，回车选词不受影响。

### 多级编号为什么要带「、」
邮件方案里你会看到这样的层级：
```
一、背景
  1、现状
    1.1、试点门店
    1.2、数据口径
  2、问题
二、方案
```
- 末尾的「、」让中文读者一眼分清「这是编号」还是「这是正文」；
- 也顺便防止误判：单独一行 `1.5 亿元` 不会被当成编号（因为它没带「、」）；
- 「路径从第几级开始」可以配：设成 2，就是上面这种 `1、 → 1.1、`；设成 1，则是 `1.1、 → 1.1.1、`。

### 自定义模板
设置里选「自定义」后，会得到**两套互相独立的配置**：
- **独立编号**：每行一个层级模板（如 `第{n}条`）；
- **多级标号**：层级模板 + 「路径从第几级开始」+ 多级分隔符（如 `1.1、`）。

用「当前使用」决定哪一套生效，下方实时显示配置后的样子，边配边看。

占位符速查：

| 占位符 | 含义 | 例子 |
| --- | --- | --- |
| `{cn}` | 中文数字（一…九百九十九） | `{cn}、` → `一、` |
| `{n}` | 阿拉伯数字（1…999） | `{n}）` → `1）` |
| `{c}` | 圈号（①…⑳） | `{c}` → `①` |
| `{p}` | 多级路径（仅多级标号） | `{p}、` → `1.1、` |

### 命令与设置
- **命令**（命令面板可搜）：重排当前编号块、编号降一级 / 升一级、使用公文 / 微信 / 邮件 / 自定义编号、开关智能编号。
- **核心设置**：回车自动续号、Tab 切换层级、退格清除编号、编号后加一个空格、是否接管 Markdown 的 `1. ` 列表。

### 常见问题
**Q：为什么目录里显示的是英文名「Smart Chinese Numbering」？**
A：Obsidian 社区目录硬性规定 `manifest.json` 的 `name` 只能用英文字母（Basic Latin），所以目录只能显示英文；中文名「中文智能编号」保留在设置页标题、命令提示和本文档里——这是同类中文插件的通用做法。

**Q：和 Smart List Input 会冲突吗？**
A：会。那个插件会在 `1、` 后面敲空格时把编号改写成 `1.`。想要保留中文序号，请把 Smart List Input 停用。

### 已知边界
- 生成的是纯文本编号，**不会**变成 Markdown 有序列表；导出 Word / PDF 后依旧是文本序号。
- 多级编号后必须带「、」（插件会自动补写）；手写 `1.1 内容`（空格、无顿号）不会被识别。
- 微信方案只有两级；到方案最大层级后再按 Tab 就不再换级，交回 Obsidian 默认行为。
- 仅桌面端实测；移动端沿用同一套按键逻辑，状态栏不可见时用命令切换。

---

<details>
<summary>🌐 English（点击展开）</summary>

## English

**Smart Chinese Numbering** lets you write Chinese-style numbered outlines (`一、` `1、` `1.1、`) in Obsidian without Markdown turning them into `1.`. Four presets, switchable from the status bar; Enter continues the sequence, Tab changes level. No network, no telemetry.

**Install from the official community store (recommended)**
1. In Obsidian open `Settings → Community plugins` and turn off Restricted Mode.
2. Click `Browse`, search for **`中文智能编号`** (or `Smart Chinese Numbering`), then install and enable.

**Manual install**
```bash
VAULT="/path/to/your/vault"
mkdir -p "$VAULT/.obsidian/plugins/chinese-smart-numbering"
cp main.js manifest.json styles.css "$VAULT/.obsidian/plugins/chinese-smart-numbering/"
```

**Four presets**

| Preset | Looks like | For |
| --- | --- | --- |
| Gongwen | `一、` `（一）` `1、` `（1）` `①` | notices, reports, memos |
| WeChat / IM | `一、` → `  1、` | long chat replies |
| Mail | `一、` → `  1、` → `    1.1、` | email, weekly reports |
| Custom | two independent templates | `第X条`, numeric outlines |

**Keys**: `Enter` continues; `Enter` on an empty numbered line exits; `Tab` / `Shift+Tab` change level; `Backspace` right after the number deletes it. IME composition is never intercepted.

**Custom templates**: two independent sets (flat / hierarchical) with a live preview; placeholders `{cn}` `{n}` `{c}` `{p}`.

**FAQ**: The directory shows the English name because Obsidian requires Basic Latin in `manifest.json`. Disable *Smart List Input* if installed, as it rewrites `1、` into `1.`.

**Known limits**: plain-text numbering (no Markdown lists); hierarchical numbers must end with `、`; WeChat preset has only two levels; desktop only.

</details>

## 许可证 / License

MIT
