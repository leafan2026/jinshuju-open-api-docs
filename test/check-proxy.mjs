/**
 * /_proxy 的安全用例：对着 wrangler dev 起的真实 worker 跑。
 *
 *   node test/check-proxy.mjs            # 需要 worker 已在 127.0.0.1:8788 跑起来
 *   （通常由 test/run-all.mjs 编排，它会自动起假上游和 wrangler dev）
 *
 * worker 必须带 --var UPSTREAM_ORIGIN:http://127.0.0.1:8799 启动，
 * 这样「正常转发」这条也能验证，且全程不碰线上。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const WORKER = process.env.WORKER_URL || "http://127.0.0.1:8788";
const LOG = path.join(os.tmpdir(), "jsj-upstream-log.jsonl");

function upstreamHits() {
  try {
    return fs.readFileSync(LOG, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
  } catch {
    return [];
  }
}

async function call(payload, headers = {}, raw = null) {
  const before = upstreamHits().length;
  const { __method, ...rest } = headers;
  let res;
  try {
    res = await fetch(WORKER + "/_proxy", {
      method: __method || "POST",
      headers: { "Content-Type": "application/json", ...rest },
      body: __method === "OPTIONS" ? undefined : raw !== null ? raw : JSON.stringify(payload),
    });
  } catch (err) {
    return { status: 0, body: String(err), cors: null, forwarded: [] };
  }
  let body = "";
  try {
    body = await res.text();
  } catch { /* 空响应 */ }
  return {
    status: res.status,
    body: body.slice(0, 160),
    cors: res.headers.get("access-control-allow-origin"),
    forwarded: upstreamHits().slice(before), // 这次调用有没有真的打到上游
  };
}

const CREDS = { apiKey: "k", apiSecret: "s" };
const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: !!ok });
  console.log(`  ${ok ? "✓" : "✗"} ${name}${ok ? "" : "\n      " + detail}`);
}

console.log("代理安全用例：");

// 正常路径必须还能走通——否则白名单收太紧就没人发现
let r = await call({ ...CREDS, method: "GET", path: "/api/v1/forms" });
check(
  "正常 /api/v1/forms 能转发",
  r.status === 200 && r.forwarded.length === 1 && r.forwarded[0].url === "/api/v1/forms",
  `status=${r.status} forwarded=${JSON.stringify(r.forwarded)}`
);

r = await call({ ...CREDS, method: "POST", path: "/api/v1/forms", body: '{"a":1}' });
check("POST 带 body 能转发", r.status === 200 && r.forwarded.length === 1 && r.forwarded[0].method === "POST",
  `status=${r.status} forwarded=${JSON.stringify(r.forwarded)}`);

// 路径逃逸：原始串看着合法，规范化后会跳出 /api/v1/
for (const p of [
  "/api/v1/%2e%2e/__probe__",
  "/api/v1/../__probe__",
  "/api/v1/%2E%2E/%2E%2E/__probe__",
  "/api/v1/x/%2e%2e/%2e%2e/__probe__",
  // 下面这些把斜杠也编码了，规范化不会当成双点段，得靠「解码后查 ..」那一层拦住
  "/api/v1/%2e%2e%2f__probe__",
  "/api/v1/..%2f__probe__",
  "/api/v1/%2e%2e%5c__probe__",
  "/api/v1/%252e%252e%252f__probe__",
]) {
  r = await call({ ...CREDS, method: "GET", path: p });
  check(`逃逸被拒且不发上游：${p}`, r.status === 400 && r.forwarded.length === 0,
    `status=${r.status} body=${r.body} forwarded=${JSON.stringify(r.forwarded)}`);
}

// 换域名
for (const p of ["//evil.example/x", "https://evil.example/x", "http://evil.example/api/v1/x"]) {
  r = await call({ ...CREDS, method: "GET", path: p });
  check(`换域名被拒：${p}`, r.status === 400 && r.forwarded.length === 0,
    `status=${r.status} body=${r.body} forwarded=${JSON.stringify(r.forwarded)}`);
}

