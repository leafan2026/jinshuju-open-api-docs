#!/usr/bin/env node
/**
 * 产出纯静态站到 dist/，可以直接扔 GitHub Pages / OSS / Nginx —— 不需要任何服务端。
 *
 *   node scripts/build-static.mjs [--out=目录]
 *
 * 输出目录只能用 --out= 指定，不接受位置参数——避免把别的路径误当成输出目录，
 * 因为下面会把输出目录整个删掉重建。删除前还会做一次安全检查。
 *
 * 之所以不需要服务端：金数据 API 自己开了 CORS
 * （Access-Control-Allow-Origin: *，且允许 authorization 头），
 * 所以「在线调试」是浏览器直连 jinshuju.net，凭据不经第三方。
 *
 * 前置：先跑 scripts/build-data.mjs 生成 src/data/site.json。
 */

import fs from "node:fs";
import path from "node:path";
import { renderPage } from "../src/page.js";

const HERE = path.resolve(import.meta.dirname, "..");
const DATA = path.join(HERE, "src", "data", "site.json");
const MARKER = ".build-static-output";

const positional = process.argv.slice(2).filter((a) => !a.startsWith("-"));
if (positional.length) {
  console.error(
    `不接受位置参数 “${positional[0]}”。输出目录请用 --out=<目录> 指定。\n` +
      "（本脚本会清空输出目录，用位置参数太容易误删别的目录）"
  );
  process.exit(1);
}
const outFlag = process.argv.slice(2).find((a) => a.startsWith("--out="));
const OUT = path.resolve(outFlag ? outFlag.slice("--out=".length) : path.join(HERE, "dist"));

if (!fs.existsSync(DATA)) {
  console.error("缺少 src/data/site.json，先跑：npm run data");
  process.exit(1);
}

// 清空前的安全检查：只允许清空「空目录」或「上次本脚本产出的目录」
if (fs.existsSync(OUT)) {
  const entries = fs.readdirSync(OUT);
  const isOurs = entries.includes(MARKER);
  if (entries.length && !isOurs) {
    console.error(
      `拒绝清空 ${OUT}\n` +
        "该目录非空，且不含本脚本的标记文件，看起来不是构建产物目录。\n" +
        `目录内容：${entries.slice(0, 8).join(", ")}${entries.length > 8 ? " …" : ""}\n` +
        "请换一个输出目录，或先手动清空它。"
    );
    process.exit(1);
  }
  fs.rmSync(OUT, { recursive: true, force: true });
}
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, MARKER), "由 scripts/build-static.mjs 生成，可安全删除。\n");

// 页面外壳（与 worker 共用模板，只是资源用相对路径）
fs.writeFileSync(
  path.join(OUT, "index.html"),
  renderPage({ css: "app.css", js: "app.js", logo: "img/logo.png" })
);

// 前端资源
for (const f of ["app.css", "app.js"]) {
  fs.copyFileSync(path.join(HERE, "public", f), path.join(OUT, f));
}

// 图片（手写递归拷贝：fs.cpSync 在某些挂载盘上会因为保留属性而失败）
function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const e of fs.readdirSync(from, { withFileTypes: true })) {
    const a = path.join(from, e.name), b = path.join(to, e.name);
    if (e.isDirectory()) copyDir(a, b);
    else fs.copyFileSync(a, b);
  }
}
const img = path.join(HERE, "public", "img");
if (fs.existsSync(img)) copyDir(img, path.join(OUT, "img"));

// 文档数据（前端 fetch 的就是这个）
fs.copyFileSync(DATA, path.join(OUT, "data.json"));

// GitHub Pages 别把下划线开头的路径当 Jekyll 处理
fs.writeFileSync(path.join(OUT, ".nojekyll"), "");

// 单页应用：Pages 上刷新任意路径都回到 index.html
fs.copyFileSync(path.join(OUT, "index.html"), path.join(OUT, "404.html"));

function size(p) {
  let total = 0;
  for (const e of fs.readdirSync(p, { withFileTypes: true })) {
    const full = path.join(p, e.name);
    total += e.isDirectory() ? size(full) : fs.statSync(full).size;
  }
  return total;
}

const site = JSON.parse(fs.readFileSync(DATA, "utf8"));
console.log(`✓ ${path.relative(process.cwd(), OUT) || OUT}`);
console.log(`  ${Object.keys(site.docs).length} 篇文档，${(size(OUT) / 1024).toFixed(0)} KB`);
console.log("  纯静态，直接托管即可；在线调试走浏览器直连，无需服务端");
