/**
 * 跑全部检查：npm test
 *
 * 三组：
 *   1. check-links     链接 / 图片 / 协议白名单
 *   2. check-snippets  生成的 cURL 与 Python 真的执行一遍
 *   3. check-proxy     /_proxy 的安全用例（自动起假上游 + wrangler dev）
 *
 * 前置：src/data/site.json 得先生成好（npm run data -- <open-doc 路径>）。
 * 全程只连本机，不碰线上。
 */
import fs from "node:fs";
import net from "node:net";
import { spawn } from "node:child_process";

const MOCK_PORT = 8799;
const WORKER_PORT = 8788;
// 生产是 20 秒，测「超时回 504」没必要真等那么久
const PROXY_TIMEOUT_MS = 2000;

if (!fs.existsSync("src/data/site.json")) {
  console.error("✗ 缺 src/data/site.json，先跑：npm run data -- <open-doc 仓库路径>");
  process.exit(1);
}

function portFree(port) {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.once("error", () => resolve(false));
    s.once("listening", () => s.close(() => resolve(true)));
    s.listen(port, "127.0.0.1");
  });
}

function node(args, opts = {}) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, args, { stdio: "inherit", ...opts });
    p.on("exit", (code) => resolve(code ?? 1));
  });
}

async function waitFor(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(url);
      if (r.ok) return true;
    } catch { /* 还没起来 */ }
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
}

let failed = 0;
const section = (name) => console.log(`\n──── ${name} ────`);

section("链接 / 图片 / 协议");
failed += (await node(["test/check-links.mjs"])) === 0 ? 0 : 1;

section("请求代码");
failed += (await node(["test/check-snippets.mjs"])) === 0 ? 0 : 1;

section("代理安全");
for (const [port, what] of [[MOCK_PORT, "假上游"], [WORKER_PORT, "worker"]]) {
  if (!(await portFree(port))) {
    console.error(`✗ 端口 ${port}（${what}）已被占用，先腾出来再跑`);
    process.exit(1);
  }
}

const mock = spawn(process.execPath, ["test/mock-upstream.mjs", String(MOCK_PORT)], { stdio: "inherit" });
// 让 wrangler 连假上游而不是 jinshuju.net
const worker = spawn(
  "npx",
  ["wrangler", "dev", "--port", String(WORKER_PORT), "--ip", "127.0.0.1",
    "--var", `UPSTREAM_ORIGIN:http://127.0.0.1:${MOCK_PORT}`,
    "--var", `UPSTREAM_TIMEOUT_MS:${PROXY_TIMEOUT_MS}`],
  { stdio: "ignore", detached: true }
);

function cleanup() {
  try { mock.kill("SIGTERM"); } catch { /* 已退出 */ }
  try { process.kill(-worker.pid, "SIGTERM"); } catch { /* 已退出 */ }
}
process.on("exit", cleanup);
process.on("SIGINT", () => { cleanup(); process.exit(130); });

const ready = await waitFor(`http://127.0.0.1:${WORKER_PORT}/healthz`, 90000);
if (!ready) {
  console.error("✗ wrangler dev 90 秒内没起来");
  cleanup();
  process.exit(1);
}
console.log("  worker 就绪");
failed += (await node(["test/check-proxy.mjs"], {
  env: {
    ...process.env,
    WORKER_URL: `http://127.0.0.1:${WORKER_PORT}`,
    PROXY_TIMEOUT_MS: String(PROXY_TIMEOUT_MS),
  },
})) === 0 ? 0 : 1;
cleanup();

console.log(failed === 0 ? "\n全部通过" : `\n有 ${failed} 组检查失败`);
process.exit(failed === 0 ? 0 : 1);
