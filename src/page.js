/**
 * 页面外壳模板 —— worker 与静态构建（scripts/build-static.mjs）共用。
 *
 * assets 三个地址：{ css, js, logo }。
 * worker 传 CDN 绝对地址；静态构建传相对路径。
 */

// 资源可能挂在 CDN 上，CSP 得把这些来源算进去
function assetOrigins(urls) {
  const out = new Set();
  for (const u of urls) {
    if (/^https?:\/\//.test(String(u || ""))) {
      try { out.add(new URL(u).origin); } catch { /* 忽略非法地址 */ }
    }
  }
  return [...out];
}

// 正文来自 open-doc 仓库，万一被写进 javascript: 链接或外部脚本，CSP 是第二道闸
// （第一道是 public/app.js 里的链接协议白名单）
function csp({ css, js, logo }) {
  const extra = assetOrigins([css, js, logo]);
  const src = ["'self'", ...extra].join(" ");
  return [
    "default-src 'self'",
    `script-src ${src}`,
    `style-src ${src} 'unsafe-inline'`,
    "img-src 'self' data: https:",
    `connect-src 'self' https://jinshuju.net`,
    "font-src 'self' data:",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join("; ");
}

export function renderPage({ css, js, logo }) {
  return `<!doctype html>
<html lang="zh-CN" data-theme="light">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="${csp({ css, js, logo })}">
<meta name="referrer" content="strict-origin-when-cross-origin">
<title>金数据开放平台 · API</title>
<meta name="description" content="金数据开放平台 API v1 文档，正文与 open.jinshuju.net 一致，并支持在线调试与生成请求代码。">
<link rel="stylesheet" href="${css}">
</head>
<body>

<header class="navbar">
  <div class="navbar__inner">
    <div class="navbar__items">
      <a class="navbar__brand" href="#/">
        <img class="navbar__logo" src="${logo}" alt="金数据">
        <b class="navbar__title">金数据开放平台</b>
      </a>
      <a class="navbar__link navbar__link--active" href="#/">文档</a>
    </div>
    <div class="navbar__items navbar__items--right">
      <a class="navbar__link" href="https://jinshuju.net" target="_blank" rel="noopener">金数据首页<svg width="13" height="13" aria-hidden="true" viewBox="0 0 24 24" class="ext-icon"><path fill="currentColor" d="M21 13v10h-21v-19h12v2h-10v15h17v-8h2zm3-12h-10.988l4.035 4-6.977 7.07 2.828 2.828 6.977-7.07 4.125 4.172v-11z"/></svg></a>
      <button class="clean-btn" id="btn-theme" title="切换主题"></button>
    </div>
  </div>
</header>

<div class="layout" id="layout">

  <aside class="sidebar">
    <div class="search-wrap">
      <div class="search-box">
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7">
          <circle cx="7" cy="7" r="4.6"/><path d="M10.5 10.5L14 14"/>
        </svg>
        <input id="search" type="text" placeholder="搜索接口" autocomplete="off" spellcheck="false">
        <kbd>⌘K</kbd>
      </div>
    </div>
    <div class="menu" id="menu"></div>
    <div class="resize-handle resize-sidebar" id="resize-sidebar" role="separator" aria-label="调整目录宽度" aria-orientation="vertical" tabindex="0"></div>
  </aside>

  <main class="main" id="main">
    <div class="main-inner">
      <div class="container" id="doc"></div>
      <aside class="toc" id="toc"></aside>
    </div>
  </main>

  <button class="runner-backdrop" id="runner-backdrop" type="button" aria-label="关闭在线运行"></button>

  <aside class="runner" aria-label="在线运行浮窗">
    <div class="resize-handle resize-runner" id="resize-runner" role="separator" aria-label="调整在线运行宽度" aria-orientation="vertical" tabindex="0"></div>
    <div class="runner-top">
      <h2>在线运行</h2>
      <button class="clean-btn" id="btn-close-runner" title="收起">
        <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7">
          <path d="M4 4l8 8M12 4l-8 8"/>
        </svg>
      </button>
    </div>
    <div class="runner-scroll" id="runner-scroll"></div>
    <div class="resize-handle resize-runner-split" id="resize-runner-split" role="separator" aria-label="调整请求与结果区域高度" aria-orientation="horizontal" tabindex="0"></div>
    <div class="runner-out">
      <div class="tabs" id="out-tabs"></div>
      <div class="out-pane" id="out-pane"></div>
    </div>
  </aside>

</div>

<div class="modal-root" id="modal-root" hidden></div>
<div class="toast" id="toast"></div>
<script src="${js}"></script>
</body>
</html>`;
}
