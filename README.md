# 中文智能编号 · Smart Chinese Numbering

![交互演示](demo/screenshot.png)

给 Obsidian 加一套**中文序号**的输入习惯：`1、` 回车就是 `2、`，`一、` 回车就是 `二、`；
Tab 逐级换号，微信 / 邮件方案还会按级缩进。序号始终是中文写法，不会被改写成 Markdown 的 `1.`。

四套方案，状态栏一点即切：

| 方案 | 长这样 | 适合 |
| --- | --- | --- |
| **公文** | `一、` `（一）` `1、` `（1）` `①`（不缩进） | 通知、报告、请示、纪要 |
| **微信 / IM** | `一、` → `  1、`（每级 2 空格） | 微信长回复、即时消息 |
| **邮件** | `一、` → `  1、` → `    1.1、`（每级 2 空格） | 邮件、周报、方案、项目同步 |
| **自定义** | 独立编号 / 多级标号两套模板，边配边看示例 | `第X条`、纯数字大纲等 |

## 为什么多级编号要加「、」

```
一、背景
  1、现状
    1.1、试点门店
    1.2、数据口径
  2、问题
    2.1、核销滞后
二、方案
  1、总体思路
    1.1、第一阶段
```

- 与 `1、` 的中文编号风格一致，中文读者一眼能分清「编号」和「正文」；
- 顺带解决误判：路径后必须有「、」，所以单独一行 `1.5 亿元` 不会被当成编号；
- 路径从第几级起算可以配：「路径从第 2 级开始」就是上面这种 `1、 → 1.1、`，「从第 1 级开始」则是 `1.1、 → 1.1.1、`。

## 键位

| 操作 | 效果 |
| --- | --- |
| `Enter`（编号行末尾） | 下一行自动写同款编号 +1；多级方案路径末段 +1，并自动重排整块 |
| `Enter`（空编号行） | 删掉编号、退出编号（和原生列表一致） |
| `Tab` / `Shift+Tab` | 换级；微信 / 邮件方案按方案设置自动缩进 / 取消缩进 |
| `Backspace`（光标紧跟编号） | 删除整段编号（含编号后的空格），正文与缩进保留 |
| 中文输入法组词中 | 完全不介入，回车选词不受影响 |

邮件方案下，回车 / Tab 后会重排整块，保证 `1.1`、`1.2`、`2.1` 连续（不必手动开自动重排）。

## 自定义模板

设置里选「自定义」后，会得到**两套互相独立**的配置，用「当前使用」决定哪一套生效，下面实时显示配置后的样子。

![自定义方案示意](demo/screenshot-custom.png)

设置 → 自定义方案

```
当前使用：独立编号 / 多级标号

独立编号
  层级模板（每行一级）
  每级缩进
  配置后长这样 ↓

多级标号
  层级模板（每行一级）
  每级缩进
  路径从第几级开始
  多级分隔符
  配置后长这样 ↓
```

占位符：

| 占位符 | 含义 | 例子 |
| --- | --- | --- |
| `{cn}` | 中文数字（一…九百九十九） | `{cn}、` → `一、` |
| `{n}` | 阿拉伯数字（1…999） | `{n}）` → `1）` |
| `{c}` | 圈号（①…⑳） | `{c}` → `①` |
| `{p}` | 多级路径（仅多级标号可用） | `{p}、` → `1.1、` |

- 字面量会做正则转义，用户不能写正则；
- 每级最多 40 字符、总层级 1–9；
- 校验失败会显示原因，并继续沿用上一套可用方案。

「路径从第几级开始」决定 `{p}` 有几段：填 1 时第 2 级就是 `1.1、`；填 2 时第 2 级仍是 `1、`，第 3 级才是 `1.1、`（邮件方案默认）。

## 命令

| 命令 | 用途 |
| --- | --- |
| 重排当前编号块 | 把光标所在的整块连续编号重排；多级方案按路径重算 |
| 编号降一级 / 编号升一级 | 等价于 Tab / Shift-Tab，供 Tab 被占用或移动端使用 |
| 使用公文 / 微信 / 邮件 / 自定义编号 | 切换方案 |
| 开关智能编号 | 临时停用，不改动任何文本 |

状态栏「编号：公文」点一下可以弹出四套方案直接选。

## 设置

| 设置项 | 默认 | 说明 |
| --- | --- | --- |
| 编号方案 | 公文 | 四套方案切换，下方实时预览配置后的样子 |
| 启用插件 | 开 | 关掉后所有按键交回 Obsidian |
| 回车自动续号 | 开 | 核心行为 |
| Tab / Shift-Tab 切换层级 | 开 | 关掉后 Tab 恢复缩进 |
| 退格清除编号 | 开 | |
| 回车后重排后续编号 | 关 | 普通方案下插入条目自动重排；邮件方案总是重排 |
| 编号后加一个空格 | 关 | 变成 `1、 正文` |
| 接管 Markdown 的 `1. ` 列表 | 关 | 仅对含 `{n}.` 层级的自定义方案生效 |

## 适用人群

- **机关 / 国企 / 事业单位文字岗**：通知、报告、请示、纪要、简报——日常刚需，默认就是公文方案。
- **企业行政 / 董办 / 人力 / 法务 / 咨询 / 审计**：报告、底稿、会议纪要，层级深，靠多级编号与重排省手工改号。
- **邮件 / IM 重度用户**：商务、销售、客服、项目经理、HR——微信式两级 `一、/1、` 适合长回复，邮件式三级 `一、/1、/1.1、` 适合周报与方案。
- **泛中文写作者**：公众号、讲义、知识库——保持中文序号，不生成 Markdown 列表。

