# 金数据开放平台 · API 文档站

**内容源就是 [`jinshuju/open-doc`](https://github.com/jinshuju/open-doc) 仓库里的 markdown**，本仓库只做渲染层：
沿用原站排版，在接口页右边加上真实可发请求的「在线运行」面板和多语言请求代码。

这里不存一份文档副本。改文档去 open-doc 改 `.md`，回来跑一次 `npm run data` 即可。

**这是个纯静态站，不需要任何服务端。** 金数据 API 自己开了 CORS：

```
access-control-allow-origin: *
access-control-allow-methods: GET, POST, PUT, PATCH, DELETE, OPTIONS
access-control-allow-headers: authorization,content-type
```

所以「在线运行」是浏览器直连 `jinshuju.net`，凭据从浏览器直接到金数据，不经任何第三方服务器。
`npm run build` 产出的 `dist/` 扔 GitHub Pages / OSS / Nginx 就能跑。

预览地址（跑在 WDL 上，只是个部署目标，不是依赖）：<https://lf.run.jinapp.net/jinshuju-open-api-docs/>

## 数据是怎么来的

```bash
npm run data                    # 默认读 ../open-doc
npm run data -- /path/to/open-doc
# 或 OPEN_DOC_REPO=/path/to/open-doc npm run data
```

`scripts/build-data.mjs` 读 open-doc 仓库，产出 `src/data/site.json`：

| 做的事 | 怎么做 |
| --- | --- |
| 还原导航树 | 直接 import 仓库的 `sidebars.ts`（Node 类型剥离），分组、顺序、嵌套（表单 › 视图）与原站完全一致 |
| 页面路由 | 用 docusaurus 的 URL 路径当 hash 路由，`/api_v1/endpoints/get_forms` → `#/api_v1/endpoints/get_forms`；识别 front-matter 的 `slug` |
| 站内链接 | `](/api_v1/authentication)` 一类绝对链接改写成 hash 路由，点击不跳出站；站外链接原样保留 |
| 本地图片 | `![](./images/x.png)` 复制到 `public/img/<分区>/` 并改写引用 |
| 接口元数据 | 从 `### Request` 代码块解析方法与路径（含 `PATCH/POST/PUT` 这种多方法写法），从紧随其后的参数表分出 Path / Query / Body，取第一段配平的 JSON 当 Body 初始值；识别 `multipart/form-data` 并标记为不可在线运行 |
| 正文 | md 原文照搬，不改写语义 |

当前覆盖：**51 篇文档，其中 25 个接口可在线运行**（含仓库里比线上多出的表单视图 6 个接口，以及 4 份 Schema）。
open-doc 里新增一个接口 md 并挂进 `sidebars.ts`，重跑一次就自动出现，不需要动这里的代码。

## 界面

四栏：目录 / 正文（52rem） / 本页总览 / 在线运行。窗口变窄时先收「本页总览」，再收目录。

- `⌘K` 聚焦搜索，按接口名、路径、方法过滤目录
- 「本页总览」跟随滚动高亮当前小节
- 「在线运行」：填 API_KEY / API_SECRET → 填 Path / Query / Body → 发送 → 真实响应（状态码 + 耗时）
- 支持多方法接口（如修改单条数据的 PATCH / POST / PUT）切换
- 在线运行默认作为停靠右栏适当压缩正文，保持“请求表单在上、返回结果 / 请求代码页签在下”的顺序；向左拖宽越过正文安全阈值后，自动切换为遮罩上的覆盖浮窗并可继续放大，缩回阈值内重新停靠，关闭后原页面布局不变
- 请求代码支持 cURL / JavaScript / Node.js / Python / PHP / Ruby / Java / Go，并随输入实时更新；只有凭据、必填参数和 JSON 均有效时，才生成已内联 `Authorization: Basic <Base64>`、`Content-Type: application/json`、`Accept: application/json` 三个标准请求头且可直接运行的稳定代码模板
- Body 是带语法高亮、行号、合法性校验（精确到行列）、一键格式化、全屏编辑的 JSON 编辑器
- 亮/暗色主题

## 设计基线

配色、字体、正文排版取自 open.jinshuju.net 的设计令牌（`--gd-*`）与 Docusaurus 主题规则，
h1/h2/h3 的字号与间距、h2 上方分隔线、表格圆角行高、代码块边框、引用块样式都与原站一致：

| 令牌 | 亮色 | 暗色 |
| --- | --- | --- |
| accent | `#e0483f` | `#ff8078` |
| bg / bg-subtle / surface | `#fff` / `#fbfaf9` / `#f4f3f1` | `#101012` / `#17171b` / `#212127` |
| ink / ink-soft / ink-muted | `#1e1c1a` / `#47443f` / `#918f8a` | `#f2f1ef` / `#c9c7c3` / `#79756e` |
| border / border-strong | `#e8e6e2` / `#d5d2cc` | `#2b2b32` / `#3d3d47` |

## 目录结构

```
├── scripts/
│   ├── build-data.mjs        # 从 open-doc 生成 site.json（唯一的数据入口）
│   └── build-static.mjs      # 产出纯静态 dist/
├── src/
│   ├── page.js               # 页面外壳模板，静态构建和 worker 共用
│   ├── index.js              # 可选的 Worker：页面 / data.json / _proxy 后备代理
│   └── data/site.json        # 生成物，不要手改
├── public/
│   ├── app.css
│   ├── app.js                # 前端（原生 JS，无框架、无打包）
│   └── img/                  # 从 open-doc 复制来的图片，生成物
└── wrangler.jsonc            # 只在用 WDL 部署时需要
```

## 部署

需要 Node ≥ 22（`--experimental-strip-types` 用来直接 import 仓库的 `sidebars.ts`）。

### 静态托管（推荐，无服务端）

```bash
npm run build                   # 默认读 ../open-doc → dist/
npm run build -- /path/to/open-doc
npm run build -- --out=public-dist   # 换输出目录
npm run preview                 # 本地起服务器看 dist/
```

`dist/` 直接扔任何静态托管就行。GitHub Pages 的话：

```yaml
# .github/workflows/deploy.yml
- uses: actions/setup-node@v4
  with: { node-version: 22 }
- run: |
    git clone --depth 1 https://github.com/leafan2026/open-doc.git ../open-doc
    npm ci && npm run build
- uses: actions/upload-pages-artifact@v3
  with: { path: dist }
```

产物里带了 `.nojekyll` 和 `404.html`（hash 路由用不上，刷新子路径时兜底）。

> `build-static.mjs` 会清空输出目录，所以它**只认 `--out=`，不接受位置参数**，
> 而且清空前会检查目录里有没有它自己的标记文件 `.build-static-output`——
> 非空且没有标记就直接报错退出，避免误删仓库。

### WDL Worker

**推送到 `main` 会自动部署**，见 `.github/workflows/deploy.yml`：
CI 里会 clone `leafan2026/open-doc`（公开）重新生成数据，再 `wdl deploy .`。
只需要在仓库 Settings → Secrets and variables → Actions 里配一个 secret：

| Secret | 说明 |
| --- | --- |
| `ADMIN_TOKEN` | WDL 控制面的租户 token |

`WDL_NS`（`lf`）和 `CONTROL_URL` 不敏感，直接写在 workflow 里。

手动部署：

```bash
npm install -g @wdl-dev/cli
export WDL_NS=lf ADMIN_TOKEN=<租户 token> CONTROL_URL=https://admin-run.jinapp.net
npm run deploy:wdl                   # 会先重新生成数据，需要本地有 ../open-doc
wdl deploy .                         # 数据已经生成好了就用这个
```

其他命令：`wdl whoami` / `wdl workers` / `wdl tail jinshuju-open-api-docs`。

## 在线运行怎么走的

默认**浏览器直连** `https://jinshuju.net/api/v1/*`，带 `Authorization: Basic base64(key:secret)`。
凭据只存在浏览器的 `sessionStorage`，关标签页即清除，不经过任何第三方服务器——这比走代理更安全。

万一哪天金数据收紧了 CORS，或者你需要走内网出口，才需要转发端点。在页面里加一行即可切换：

```html
<script>window.__JSJ_PROXY_URL__ = "https://your-host/_proxy";</script>
```

`src/index.js` 里的 `POST /_proxy` 就是一个现成实现：只允许转发到 `https://jinshuju.net`
且**规范化之后**的路径以 `/api/v1/` 开头（`%2e%2e` 这类写法会在校验前被 `new URL()` 还原，
所以必须先规范化再判断），方法白名单，拒绝路径里的换行符，
请求体与响应体上限 512 KB（先看 `Content-Length`，不等整包解析完），
上游 20 秒不响应就中断并返回 504，上游异常返回 502，不写日志、不落库。
它是标准 Cloudflare Workers module 格式，能原样跑在 Cloudflare / Vercel Edge 等任何地方，不绑 WDL。

**跨域默认是关的**：带 `Origin` 的请求只放行同源，其他来源直接 403——不然任何网站都能拿
这个端点当转发跳板打 `jinshuju.net`。要给别的域名用，就显式列出来：

| 变量 | 作用 |
| --- | --- |
| `PROXY_ALLOWED_ORIGINS` | 逗号分隔的来源白名单，如 `https://docs.example.com`；填 `*` 放行全部（不建议） |
| `PROXY_TOKEN` | 设了就要求请求带 `X-Proxy-Token`，给公网暴露的部署加一道门槛 |

两个都不设 = 只有自己这个站能用它，命令行调用（不带 `Origin`）仍然放行。

请求最多等 15 秒，超时自动中断；发送中按钮会变成「取消」，随时可以手动中止，
不会一直停在「发送中」。

一点提醒：「请求代码」会把填入的真实 Key / Secret 内联进代码方便直接跑，
所以复制出去的片段含明文凭据，别贴到公共渠道。
