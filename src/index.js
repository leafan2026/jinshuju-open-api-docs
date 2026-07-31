/**
 * 金数据开放平台 · API 文档站
 *
 * 路由：
 *   GET  /              → 文档站页面（三栏 Apifox 风格）
 *   GET  /data.json     → 接口 + 指南数据（构建时打包进 worker）
 *   POST /_proxy        → 在线运行代理，转发到 https://jinshuju.net/api/v1/*
 *   GET  /healthz       → 健康检查
 */

import endpoints from "./data/endpoints.json";
import guides from "./data/guides.json";

const UPSTREAM = "https://jinshuju.net";
const ALLOWED_PREFIX = "/api/v1/";
const ALLOWED_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE"]);
const MAX_BODY = 512 * 1024; // 512 KB

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";

    if (path === "/healthz") {
      return json({ ok: true, endpoints: endpoints.length, guides: guides.length });
    }

    if (path === "/data.json") {
      return json({ endpoints, guides }, { "Cache-Control": "public, max-age=60" });
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

  return `<!doctype html>
<html lang="zh-CN" data-theme="light">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>金数据开放平台 · API</title>
<meta name="description" content="金数据开放平台 API v1 交互式文档，支持在线调试。">
<link rel="stylesheet" href="${css}">
</head>
<body>
<div class="app" id="app">

  <aside class="sidebar">
    <div class="sidebar-head">
      <div class="logo-mark">金</div>
      <div class="logo-text">开放 API</div>
      <button class="icon-btn" id="btn-theme" title="切换主题"></button>
    </div>
    <div class="search-wrap">
      <div class="search-box">
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6">
          <circle cx="7" cy="7" r="4.6"/><path d="M10.5 10.5L14 14"/>
        </svg>
        <input id="search" type="text" placeholder="搜索" autocomplete="off" spellcheck="false">
        <kbd>⌘K</kbd>
      </div>
    </div>
    <div class="nav" id="nav"></div>
  </aside>

  <section class="content" id="content">
    <div class="doc" id="doc"></div>
  </section>

  <aside class="runner">
    <div class="runner-head">
      <h3>在线运行</h3>
      <span class="env">正式环境</span>
      <button class="icon-btn" id="btn-close-runner" title="关闭">
        <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6">
          <path d="M4 4l8 8M12 4l-8 8"/>
        </svg>
      </button>
    </div>
    <div class="runner-body" id="runner-body"></div>
    <div class="resp-head" id="resp-head"><span>返回结果</span></div>
    <div class="resp-body" id="resp-body"></div>
  </aside>

</div>
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