## 安装

```bash
VAULT="/path/to/your/vault"
mkdir -p "$VAULT/.obsidian/plugins/chinese-smart-numbering"
cp manifest.json main.js styles.css "$VAULT/.obsidian/plugins/chinese-smart-numbering/"
```

然后在 Obsidian 里 **设置 → 第三方插件** 重载并启用「Smart Chinese Numbering」。
（插件目录与 `manifest.json` 的 `id` 必须都是 `chinese-smart-numbering`。）

### 为什么目录里显示英文名

Obsidian 社区目录对 `manifest.json` 的 `name` 有硬性限制：**只接受 Basic Latin 字符**（也禁止出现 `Obsidian`、不能以 `Obsi` / `dian` 开头结尾）。
所以目录里的名字是 **Smart Chinese Numbering**，中文名「中文智能编号」保留在设置页标题、命令提示和本文档里 —— 这是同类中文插件（如 Banxin Typography）的通行做法。

### 从 0.1.0 / 1.0.0 升级

- 插件 id 不变，直接覆盖 `main.js` / `manifest.json` / `styles.css` 后重载即可；
- 旧设置自动迁移：默认进入「公文」方案；如果之前开了「Tab 换级时同时缩进」，会迁移到「自定义」方案并保留缩进宽度；
- 1.1.0 起「微信 / IM」是两级（`一、` `1、`），「邮件」是三级（`一、` `1、` `1.1、`），旧的多级分隔符设置会并入「多级标号」。

### 和 Smart List Input 的关系

两者定位冲突：Smart List Input 会在你输入 `1、` 后再敲空格时把编号改写成 `1.`，之后 Obsidian 就按 Markdown 列表续号。
**要保留中文序号，请停用它**。

## 已知边界

- 纯文本编号，不生成 Markdown 有序列表；导出 Word/PDF 后仍是文本序号。
- 多级方案要求编号后带「、」（插件会自动写）；手写 `1.1 内容`（空格、无顿号）不会被识别。
- 多级方案与"小数"存在一处固有歧义：二级条目后面紧跟的 `1.5、` 会被当成 `1.1、` 那一级；单独成行的 `1.5 亿元` 不受影响。
- 到方案最大层级后再按 Tab 不再换级（交回 Obsidian 默认行为）；微信方案只有两级。
- 切换方案不转换已有编号；跨方案的行不接管，可用「重排当前编号块」处理。
- 编号块以空行或非编号行断开。
- 仅桌面端实测；移动端沿用同一套 CodeMirror 事件，状态栏不可见时用命令切换。
- 只处理单光标、无选区的按键。

## 开发

```text
obsidian-chinese-smart-numbering/
├── manifest.json          # 插件清单
├── main.js                # 构建产物（Obsidian 实际加载的文件）
├── styles.css             # 设置页样式（示例块等）
├── src/core.js            # 纯文本逻辑：方案编译 / 解析 / 续号 / 换级 / 重排（零依赖）
├── src/plugin-entry.js    # Obsidian 胶水层：按键、命令、状态栏、设置面板
├── build.mjs              # 把 core.js 内联进 main.js（无第三方依赖）
├── test/core.test.js      # 核心行为
├── test/scheme.test.js    # 模板编译与校验
├── test/plugin.test.js    # 插件层按键 / 命令 / 迁移 / 设置页
└── demo/index.html        # 浏览器演示，和插件共用 src/core.js
```

```bash
node build.mjs                                              # 生成 main.js
node --test test/core.test.js test/scheme.test.js test/plugin.test.js   # 70 项测试
# 直接双击 demo/index.html 可以在浏览器里体验（不依赖 Obsidian）
```

设计上，`src/core.js` 的每个操作都是「整篇文本 + 光标位置 → 一段待替换的 `{from, to, insert, cursor}`」，
不碰任何 Obsidian / CodeMirror 对象；同一份逻辑被插件、单元测试和浏览器 demo 复用。

## English

**Smart Chinese Numbering** — type Chinese-style numbered outlines in Obsidian without fighting Markdown.

Markdown only knows `1.` / `-`. Chinese writers need `一、`, `（一）`, `1、`, `（1）`, `①`, and mail style `1.1、`.

- **Enter** continues the sequence (`1、` → `2、`, `一、` → `二、`); **Tab / Shift-Tab** change level; chat/mail schemes indent 2 spaces per level.
- **Four presets**: *Gongwen* (`一、 （一） 1、 （1） ①`), *WeChat / IM* (`一、` → `1、`), *Mail* (`一、` → `1、` → `1.1、`), *Custom* (two independent template sets — flat or hierarchical — with a live preview of the result).
- Mail scheme renumbers the whole block on Enter, so a new row never desyncs the list below.
- Output is plain text — no Markdown lists are generated, so exports to Word/PDF keep the Chinese numbering.
- Desktop tested; no network access, no telemetry, zero runtime dependencies.

Docs are in Chinese (the plugin targets Chinese-language writing). Install from **Settings → Community plugins → Browse** and search for "中文智能编号".

## 许可证

MIT
