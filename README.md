# 中文智能编号 · Smart Chinese Numbering

**Smart Chinese Numbering** is an Obsidian plugin that lets you write Chinese-style numbered outlines — `一、` `1、` `1.1、` — and stops Markdown from rewriting them into `1.`. It ships four presets (Gongwen / WeChat / Mail / Custom), switches from the status bar, continues the sequence when you press Enter, and changes level with Tab. No network access, no telemetry, and zero runtime dependencies.

> 给 Obsidian 写中文序号的插件：回车自动续号、Tab 换级，再也不会被 Markdown 改写成 `1.`。公文 / 微信 / 邮件 / 自定义四套方案，状态栏一键切换。

![交互演示](demo/screenshot.png)

## 快速开始 / Quick Start

**Install from the official community store (recommended)**
1. In Obsidian open `Settings → Community plugins` and turn off Restricted Mode.
2. Click `Browse` to open the community store, then search for **`中文智能编号`** (or `Smart Chinese Numbering`).
3. Install and enable.

**Manual install**
```bash
VAULT="/path/to/your/vault"
mkdir -p "$VAULT/.obsidian/plugins/chinese-smart-numbering"
cp main.js manifest.json styles.css "$VAULT/.obsidian/plugins/chinese-smart-numbering/"
```
Then reload and enable it under `Settings → Community plugins`.

## 四套方案 / Four presets

| Preset | Looks like | For |
| --- | --- | --- |
| **Gongwen** | `一、` `（一）` `1、` `（1）` `①` | notices, reports, memos |
| **WeChat / IM** | `一、` → `  1、` | long chat replies, instant messages |
| **Mail** | `一、` → `  1、` → `    1.1、` | email, weekly reports, proposals |
| **Custom** | two independent templates | `第X条`, numeric outlines, etc. |

Each level indents 2 spaces by default; click the status-bar item `编号：公文` to switch presets.

## 怎么用 / How to use

| Key | Effect |
| --- | --- |
| `Enter` (end of a numbered line) | writes the next number +1; Mail preset renumbers the whole block |
| `Enter` (empty numbered line) | exits numbering |
| `Tab` / `Shift+Tab` | change level; auto-indent per preset |
| `Backspace` (right after the number) | deletes the number, keeps the text and indent |

Chinese IME composition is never intercepted, so picking words with Enter works as usual.

## 自定义模板 / Custom templates

Picking `Custom` in settings gives you **two independent configurations** (flat numbering / hierarchical), with `Currently using` choosing which one is active and a live preview below.

![自定义方案示意](demo/screenshot-custom.png)

Placeholders: `{cn}` Chinese numerals, `{n}` Arabic numerals, `{c}` circled numbers, `{p}` hierarchical path (e.g. `1.1、`).

## 命令与设置 / Commands & settings

- **Commands**: renumber current block, promote / demote level, switch the four presets, toggle smart numbering.
- **Core settings**: continue on Enter, Tab changes level, Backspace clears number, add a space after number, take over Markdown `1. ` lists.

## 常见问题 / FAQ

**Why is the directory name in English?**
Obsidian's community directory requires `manifest.json`'s `name` to use Basic Latin characters only, so the directory shows **Smart Chinese Numbering**; the Chinese name stays in the settings page and this document.

**Does it conflict with Smart List Input?**
Yes. That plugin rewrites `1、` into `1.` after a space; disable it to keep Chinese numbering.

## 已知边界 / Known limits

- Plain-text numbering, no Markdown lists; exports to Word / PDF keep the Chinese numbers.
- Hierarchical numbers must end with `、` (the plugin writes it); hand-written `1.1 text` (space, no pause) is not recognized.
- WeChat preset has only two levels; past the max level, Tab falls back to Obsidian's default.
- Desktop only, tested.

## English

**Smart Chinese Numbering** lets you write Chinese-style numbered outlines (`一、` `1、` `1.1、`) in Obsidian without Markdown turning them into `1.`. Four presets (Gongwen / WeChat / Mail / Custom), switchable from the status bar; Enter continues the sequence, Tab changes level. Install from **Settings → Community plugins → Browse** and search "中文智能编号". Desktop tested; no network, no telemetry.

## 许可证 / License

MIT
