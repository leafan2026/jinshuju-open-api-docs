# 金数据开放平台 · API 文档站

Apifox / 明道云开放平台风格的三栏交互式 API 文档：**左侧导航 · 中间文档 · 右侧在线运行**。
覆盖金数据 API v1 全部 19 个接口 + 5 篇开发指南，右侧面板可以填入自己的 API Key 真实发起请求。

线上地址：<https://lf.run.jinapp.net/jinshuju-open-api-docs/>

## 功能

- 三栏布局，接口按 表单 / 文件夹 / 数据 / 账户 分组，带 GET/POST/PATCH/DELETE 方法色标
- `⌘K` 聚焦搜索，按接口名、路径、说明实时过滤导航
- 参数区按 Header / Path / Query / Body 分卡片渲染，标注 必需·可选·默认值·枚举值
- 自动生成 curl 示例代码，一键复制接口地址或整页内容
- 右侧「在线运行」：填 API_KEY / API_SECRET → 填路径和查询参数 → 发送 → 看真实响应（状态码 + 耗时）
- 亮/暗色主题切换，偏好存 localStorage

## 目录结构

```
├── src/
│   ├── index.js              # Worker：页面 / data.json / _proxy 代理
│   └── data/
│       ├── endpoints.json    # 19 个接口的结构化定义（唯一内容源）
│       └── guides.json       # 概览 / 认证 / 状态码 / 请求速率 / Field Schema
├── public/                   # 静态资源，部署时上传到 CDN
│   ├── app.css
│   └── app.js                # 前端（原生 JS，无框架、无构建）
└── wrangler.jsonc
```

## 怎么改内容

**所有文档内容都在 `src/data/` 里，改 JSON 就行，不用碰前端代码。**

`endpoints.json` 每一项的结构：

```jsonc
{
  "id": "get_forms",              // 唯一 id，也是 URL hash：#/endpoint/get_forms
  "group": "表单",                 // 导航分组
  "name": "获取表单列表",
  "method": "GET",
  "path": "/api/v1/forms",
  "description": "……",
  "pathParams":  [{ "name": "FORM_TOKEN", "type": "String", "required": true, "desc": "表单 Token" }],
  "queryParams": [{ "name": "page", "type": "Integer", "required": false, "default": "1", "desc": "……" }],
  "bodyParams":  [{ "name": "name", "type": "String", "required": true, "desc": "……", "enum": null, "default": null }],
  "requestExample":  "{ … }",     // 请求示例原文，null 表示不显示该段
  "responseExample": "{ … }",
  "notes": "markdown 字符串"       // 渲染成「补充说明」，支持标题/列表/表格/代码块
}
```

`guides.json` 每一项：`{ "id", "group", "name", "markdown" }`，markdown 直接渲染成一个文档页。

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

## 内容来源

接口定义抓取整理自 <https://open.jinshuju.net/api_v1/all>（2026-07 快照）。
上游文档更新后，改 `src/data/endpoints.json` 对应条目即可。
