import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8"));
const core = readFileSync(join(root, "src", "core.js"), "utf8");
const entry = readFileSync(join(root, "src", "plugin-entry.js"), "utf8");

const begin = core.indexOf("// @core-begin");
const end = core.indexOf("// @core-end");
if (begin < 0 || end < 0) {
  throw new Error("src/core.js 缺少 // @core-begin / // @core-end 标记");
}

const body = core
  .slice(core.indexOf("\n", begin) + 1, end)
  .trimEnd()
  // 源码里 core 缩进 2 空格，插件模板占位符已缩进 2 空格，这里去掉一层避免叠加
  .split("\n")
  .map((line) => (line.startsWith("  ") ? line.slice(2) : line))
  .join("\n");
const placeholder = entry.indexOf("/*__CORE__*/");
if (placeholder < 0) {
  throw new Error("src/plugin-entry.js 缺少 /*__CORE__*/ 占位符");
}

const banner = [
  "/*",
  " * 中文智能编号 (Smart Chinese Numbering) v" + manifest.version,
  " * 本文件由 build.mjs 生成，请勿直接编辑；修改 src/core.js 或 src/plugin-entry.js 后运行 node build.mjs",
  " */",
  "",
].join("\n");

const out = banner + entry.replace("/*__CORE__*/", () => body);
writeFileSync(join(root, "main.js"), out, "utf8");
console.log("main.js 已生成：" + out.length + " 字节（v" + manifest.version + "）");
