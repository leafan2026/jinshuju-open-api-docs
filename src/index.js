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
import { renderPage } from "./page.js";

const UPSTREAM = "https://jinshuju.net";
// 只有 test/check-proxy.mjs 会用 wrangler --var 注入假上游，好让「正常转发」这条也能测；
// 生产不设这个变量，上游就永远是 jinshuju.net。
function upstreamOf(env) {
  const v = env && env.UPSTREAM_ORIGIN;
  return v ? String(v) : UPSTREAM;
}
const ALLOWED_PREFIX = "/api/v1/";
const ALLOWED_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE"]);
const MAX_BODY = 512 * 1024; // 512 KB：转发给上游的请求体上限
const MAX_PAYLOAD = 640 * 1024; // 整个 /_proxy 请求体上限（body + 凭据 + JSON 包装）
const UPSTREAM_TIMEOUT_MS = 20000;
// 同样只为测试留的开关，好让「超时回 504」这条不用真等 20 秒
function upstreamTimeoutOf(env) {
  const v = Number((env && env.UPSTREAM_TIMEOUT_MS) || 0);
  return v > 0 ? v : UPSTREAM_TIMEOUT_MS;
}

// 代理是可选后备（默认前端直连金数据），跨域托管时需要这些头。
// Access-Control-Allow-Origin 按请求回显，只放行同源和 PROXY_ALLOWED_ORIGINS 里列出的来源，
// 避免任意站点把这个端点当成转发跳板。
const CORS_BASE = {
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "content-type",
  "Access-Control-Max-Age": "7200",
};

function allowedOrigins(env) {
  return String((env && env.PROXY_ALLOWED_ORIGINS) || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

// 返回 { ok, headers }：ok=false 表示这个来源不该被放行
function corsFor(request, env) {
  const origin = request.headers.get("Origin");
  if (!origin) return { ok: true, headers: {} }; // 服务端/命令行调用，没有跨域概念
  const list = allowedOrigins(env);
  const selfOrigin = new URL(request.url).origin;
  if (origin === selfOrigin || list.includes(origin) || list.includes("*")) {
    return {
      ok: true,
      headers: { ...CORS_BASE, "Access-Control-Allow-Origin": origin, Vary: "Origin" },
    };
  }
  return { ok: false, headers: { Vary: "Origin" } };
}

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
      const cors = corsFor(request, env);
      if (!cors.ok) return json({ error: "该来源未被允许调用转发端点" }, cors.headers, 403);
      if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors.headers });
      if (request.method !== "POST") return json({ error: "Method Not Allowed" }, cors.headers, 405);
      return proxy(request, env, cors.headers);
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

async function proxy(request, env, cors) {
  const token = String((env && env.PROXY_TOKEN) || "");
  if (token && request.headers.get("X-Proxy-Token") !== token) {
    return json({ error: "转发端点需要 X-Proxy-Token" }, cors, 401);
  }

  // 先看 Content-Length，别等整包 JSON 解析完才发现超限
  const declared = Number(request.headers.get("content-length") || 0);
  if (declared > MAX_PAYLOAD) {
    return json({ error: "请求体过大（上限 512 KB）" }, cors, 413);
  }

  let payload;
  try {
    payload = await request.json();
  } catch {
    return json({ error: "请求体不是合法 JSON" }, cors, 400);
  }

  const method = String(payload.method || "GET").toUpperCase();
  const reqPath = String(payload.path || "");
  const apiKey = String(payload.apiKey || "");
  const apiSecret = String(payload.apiSecret || "");

  if (!ALLOWED_METHODS.has(method)) {
    return json({ error: `不支持的方法：${method}` }, cors, 400);
  }
  if (/[\r\n]/.test(reqPath)) {
    return json({ error: "非法请求路径" }, cors, 400);
  }

  // 光靠下面的规范化还不够：`%2e%2e%2f` 把整个 `../` 编码成了一个路径段，
  // 规范化不会把它当作双点段，于是原样转发给上游——上游要是解码 %2f，
  // 就等于跳出了 /api/v1/。所以先解码一次，看有没有 .. 或反斜杠。
  // 正常的 API 路径（表单 token、serial number）不会用到这些。
  // 反复解码到不再变化，免得 %252e%252e%252f 这种多层编码靠一次解码看不出来
  let decodedPath = reqPath.split(/[?#]/)[0];
  for (let i = 0; i < 4; i++) {
    let next;
    try {
      next = decodeURIComponent(decodedPath);
    } catch {
      return json({ error: "非法请求路径" }, cors, 400);
    }
    if (next === decodedPath) break;
    decodedPath = next;
  }
  if (decodedPath.includes("..") || decodedPath.includes("\\")) {
    return json({ error: "非法请求路径" }, cors, 400);
  }
  if (!apiKey || !apiSecret) {
    return json({ error: "缺少 API_KEY 或 API_SECRET" }, cors, 400);
  }

  // 白名单必须在 URL 规范化之后校验：`/api/v1/%2e%2e/x` 这类写法
  // 在原始字符串上看是合法的，规范化后却会跳出 /api/v1/。
  const upstreamOrigin = upstreamOf(env);
  let target;
  try {
    target = new URL(reqPath, upstreamOrigin);
  } catch {
    return json({ error: "非法请求路径" }, cors, 400);
  }
  if (target.origin !== new URL(upstreamOrigin).origin) {
    return json({ error: "非法目标地址" }, cors, 400);
  }
  if (!target.pathname.startsWith(ALLOWED_PREFIX)) {
    return json({ error: `只允许代理 ${ALLOWED_PREFIX}* 下的请求` }, cors, 400);
  }

  const headers = {
    Authorization: "Basic " + b64(`${apiKey}:${apiSecret}`),
    Accept: "application/json",
    "Content-Type": "application/json",
    "User-Agent": "jinshuju-open-api-docs/1.0 (+try-it console)",
  };

  const timeoutMs = upstreamTimeoutOf(env);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const init = { method, headers, redirect: "manual", signal: controller.signal };
  if (["POST", "PUT", "PATCH"].includes(method) && payload.body) {
    const body = String(payload.body);
    if (body.length > MAX_BODY) {
      clearTimeout(timer);
      return json({ error: "请求体过大（上限 512 KB）" }, cors, 413);
    }
    init.body = body;
  }

  const started = Date.now();
  let upstream;
  try {
    upstream = await fetch(target.toString(), init);
  } catch (err) {
    clearTimeout(timer);
    const aborted = err && (err.name === "AbortError" || err.name === "TimeoutError");
    return json({
      error: aborted
        ? `上游请求超时（${timeoutMs / 1000} 秒无响应）`
        : `上游请求失败：${err && err.message ? err.message : String(err)}`,
    }, cors, aborted ? 504 : 502);
  }
  const durationMs = Date.now() - started;

  let text = "";
  try {
    text = await upstream.text();
  } catch {
    text = "";
  } finally {
    clearTimeout(timer);
  }
  if (text.length > MAX_BODY) text = text.slice(0, MAX_BODY) + "\n…（响应已截断）";

  return json({
    status: upstream.status,
    statusText: upstream.statusText,
    durationMs,
    contentType: upstream.headers.get("content-type") || "",
    body: text,
  }, cors);
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
  return renderPage({
    css: await assetUrl(env, "/app.css"),
    js: await assetUrl(env, "/app.js"),
    logo: await assetUrl(env, "/img/logo.svg"),
  });
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
