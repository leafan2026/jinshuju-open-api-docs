# 金数据开放平台 · API 文档站

**正文完全沿用 open.jinshuju.net 的原文与排版**，在其上增加两件事：右侧可以真实发请求的「在线运行」面板，以及按当前参数实时生成的多语言请求代码。

覆盖 API v1 全部 19 个接口 + 4 篇开发指南 + 3 份 Schema。

线上地址：<https://lf.run.jinapp.net/jinshuju-open-api-docs/>

## 设计基线

配色、字体、正文排版直接取自 open.jinshuju.net 的设计令牌（`--gd-*`）与 Docusaurus 主题规则，
所以 h1/h2/h3 的字号与间距、表格圆角与行高、代码块边框、引用块样式都与原站一致：

| 令牌 | 亮色 | 暗色 |
| --- | --- | --- |
| accent | `#e0483f` | `#ff8078` |
| bg / bg-subtle / surface | `#fff` / `#fbfaf9` / `#f4f3f1` | `#101012` / `#17171b` / `#212127` |
| ink / ink-soft / ink-muted | `#1e1c1a` / `#47443f` / `#918f8a` | `#f2f1ef` / `#c9c7c3` / `#79756e` |
| border / border-strong | `#e8e6e2` / `#d5d2cc` | `#2b2b32` / `#3d3d47` |

## 功能

- 三栏布局：目录 / 原文正文（52rem 栏宽）/ 在线运行；没有环境切换器（只有一个正式环境）
- `⌘K` 聚焦搜索，按接口名、路径、说明实时过滤目录
- 正文即原文：可用套餐表、认证方式、headers 设置、接口说明、Request/Response 参数表、错误响应、原站示例代码，全部保留
- 站内互链改写为 hash 路由，点「表单设置 Schema」「V1 Basic 认证方式」不会跳出站
- 右侧「在线运行」：填 API_KEY / API_SECRET → 填 Path / Query / Body → 发送 → 真实响应（状态码 + 耗时）
- 「请求代码」标签页：cURL / JavaScript / Node.js / Python / PHP / Ruby / Java / Go 八种，随输入实时更新，可直接复制运行
- 亮/暗色主题切换，偏好存 localStorage

## 目录结构

```
├── src/
│   ├── index.js              # Worker：页面 / data.json / _proxy 代理
│   └── data/
│       ├── endpoints.json    # 19 个接口：正文 markdown + 供测试面板用的参数元数据
│       └── guides.json       # 概览 / 认证 / 状态码 / 请求速率 + Field / 表单设置 / 数据 Schema
├── public/                   # 静态资源，部署时上传到 CDN
│   ├── app.css
│   └── app.js                # 前端（原生 JS，无框架、无构建）
└── wrangler.jsonc
```

## 怎么改内容

**所有文档内容都在 `src/data/` 里，改 JSON 就行，不用碰前端代码。**

`endpoints.json` 每一项分两部分——`markdown` 是页面正文（原文照搬，渲染出来就是文档），
其余字段只给右侧测试面板生成表单和代码用：

```jsonc
{
  "id": "get_forms",              // 唯一 id，也是 URL hash：#/endpoint/get_forms
  "group": "表单",                 // 目录分组
  "name": "获取表单列表",           // 目录里显示的名字
  "method": "GET",
  "path": "/api/v1/forms",

  "markdown": "# v1 API 获取表单列表\n> …",   // ← 正文，改这里就改文档

  // 以下仅供「在线运行」面板：
  "pathParams":  [{ "name": "FORM_TOKEN", "type": "String", "required": true, "desc": "表单 Token" }],
  "queryParams": [{ "name": "q", "type": "String", "required": false, "default": null, "desc": "…" }],
  "bodyParams":  [{ "name": "name", "type": "String", "required": true, "desc": "…" }],
  "requestExample":  "{ … }"      // Body 编辑器的初始内容
}
```

`guides.json` 每一项：`{ "id", "group", "name", "markdown" }`。

markdown 里的站内链接请写成 hash 形式：`#/endpoint/<slug>`、`#/guide/authentication`、
`#/guide/schema_field`、`#/guide/schema_form_setting`、`#/guide/schema_entry`、`#/guide/overview`。

支持的 markdown 语法：标题、段落、有序/无序列表（含一层嵌套）、表格（含 `\|` 转义）、
带语言标记的代码块、引用块、加粗、行内代码、链接、分隔线。

改完直接部署，无需构建步骤。

## 部署

需要 Node ≥ 22。

```bash
npm install
npm install -g @wdl-dev/cli

export WDL_NS=lf
export ADMIN_TOKEN=<租户 token>
export CONTROL_URL=https://admin-run.jinapp.net

wdl deploy .
```

或把这三个变量写进 `.env`（参考 `.env.example`，`.env` 已被 gitignore）。

其他常用命令：

```bash
wdl whoami        # 确认当前 namespace / 控制面
wdl workers       # 查看已部署的 worker
wdl tail jinshuju-open-api-docs   # 实时日志
```

## 在线运行的安全边界

`POST /_proxy` 是纯转发，服务端不存储任何凭据：

- 只允许转发到 `https://jinshuju.net`，且路径必须以 `/api/v1/` 开头
- 方法白名单 GET / POST / PUT / PATCH / DELETE
- 拒绝路径中的 `..` 和换行符（防注入）
- 请求体和响应体上限 512 KB
- API Key / Secret 只随单次请求转发，不写日志、不落库；浏览器端存在 `sessionStorage`，关闭标签页即失效

需要更严格的话，可以在 `src/index.js` 的 `proxy()` 里加 IP 限流或改成必须登录才能调试。

另外注意：「请求代码」里会把你填入的真实 API_KEY / API_SECRET 内联进代码方便直接跑，
所以复制出去的片段包含明文凭据，不要贴到公共渠道。

## 内容来源

正文抓取自 <https://open.jinshuju.net/api_v1/>（2026-07 快照），排版与措辞保持原样。
上游文档更新后，改 `src/data/*.json` 对应条目的 `markdown` 即可。
