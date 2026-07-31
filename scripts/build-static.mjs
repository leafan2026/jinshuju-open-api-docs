#!/usr/bin/env node
/**
 * 产出纯静态站到 dist/，可以直接扔 GitHub Pages / OSS / Nginx —— 不需要任何服务端。
 *
 *   node scripts/build-static.mjs [输出目录]
 *
 * 之所以不需要服务端：金数据 API 自己开了 CORS
 * （Access-Control-Allow-Origin: *，且允许 authorization 头），
 * 所以「在线运行」是浏览器直连 jinshuju.net，凭据不经第三方。
 *
 * 前置：先跑 scripts/build-data.mjs 生成 src/data/site.json。
 */

import fs from "node:fs";
import path from "node:path";
import { renderPage } from "../src/page.js";

const HERE = path.resolve(import.meta.dirname, "..");
const OUT = path.resolve(process.argv[2] || path.join(HERE, "dist"));
const DATA = path.join(HERE, "src", "data", "site.json");

if (!fs.existsSync(DATA)) {
  console.error("缺少 src/data/site.json，先跑：npm run data -- <open-doc 仓库路径>");
  process.exit(1);
}

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

// 页面外壳（与 worker 共用模板，只是资源用相对路径）
fs.writeFileSync(
  path.join(OUT, "index.html"),
  renderPage({ css: "app.css", js: "app.js", logo: "img/logo.svg" })
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
console.log("  纯静态，直接托管即可；在线运行走浏览器直连，无需服务端");
