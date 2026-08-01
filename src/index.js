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
const ALLOWED_PREFIX = "/api/v1/";
const ALLOWED_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE"]);
const MAX_BODY = 512 * 1024; // 512 KB

// 代理是可选后备（默认前端直连金数据），跨域托管时需要这些头
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "content-type",
  "Access-Control-Max-Age": "7200",
};

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
      if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
      if (request.method !== "POST") return json({ error: "Method Not Allowed" }, CORS, 405);
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
    return json({ error: "请求体不是合法 JSON" }, CORS, 400);
  }

  const method = String(payload.method || "GET").toUpperCase();
  const reqPath = String(payload.path || "");
  const apiKey = String(payload.apiKey || "");
  const apiSecret = String(payload.apiSecret || "");

  if (!ALLOWED_METHODS.has(method)) {
    return json({ error: `不支持的方法：${method}` }, CORS, 400);
  }
  if (!reqPath.startsWith(ALLOWED_PREFIX)) {
    return json({ error: `只允许代理 ${ALLOWED_PREFIX}* 下的请求` }, CORS, 400);
  }
  if (reqPath.includes("..") || /[\r\n]/.test(reqPath)) {
    return json({ error: "非法请求路径" }, CORS, 400);
  }
  if (!apiKey || !apiSecret) {
    return json({ error: "缺少 API_KEY 或 API_SECRET" }, CORS, 400);
  }

  const target = new URL(reqPath, UPSTREAM);
  if (target.origin !== UPSTREAM) {
    return json({ error: "非法目标地址" }, CORS, 400);
  }

  const headers = {
    Authorization: "Basic " + b64(`${apiKey}:${apiSecret}`),
    Accept: "application/json",
    "Content-Type": "application/json",
    "User-Agent": "jinshuju-open-api-docs/1.0 (+try-it console)",
  };

  const init = { method, headers, redirect: "manual" };
  if (["POST", "PUT", "PATCH"].includes(method) && payload.body) {
    const body = String(payload.body);
    if (body.length > MAX_BODY) return json({ error: "请求体过大（上限 512 KB）" }, CORS, 413);
    init.body = body;
  }

  const started = Date.now();
  let upstream;
  try {
    upstream = await fetch(target.toString(), init);
  } catch (err) {
    return json({ error: `上游请求失败：${err && err.message ? err.message : String(err)}` }, CORS);
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
  }, CORS);
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