r = await call({ ...CREDS, method: "GET", path: "/api/v2/forms" });
check("非 /api/v1 前缀被拒", r.status === 400 && r.forwarded.length === 0, `status=${r.status} body=${r.body}`);

// 跨站来源不能拿这个端点当跳板
r = await call({ ...CREDS, method: "GET", path: "/api/v1/forms" }, { Origin: "https://evil.example" });
check("跨站 Origin 403 且不发上游", r.status === 403 && r.forwarded.length === 0,
  `status=${r.status} cors=${r.cors} forwarded=${JSON.stringify(r.forwarded)}`);

r = await call({ ...CREDS, method: "GET", path: "/api/v1/forms" }, { Origin: WORKER });
check("同源 Origin 放行并回显 CORS", r.status === 200 && r.cors === WORKER, `status=${r.status} cors=${r.cors}`);

r = await call(null, { __method: "OPTIONS", Origin: "https://evil.example" });
check("跨站预检 403", r.status === 403, `status=${r.status}`);

r = await call(null, { __method: "OPTIONS", Origin: WORKER });
check("同源预检 204 + CORS", r.status === 204 && r.cors === WORKER, `status=${r.status} cors=${r.cors}`);

// 上游异常不能再一律回 200
r = await call({ ...CREDS, method: "GET", path: "/api/v1/boom" });
check("上游断连回 502", r.status === 502, `status=${r.status} body=${r.body}`);

// run-all.mjs 会用 --var 把上游超时压到 2 秒，这里按那个值留余量
const expectTimeout = Number(process.env.PROXY_TIMEOUT_MS || 20000);
const t0 = Date.now();
r = await call({ ...CREDS, method: "GET", path: "/api/v1/hang" });
const waited = Date.now() - t0;
check(`上游挂住回 504（等了 ${waited}ms）`, r.status === 504 && waited < expectTimeout + 6000,
  `status=${r.status} body=${r.body} waited=${waited}，预期在 ${expectTimeout + 6000}ms 内`);

// 体积：先看 Content-Length，别等整包解析完
r = await call(null, {}, JSON.stringify({ ...CREDS, method: "POST", path: "/api/v1/forms", body: "x".repeat(700 * 1024) }));
check("超大请求体 413 且不发上游", r.status === 413 && r.forwarded.length === 0, `status=${r.status} body=${r.body}`);

r = await call({ method: "GET", path: "/api/v1/forms" });
check("缺凭据 400", r.status === 400 && r.forwarded.length === 0, `status=${r.status}`);

r = await call({ ...CREDS, method: "TRACE", path: "/api/v1/forms" });
check("非白名单方法 400", r.status === 400 && r.forwarded.length === 0, `status=${r.status}`);

r = await call(null, {}, "{ not json");
check("坏 JSON 400", r.status === 400, `status=${r.status}`);

const getProxy = await fetch(WORKER + "/_proxy").catch(() => ({ status: 0 }));
check("GET /_proxy 405", getProxy.status === 405, `status=${getProxy.status}`);

// 页面安全头
const page = await fetch(WORKER + "/");
const html = await page.text();
const csp = html.match(/Content-Security-Policy" content="([^"]+)"/);
check("页面带 CSP", !!csp, "页面里没有 CSP meta");
if (csp) {
  const c = csp[1];
  check("CSP 限制脚本来源", /script-src [^;]*'self'/.test(c) && !/script-src[^;]*unsafe-inline/.test(c),
    `script-src 不该带 unsafe-inline：${c}`);
  check("CSP 限制 object/base/form", /object-src 'none'/.test(c) && /base-uri 'none'/.test(c) && /form-action 'none'/.test(c), c);
}

const failed = results.filter((x) => !x.ok);
console.log(`  —— ${results.length} 项，失败 ${failed.length} 项`);
process.exit(failed.length === 0 ? 0 : 1);
