/**
 * 假上游：代替 jinshuju.net 接收 worker 转发过来的请求，测试全程不碰线上。
 *
 *   node test/mock-upstream.mjs [端口]
 *
 * 收到的请求逐行记进 $TMPDIR/jsj-upstream-log.jsonl，供 check-proxy.mjs 断言
 * 「这个请求到底有没有被转发出去」。
 */
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const LOG = path.join(os.tmpdir(), "jsj-upstream-log.jsonl");
const PORT = Number(process.argv[2] || 8799);

fs.writeFileSync(LOG, "");

http
  .createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      fs.appendFileSync(LOG, JSON.stringify({ method: req.method, url: req.url, len: body.length }) + "\n");
      if (req.url.startsWith("/api/v1/hang")) return; // 故意不响应：验证超时回 504
      if (req.url.startsWith("/api/v1/boom")) return req.socket.destroy(); // 断连：验证回 502
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, saw: req.method + " " + req.url }));
    });
  })
  .listen(PORT, "127.0.0.1", () => console.log(`  假上游就绪 127.0.0.1:${PORT}`));
