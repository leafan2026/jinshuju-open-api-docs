/**
 * 金数据开放平台 · API 文档站
 *
 * 路由：
 *   GET  /              → 文档站页面（三栏 Apifox 风格）
 *   GET  /data.json     → 接口 + 指南数据（构建时打包进 worker）
 *   POST /_proxy        → 在线运行代理，转发到 https://jinshuju.net/api/v1/*
 *   GET  /healthz       → 健康检查
 */

import site from "./data/site.json";

const UPSTREAM = "https://jinshuju.net";
const ALLOWED_PREFIX = "/api/v1/";
const ALLOWED_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE"]);
const MAX_BODY = 512 * 1024; // 512 KB

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";

    if (path === "/healthz") {
      const docs = Object.values(site.docs);
      return json({
        ok: true,
        source: site.source,
        generatedAt: site.generatedAt,
        docs: docs.length,
        endpoints: docs.filter((d) => d.api).length,
      });
    }

    if (path === "/data.json") {
      return json(site, { "Cache-Control": "public, max-age=60" });
    }

    if (path === "/_proxy") {
      if (request.method !== "POST") return json({ error: "Method Not Allowed" }, {}, 405);
      return proxy(request);
    }

    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method Not Allowed", { status: 405 });
    }

    return new Response(await page(env), {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-cache",
      },
    });
  },
};

/* ---------------- 在线运行代理 ---------------- */

async function proxy(request) {
  let payload;
  try {
    payload = await request.json();
  } catch {
    return json({ error: "请求体不是合法 JSON" }, {}, 400);
  }

  const method = String(payload.method || "GET").toUpperCase();
  const reqPath = String(payload.path || "");
  const apiKey = String(payload.apiKey || "");
  const apiSecret = String(payload.apiSecret || "");

  if (!ALLOWED_METHODS.has(method)) {
    return json({ error: `不支持的方法：${method}` }, {}, 400);
  }
  if (!reqPath.startsWith(ALLOWED_PREFIX)) {
    return json({ error: `只允许代理 ${ALLOWED_PREFIX}* 下的请求` }, {}, 400);
  }
  if (reqPath.includes("..") || /[\r\n]/.test(reqPath)) {
    return json({ error: "非法请求路径" }, {}, 400);
  }
  if (!apiKey || !apiSecret) {
    return json({ error: "缺少 API_KEY 或 API_SECRET" }, {}, 400);
  }

  const target = new URL(reqPath, UPSTREAM);
  if (target.origin !== UPSTREAM) {
    return json({ error: "非法目标地址" }, {}, 400);
  }

  const headers = {
    Authorization: "Basic " + b64(`${apiKey}:${apiSecret}`),
    Accept: "application/json",
    "User-Agent": "jinshuju-open-api-docs/1.0 (+try-it console)",
  };

  const init = { method, headers, redirect: "manual" };
  if (["POST", "PUT", "PATCH"].includes(method) && payload.body) {
    const body = String(payload.body);
    if (body.length > MAX_BODY) return json({ error: "请求体过大（上限 512 KB）" }, {}, 413);
    headers["Content-Type"] = "application/json";
    init.body = body;
  }

  const started = Date.now();
  let upstream;
  try {
    upstream = await fetch(target.toString(), init);
  } catch (err) {
    return json({ error: `上游请求失败：${err && err.message ? err.message : String(err)}` });
  }
  const durationMs = Date.now() - started;

  let text = "";
  try {
    text = await upstream.text();
  } catch {
    text = "";
  }
  if (text.length > MAX_BODY) text = text.slice(0, MAX_BODY) + "\n…（响应已截断）";

  return json({
    status: upstream.status,
    statusText: upstream.statusText,
    durationMs,
    contentType: upstream.headers.get("content-type") || "",
    body: text,
  });
}

function b64(s) {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

function json(data, extra = {}, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...extra },
  });
}

/* ---------------- 页面 ---------------- */

async function page(env) {
  const css = await assetUrl(env, "/app.css");
  const js = await assetUrl(env, "/app.js");
  const logo = await assetUrl(env, "/img/logo.svg");

  return `<!doctype html>
<html lang="zh-CN" data-theme="light">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>金数据开放平台 · API</title>
<meta name="description" content="金数据开放平台 API v1 文档，正文与 open.jinshuju.net 一致，并支持在线调试与生成请求代码。">
<link rel="stylesheet" href="${css}">
</head>
<body>

<header class="navbar">
  <div class="navbar__inner">
    <div class="navbar__items">
      <a class="navbar__brand" href="#/">
        <img class="navbar__logo" src="${logo}" alt="金数据">
        <b class="navbar__title">金数据开放平台</b>
      </a>
      <a class="navbar__link navbar__link--active" href="#/">文档</a>
    </div>
    <div class="navbar__items navbar__items--right">
      <a class="navbar__link" href="https://jinshuju.net" target="_blank" rel="noopener">金数据首页<svg width="13" height="13" aria-hidden="true" viewBox="0 0 24 24" class="ext-icon"><path fill="currentColor" d="M21 13v10h-21v-19h12v2h-10v15h17v-8h2zm3-12h-10.988l4.035 4-6.977 7.07 2.828 2.828 6.977-7.07 4.125 4.172v-11z"/></svg></a>
      <button class="clean-btn" id="btn-theme" title="切换主题"></button>
    </div>
  </div>
</header>

<div class="layout" id="layout">

  <aside class="sidebar">
    <div class="search-wrap">
      <div class="search-box">
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7">
          <circle cx="7" cy="7" r="4.6"/><path d="M10.5 10.5L14 14"/>
        </svg>
        <input id="search" type="text" placeholder="搜索接口" autocomplete="off" spellcheck="false">
        <kbd>⌘K</kbd>
      </div>
    </div>
    <div class="menu" id="menu"></div>
  </aside>

  <main class="main" id="main">
    <div class="main-inner">
      <div class="container" id="doc"></div>
      <aside class="toc" id="toc"></aside>
    </div>
  </main>

  <aside class="runner">
    <div class="runner-top">
      <h2>在线运行</h2>
      <button class="clean-btn" id="btn-close-runner" title="收起">
        <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7">
          <path d="M4 4l8 8M12 4l-8 8"/>
        </svg>
      </button>
    </div>
    <div class="runner-scroll" id="runner-scroll"></div>
    <div class="runner-out">
      <div class="tabs" id="out-tabs"></div>
      <div class="out-pane" id="out-pane"></div>
    </div>
  </aside>

</div>

<div class="modal-root" id="modal-root" hidden></div>
<div class="toast" id="toast"></div>
<script src="${js}"></script>
</body>
</html>`;
}

async function assetUrl(env, path) {
  try {
    if (env && env.ASSETS && typeof env.ASSETS.url === "function") {
      const u = await env.ASSETS.url(path);
      if (u) return u;
    }
  } catch {
    /* 回退到相对路径 */
  }
  return "." + path;
}
