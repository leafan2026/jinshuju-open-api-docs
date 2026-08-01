/**
 * URL 传参生成器的算法：拿 public/app.js 里的真代码，对着 Python 的独立实现逐个比对。
 *
 *   node test/check-url-params.mjs
 *
 * 盯的是文档里那几个极易搞错的点：
 *   - 字段 API CODE 按字典序升序拼接（顺序错了签名对不上）
 *   - 签名针对未编码的原始值
 *   - HMAC 先转 hex 字符串，再对那串 hex 做 Base64（不是对原始字节做）
 *   - JWT 用 base64url、无填充
 */
import fs from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);
const appSrc = fs.readFileSync("public/app.js", "utf8");
const from = appSrc.indexOf("  var FORM_BASE =");
const to = appSrc.indexOf("  function urlToolHtml(");
if (from === -1 || to === -1) {
  console.error("✗ 找不到 public/app.js 里的 URL 传参算法区块");
  process.exit(1);
}
const block = appSrc.slice(from, to);
const { signParams, jwtHS256, FORM_BASE } = new Function(
  block + "\nreturn { signParams, jwtHS256, FORM_BASE };"
)();

const results = [];
function check(ok, name, detail) {
  results.push({ ok: !!ok, name });
  console.log(`  ${ok ? "✓" : "✗"} ${name}${ok ? "" : "\n      " + detail}`);
}

// ---- Python 参照实现：严格照文档里的 Python 示例 ----
const PY = `
import hmac, hashlib, base64, json, sys
def sign(secret, url_params):
    h = hmac.new(secret.encode(), url_params.encode(), hashlib.sha256).hexdigest()
    return base64.b64encode(h.encode()).decode()
def b64u(b):
    return base64.urlsafe_b64encode(b).rstrip(b"=").decode()
def jwt(secret, payload):
    head = b64u(json.dumps({"alg":"HS256","typ":"JWT"}, separators=(",",":")).encode())
    body = b64u(json.dumps(payload, separators=(",",":"), ensure_ascii=False).encode())
    signing = head + "." + body
    sig = b64u(hmac.new(secret.encode(), signing.encode(), hashlib.sha256).digest())
    return signing + "." + sig
task = json.loads(sys.argv[1])
if task["kind"] == "sign":
    print(sign(task["secret"], task["params"]), end="")
else:
    print(jwt(task["secret"], task["payload"]), end="")
`;

async function py(task) {
  const { stdout } = await run("python3", ["-c", PY, JSON.stringify(task)]);
  return stdout;
}

console.log("表单字段签名（对着 Python 实现逐字节比对）：");
const signCases = [
  { secret: "123456", params: "field_1=James&field_2=13888888888" },     // 文档里的示例
  { secret: "123456", params: "field_1=call&field_2=me&field_3=golden&field_5=data" },
  { secret: "s3cr3t", params: "field_1=张三&field_2=研发部" },            // 中文，验 UTF-8
  { secret: "密钥", params: "field_1=a b&field_2=x&y" },                  // 密钥是中文、值带空格和 &
];
for (const c of signCases) {
  const mine = await signParams(c.secret, c.params);
  const theirs = await py({ kind: "sign", ...c });
  check(mine === theirs, `sign(${JSON.stringify(c.secret)}, ${JSON.stringify(c.params)})`,
    `我们的 ${mine}\n      Python ${theirs}`);
}

// Web Crypto 不接受零长度密钥（浏览器同样如此），所以界面在没填 sign_secret 时
// 必须走「不签名」分支，不能把空串喂给签名函数
let zeroKeyRejected = false;
try {
  await signParams("", "field_1=x");
} catch {
  zeroKeyRejected = true;
}
check(zeroKeyRejected, "空 sign_secret 会被 Web Crypto 拒绝（所以 UI 不填密钥时不签名）",
  "居然没报错，说明这个前提变了，UI 的分支要重新确认");

console.log("JWT（全局字段传参）：");
const jwtCases = [
  { secret: "123456", payload: { gf_1: "张三", gf_2: "研发部" } },        // 文档里的示例
  { secret: "123456", payload: { gf_1: "a+b/c=d" } },                     // 会撞上 base64url 的替换字符
  { secret: "s", payload: {} },
];
for (const c of jwtCases) {
  const mine = await jwtHS256(c.secret, c.payload);
  const theirs = await py({ kind: "jwt", ...c });
  check(mine === theirs, `jwt(${JSON.stringify(c.payload)})`, `我们的 ${mine}\n      Python ${theirs}`);
}

console.log("JWT 格式：");
const sample = await jwtHS256("k", { gf_1: "v" });
check(sample.split(".").length === 3, "三段结构", sample);
check(!/[+/=]/.test(sample), "用 base64url、无填充（不含 + / =）", sample);

console.log("升序排序（必须是字典序，跟文档的 TreeMap / sorted 一致）：");
// 生成器里的排序逻辑
const sortKeys = (keys) => keys.slice().sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
const { stdout: pySorted } = await run("python3", ["-c",
  "import json,sys; print(json.dumps(sorted(json.loads(sys.argv[1])), separators=(',',':')), end='')",
  JSON.stringify(["field_10", "field_2", "field_1", "field_5"])]);
const mineSorted = sortKeys(["field_10", "field_2", "field_1", "field_5"]);
check(JSON.stringify(mineSorted) === pySorted, "field_10 排在 field_2 之前（字典序，不是数值序）",
  `我们的 ${JSON.stringify(mineSorted)}\n      Python ${pySorted}`);

check(FORM_BASE === "https://jinshuju.net/f/", "表单链接前缀", FORM_BASE);

const failed = results.filter((x) => !x.ok);
console.log(`  —— ${results.length} 项，失败 ${failed.length} 项`);
process.exit(failed.length === 0 ? 0 : 1);
