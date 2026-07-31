/* 金数据开放平台 · API 文档站前端
 * 无框架，原生 JS。数据来自同源的 /data.json，在线运行走同源的 /_proxy。
 */
(function () {
  "use strict";

  var API_BASE = "https://jinshuju.net";
  var GROUP_ORDER = ["开发指南", "表单", "文件夹", "数据", "账户", "Schema"];
  // Worker 挂在 /<worker-name>/ 前缀下，所有同源请求都要带上这个前缀
  var SITE = location.pathname.endsWith("/") ? location.pathname : location.pathname + "/";

  var state = {
    endpoints: [],
    guides: [],
    current: null, // { kind: 'endpoint'|'guide', item }
    filter: "",
    runnerOpen: true,
    creds: { key: "", secret: "" },
    sending: false,
  };

  /* ---------------- 工具 ---------------- */

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }
  function el(id) { return document.getElementById(id); }
  function h(html) { var t = document.createElement("template"); t.innerHTML = html.trim(); return t.content.firstElementChild; }

  var toastTimer;
  function toast(msg) {
    var t = el("toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove("show"); }, 1800);
  }

  function copy(text, label) {
    navigator.clipboard.writeText(text).then(
      function () { toast((label || "内容") + "已复制"); },
      function () { toast("复制失败"); }
    );
  }

  /* ---------------- 高亮 ---------------- */

  function highlightJson(src) {
    var out = "";
    var re = /("(?:\\.|[^"\\])*")(\s*:)?|(\btrue\b|\bfalse\b|\bnull\b)|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|([{}\[\],])/g;
    var last = 0, m;
    while ((m = re.exec(src)) !== null) {
      out += esc(src.slice(last, m.index));
      if (m[1] !== undefined) {
        out += m[2]
          ? '<span class="tok-key">' + esc(m[1]) + "</span>" + esc(m[2])
          : '<span class="tok-str">' + esc(m[1]) + "</span>";
      } else if (m[3] !== undefined) {
        out += '<span class="tok-bool">' + esc(m[3]) + "</span>";
      } else if (m[4] !== undefined) {
        out += '<span class="tok-num">' + esc(m[4]) + "</span>";
      } else {
        out += '<span class="tok-punc">' + esc(m[5]) + "</span>";
      }
      last = re.lastIndex;
    }
    out += esc(src.slice(last));
    return out;
  }

  function codeBlock(src, lang) {
    var body = /^\s*[\[{]/.test(src) || lang === "json" ? highlightJson(src) : esc(src);
    return '<pre class="code"><code>' + body + "</code></pre>";
  }

  /* ---------------- 极简 Markdown ---------------- */

  function inlineMd(s) {
    return esc(s)
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  }

  function renderMarkdown(md) {
    var lines = String(md || "").split("\n");
    var out = [], i = 0;

    function flushList(tag, items) {
      out.push("<" + tag + ">" + items.map(function (x) { return "<li>" + inlineMd(x) + "</li>"; }).join("") + "</" + tag + ">");
    }

    while (i < lines.length) {
      var line = lines[i];

      // 代码块
      var fence = line.match(/^\s*```(\w*)\s*$/);
      if (fence) {
        var lang = fence[1], buf = [];
        i++;
        while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) { buf.push(lines[i]); i++; }
        i++;
        out.push(codeBlock(buf.join("\n").replace(/[ \t]+$/gm, ""), lang));
        continue;
      }

      // 表格
      if (/^\s*\|/.test(line) && i + 1 < lines.length && /^\s*\|[\s:\-|]+\|\s*$/.test(lines[i + 1])) {
        var cells = function (l) {
          return l.trim().replace(/^\||\|$/g, "").split("|").map(function (c) { return c.trim(); });
        };
        var head = cells(line);
        i += 2;
        var rows = [];
        while (i < lines.length && /^\s*\|/.test(lines[i])) { rows.push(cells(lines[i])); i++; }
        out.push(
          "<table><thead><tr>" + head.map(function (c) { return "<th>" + inlineMd(c) + "</th>"; }).join("") +
          "</tr></thead><tbody>" +
          rows.map(function (r) {
            return "<tr>" + r.map(function (c) { return "<td>" + inlineMd(c) + "</td>"; }).join("") + "</tr>";
          }).join("") + "</tbody></table>"
        );
        continue;
      }

      // 标题
      var hd = line.match(/^(#{1,6})\s+(.*)$/);
      if (hd) {
        var lvl = Math.min(hd[1].length, 4);
        out.push("<h" + lvl + ">" + inlineMd(hd[2].replace(/\s*\u200b?$/, "")) + "</h" + lvl + ">");
        i++;
        continue;
      }

      // 引用
      if (/^\s*>\s?/.test(line)) {
        var q = [];
        while (i < lines.length && /^\s*>\s?/.test(lines[i])) { q.push(lines[i].replace(/^\s*>\s?/, "")); i++; }
        out.push("<blockquote>" + renderMarkdown(q.join("\n")) + "</blockquote>");
        continue;
      }

      // 无序列表
      if (/^\s*[-*]\s+/.test(line)) {
        var ul = [];
        while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) { ul.push(lines[i].replace(/^\s*[-*]\s+/, "")); i++; }
        flushList("ul", ul);
        continue;
      }

      // 有序列表
      if (/^\s*\d+\.\s+/.test(line)) {
        var ol = [];
        while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) { ol.push(lines[i].replace(/^\s*\d+\.\s+/, "")); i++; }
        flushList("ol", ol);
        continue;
      }

      // 段落
      if (line.trim() === "") { i++; continue; }
      var p = [];
      while (i < lines.length && lines[i].trim() !== "" && !/^\s*(#{1,6}\s|[-*]\s|\d+\.\s|>|\||```)/.test(lines[i])) {
        p.push(lines[i]); i++;
      }
      out.push("<p>" + inlineMd(p.join(" ")) + "</p>");
    }
    return out.join("\n");
  }

  /* ---------------- 侧边栏 ---------------- */

  function groupsOf() {
    var map = {};
    state.guides.forEach(function (g) {
      var k = g.group || "开发指南";
      (map[k] = map[k] || []).push({ kind: "guide", item: g });
    });
    state.endpoints.forEach(function (e) {
      (map[e.group] = map[e.group] || []).push({ kind: "endpoint", item: e });
    });
    return GROUP_ORDER.filter(function (g) { return map[g]; }).map(function (g) {
      return { name: g, entries: map[g] };
    }).concat(
      Object.keys(map).filter(function (g) { return GROUP_ORDER.indexOf(g) === -1; })
        .map(function (g) { return { name: g, entries: map[g] }; })
    );
  }

  function matches(entry, q) {
    if (!q) return true;
    var it = entry.item;
    var hay = [it.name, it.id, it.path, it.method, it.description].filter(Boolean).join(" ").toLowerCase();
    return hay.indexOf(q) !== -1;
  }

  function renderNav() {
    var nav = el("nav");
    var q = state.filter.trim().toLowerCase();
    nav.innerHTML = "";
    var any = false;

    groupsOf().forEach(function (g) {
      var entries = g.entries.filter(function (e) { return matches(e, q); });
      if (!entries.length) return;
      any = true;

      var group = h('<div class="nav-group"></div>');
      var head = h(
        '<button class="nav-group-head"><span>' + esc(g.name) + "</span>" +
        '<svg class="chev" width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6">' +
        '<path d="M4 6l4 4 4-4"/></svg></button>'
      );
      var items = h('<div class="nav-items"></div>');
      head.addEventListener("click", function () { group.classList.toggle("collapsed"); });

      entries.forEach(function (e) {
        var it = e.item;
        var isCur = state.current && state.current.item.id === it.id && state.current.kind === e.kind;
        var btn = h(
          '<button class="nav-item' + (isCur ? " active" : "") + '">' +
          (e.kind === "endpoint"
            ? '<span class="label">' + esc(it.name) + "</span>" +
              '<span class="method ' + it.method.toLowerCase() + '">' + esc(it.method) + "</span>"
            : '<span class="label">' + esc(it.name) + "</span>") +
          "</button>"
        );
        btn.addEventListener("click", function () {
          location.hash = "#/" + e.kind + "/" + it.id;
        });
        items.appendChild(btn);
      });

      group.appendChild(head);
      group.appendChild(items);
      nav.appendChild(group);
    });

    if (!any) nav.appendChild(h('<div class="nav-empty">没有匹配的接口</div>'));
  }

  /* ---------------- 文档区 ---------------- */

  function paramCard(title, list, opts) {
    if (!list || !list.length) return "";
    opts = opts || {};
    var rows = list.map(function (p) {
      var flag = p.required
        ? '<span class="param-flag required">必需</span>'
        : '<span class="param-flag optional">可选</span>';
      var meta = [];
      if (p.default != null && p.default !== "") meta.push('默认值: <span class="chip">' + esc(p.default) + "</span>");
      if (p.enum && p.enum.length) {
        meta.push("枚举值: " + p.enum.slice(0, 40).map(function (v) { return '<span class="chip">' + esc(v) + "</span>"; }).join(" "));
      }
      return '<div class="param">' +
        '<div class="param-head"><span class="param-name">' + esc(p.name) + "</span>" +
        '<span class="param-type">' + esc(p.type || "string") + "</span>" + flag + "</div>" +
        (p.desc ? '<div class="param-desc">' + inlineMd(p.desc) + "</div>" : "") +
        (meta.length ? '<div class="param-meta">' + meta.join("　") + "</div>" : "") +
        "</div>";
    }).join("");

    return '<div class="card"><div class="card-head">' + esc(title) +
      (opts.tag ? '<span class="tag">' + esc(opts.tag) + "</span>" : "") +
      (opts.required ? '<span class="tag req">必填</span>' : "") +
      "</div>" + rows + "</div>";
  }

  var AUTH_HEADERS = [
    { name: "Authorization", type: "string", required: true, desc: "HTTP Basic 认证。值为 `Basic ` + base64(API_KEY:API_SECRET)" },
    { name: "Content-Type", type: "string", required: true, desc: "固定为 application/json", default: "application/json" },
    { name: "Accept", type: "string", required: true, desc: "固定为 application/json", default: "application/json" },
  ];

  function renderEndpoint(e) {
    var hasBody = ["POST", "PUT", "PATCH"].indexOf(e.method) !== -1;
    var html = "";

    html += '<div class="doc-topbar">' +
      '<span class="breadcrumb">' + esc(e.group) + "</span>" +
      '<div class="doc-actions">' +
      '<button class="btn" data-act="copy-page">复制页面</button>' +
      '<button class="btn" data-act="toggle-runner">在线运行</button>' +
      "</div></div>";

    html += '<h1 class="doc-title">' + esc(e.name) + "</h1>";
    html += '<div class="env-line">' +
      '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4">' +
      '<circle cx="8" cy="8" r="6.3"/><path d="M1.7 8h12.6M8 1.7c1.7 2 2.6 4 2.6 6.3s-.9 4.3-2.6 6.3c-1.7-2-2.6-4-2.6-6.3s.9-4.3 2.6-6.3z"/></svg>' +
      "正式环境 · " + esc(API_BASE) + "</div>";

    html += '<div class="endpoint-bar">' +
      '<span class="method ' + e.method.toLowerCase() + '">' + esc(e.method) + "</span>" +
      '<span class="path">' + esc(e.path) + "</span>" +
      '<button class="btn copy" data-act="copy-url">复制</button></div>';

    if (e.description) html += '<div class="doc-desc">' + inlineMd(e.description) + "</div>";

    html += '<h2 class="section-title">请求参数</h2>';
    html += paramCard("Header 参数", AUTH_HEADERS);
    html += paramCard("Path 参数", e.pathParams);
    html += paramCard("Query 参数", e.queryParams);
    if (e.bodyParams && e.bodyParams.length) {
      html += paramCard("Body 参数", e.bodyParams, {
        tag: e.id === "create_entry_attachment" ? "multipart/form-data" : "application/json",
        required: e.bodyParams.some(function (p) { return p.required; }),
      });
    }
    if (!e.pathParams.length && !e.queryParams.length && !(e.bodyParams || []).length) {
      html += '<div class="notes">该接口除认证 Header 外无其他请求参数。</div>';
    }

    if (e.requestExample) {
      html += '<h2 class="section-title">请求示例</h2>' + codeBlock(e.requestExample);
    }
    if (e.responseExample) {
      html += '<h2 class="section-title">返回响应</h2>' + codeBlock(e.responseExample, "json");
    }

    html += '<h2 class="section-title">示例代码</h2>' + codeBlock(curlFor(e), "bash");

    if (e.notes) {
      html += '<h2 class="section-title">补充说明</h2><div class="md">' + renderMarkdown(e.notes) + "</div>";
    }
    return html;
  }

  function curlFor(e) {
    var lines = ['curl -X ' + e.method + ' "' + API_BASE + e.path + '" \\'];
    lines.push('  -u "$API_KEY:$API_SECRET" \\');
    lines.push('  -H "Content-Type: application/json" \\');
    var last = '  -H "Accept: application/json"';
    if (["POST", "PUT", "PATCH"].indexOf(e.method) !== -1 && e.requestExample && /^\s*[{[]/.test(e.requestExample)) {
      lines.push(last + " \\");
      lines.push("  -d '" + e.requestExample.replace(/\s*\n\s*/g, "") + "'");
    } else {
      lines.push(last);
    }
    return lines.join("\n");
  }

  function renderGuide(g) {
    return '<div class="doc-topbar"><span class="breadcrumb">' + esc(g.group) + "</span>" +
      '<div class="doc-actions"><button class="btn" data-act="copy-page">复制页面</button></div></div>' +
      '<div class="md">' + renderMarkdown(g.markdown || "") + "</div>";
  }

  /* ---------------- 在线运行面板 ---------------- */

  function renderRunner(e) {
    var body = el("runner-body");
    var app = el("app");

    if (!e) { app.classList.remove("runner-open"); return; }
    if (state.runnerOpen) app.classList.add("runner-open");

    var html = "";
    html += '<div class="url-bar">' +
      '<span class="method ' + e.method.toLowerCase() + '">' + esc(e.method) + "</span>" +
      '<span class="url" id="run-url">' + esc(API_BASE + e.path) + "</span>" +
      '<button class="btn primary" id="btn-send">发 送</button></div>';

    html += '<div class="runner-section"><h4>认证 <span class="hint">Basic Auth · 仅在本次浏览器会话中保留</span></h4>' +
      '<div class="field-row"><label>API_KEY<span class="star">*</span></label>' +
      '<input class="inp" id="in-key" type="text" placeholder="你的 API Key" autocomplete="off"></div>' +
      '<div class="field-row"><label>API_SECRET<span class="star">*</span></label>' +
      '<input class="inp" id="in-secret" type="password" placeholder="你的 API Secret" autocomplete="off"></div>' +
      '<div class="auth-note">在 <a href="https://next.jinshuju.net/profile/api" target="_blank" rel="noopener">个人中心 → API</a> ' +
      '或 <a href="https://next.jinshuju.net/system/api_licence" target="_blank" rel="noopener">系统设置 → 企业 API</a> 获取。' +
      "凭据只随本次请求经服务端转发到 jinshuju.net，不落盘、不记录。</div></div>";

    if (e.pathParams && e.pathParams.length) {
      html += '<div class="runner-section"><h4>Path 参数</h4>' +
        e.pathParams.map(function (p) {
          return '<div class="field-row"><label title="' + esc(p.name) + '">' + esc(p.name) +
            (p.required ? '<span class="star">*</span>' : "") + "</label>" +
            '<input class="inp" data-path-param="' + esc(p.name) + '" placeholder="' + esc(p.name) + '"></div>';
        }).join("") + "</div>";
    }

    if (e.queryParams && e.queryParams.length) {
      html += '<div class="runner-section"><h4>Query 参数</h4>' +
        e.queryParams.map(function (p) {
          return '<div class="field-row"><label title="' + esc(p.name) + '">' + esc(p.name) +
            (p.required ? '<span class="star">*</span>' : "") + "</label>" +
            '<input class="inp" data-query-param="' + esc(p.name) + '" placeholder="' +
            esc(p.default != null ? p.default : "") + '"></div>';
        }).join("") + "</div>";
    }

    if (["POST", "PUT", "PATCH"].indexOf(e.method) !== -1) {
      if (e.id === "create_entry_attachment") {
        html += '<div class="runner-section"><h4>Body</h4>' +
          '<div class="auth-note">该接口为 multipart/form-data 文件上传，在线运行暂不支持，请参考上方示例代码。</div></div>';
      } else {
        var init = e.requestExample && /^\s*[{[]/.test(e.requestExample) ? e.requestExample : "{\n  \n}";
        html += '<div class="runner-section"><h4>Body <span class="hint">JSON</span></h4>' +
          '<textarea class="inp" id="in-body" spellcheck="false">' + esc(init) + "</textarea></div>";
      }
    }

    body.innerHTML = html;

    var kIn = el("in-key"), sIn = el("in-secret");
    kIn.value = state.creds.key;
    sIn.value = state.creds.secret;
    kIn.addEventListener("input", function () { state.creds.key = kIn.value; persistCreds(); });
    sIn.addEventListener("input", function () { state.creds.secret = sIn.value; persistCreds(); });

    body.querySelectorAll("[data-path-param],[data-query-param]").forEach(function (n) {
      n.addEventListener("input", updateRunUrl);
    });
    var sendBtn = el("btn-send");
    if (e.id === "create_entry_attachment") { sendBtn.disabled = true; sendBtn.title = "文件上传接口不支持在线运行"; }
    else sendBtn.addEventListener("click", send);

    updateRunUrl();
    setResponse(null);
  }

  function persistCreds() {
    try {
      sessionStorage.setItem("jsj_api_creds", JSON.stringify(state.creds));
    } catch (err) { /* 忽略 */ }
  }
  function loadCreds() {
    try {
      var v = JSON.parse(sessionStorage.getItem("jsj_api_creds") || "{}");
      state.creds.key = v.key || "";
      state.creds.secret = v.secret || "";
    } catch (err) { /* 忽略 */ }
  }

  function buildPath() {
    var e = state.current && state.current.kind === "endpoint" ? state.current.item : null;
    if (!e) return "";
    var p = e.path;
    document.querySelectorAll("[data-path-param]").forEach(function (n) {
      var name = n.getAttribute("data-path-param");
      if (n.value.trim()) p = p.split(name).join(encodeURIComponent(n.value.trim()));
    });
    var qs = [];
    document.querySelectorAll("[data-query-param]").forEach(function (n) {
      if (n.value.trim()) qs.push(encodeURIComponent(n.getAttribute("data-query-param")) + "=" + encodeURIComponent(n.value.trim()));
    });
    return p + (qs.length ? "?" + qs.join("&") : "");
  }

  function updateRunUrl() {
    var u = el("run-url");
    if (u) u.textContent = API_BASE + buildPath();
  }

  function setResponse(res) {
    var head = el("resp-head"), body = el("resp-body");
    if (!res) {
      head.innerHTML = '<span>返回结果</span>';
      body.innerHTML = '<div class="resp-empty">' +
        '<svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3">' +
        '<path d="M4.5 19.5l4-1.5 7-7a2.1 2.1 0 10-3-3l-7 7-1 4z"/><path d="M13 5.5l5.5 5.5"/></svg>' +
        '<div>点击「发送」按钮获取返回结果</div></div>';
      return;
    }
    if (res.error) {
      head.innerHTML = '<span>返回结果</span><span class="status-pill err">失败</span>';
      body.innerHTML = codeBlock(res.error);
      return;
    }
    var ok = res.status >= 200 && res.status < 300;
    head.innerHTML = '<span>返回结果</span>' +
      '<span class="status-pill ' + (ok ? "ok" : "err") + '">' + res.status + " " + esc(res.statusText || "") + "</span>" +
      '<span style="margin-left:auto">' + res.durationMs + " ms</span>";
    var text = res.body || "";
    try { text = JSON.stringify(JSON.parse(text), null, 2); } catch (err) { /* 非 JSON 原样显示 */ }
    body.innerHTML = codeBlock(text, "json");
  }

  function send() {
    if (state.sending) return;
    var e = state.current.item;
    if (!state.creds.key || !state.creds.secret) { toast("请先填写 API_KEY 和 API_SECRET"); return; }

    var payload = { method: e.method, path: buildPath(), apiKey: state.creds.key, apiSecret: state.creds.secret };
    var bodyEl = el("in-body");
    if (bodyEl && bodyEl.value.trim()) {
      try { JSON.parse(bodyEl.value); } catch (err) { toast("Body 不是合法 JSON"); return; }
      payload.body = bodyEl.value;
    }

    state.sending = true;
    var btn = el("btn-send");
    btn.disabled = true; btn.textContent = "发送中";
    el("resp-head").innerHTML = "<span>返回结果</span><span>请求中…</span>";

    fetch(SITE + "_proxy", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })
      .then(function (r) { return r.json(); })
      .then(setResponse)
      .catch(function (err) { setResponse({ error: String(err) }); })
      .finally(function () {
        state.sending = false;
        btn.disabled = false; btn.textContent = "发 送";
      });
  }

  /* ---------------- 路由 ---------------- */

  function resolve() {
    var m = location.hash.match(/^#\/(endpoint|guide)\/([\w.-]+)$/);
    if (m) {
      var list = m[1] === "endpoint" ? state.endpoints : state.guides;
      var found = list.filter(function (x) { return x.id === m[2]; })[0];
      if (found) return { kind: m[1], item: found };
    }
    return { kind: "guide", item: state.guides[0] };
  }

  function route() {
    state.current = resolve();
    var doc = el("doc");
    if (state.current.kind === "endpoint") {
      doc.innerHTML = renderEndpoint(state.current.item);
      renderRunner(state.current.item);
    } else {
      doc.innerHTML = renderGuide(state.current.item);
      el("app").classList.remove("runner-open");
    }
    el("content").scrollTop = 0;
    document.title = state.current.item.name + " | 金数据开放平台";
    renderNav();

    doc.querySelectorAll("[data-act]").forEach(function (n) {
      n.addEventListener("click", function () {
        var act = n.getAttribute("data-act");
        if (act === "copy-url") copy(API_BASE + state.current.item.path, "接口地址");
        else if (act === "copy-page") copy(doc.innerText, "页面内容");
        else if (act === "toggle-runner") {
          state.runnerOpen = !el("app").classList.contains("runner-open");
          el("app").classList.toggle("runner-open", state.runnerOpen);
        }
      });
    });
  }

  /* ---------------- 主题 ---------------- */

  function applyTheme(t) {
    document.documentElement.setAttribute("data-theme", t);
    try { localStorage.setItem("jsj_theme", t); } catch (err) { /* 忽略 */ }
    el("btn-theme").innerHTML = t === "dark"
      ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M20 14.5A8.2 8.2 0 019.5 4 8.5 8.5 0 1020 14.5z"/></svg>'
      : '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="12" cy="12" r="4.2"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.2 5.2l1.4 1.4M17.4 17.4l1.4 1.4M18.8 5.2l-1.4 1.4M6.6 17.4l-1.4 1.4"/></svg>';
  }

  /* ---------------- 启动 ---------------- */

  function init() {
    var saved = "light";
    try { saved = localStorage.getItem("jsj_theme") || "light"; } catch (err) { /* 忽略 */ }
    applyTheme(saved);
    el("btn-theme").addEventListener("click", function () {
      applyTheme(document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark");
    });

    el("btn-close-runner").addEventListener("click", function () {
      state.runnerOpen = false;
      el("app").classList.remove("runner-open");
    });

    var search = el("search");
    search.addEventListener("input", function () { state.filter = search.value; renderNav(); });
    document.addEventListener("keydown", function (ev) {
      if ((ev.metaKey || ev.ctrlKey) && ev.key.toLowerCase() === "k") { ev.preventDefault(); search.focus(); search.select(); }
      if (ev.key === "Escape" && document.activeElement === search) { search.value = ""; state.filter = ""; renderNav(); search.blur(); }
    });

    loadCreds();
    window.addEventListener("hashchange", route);

    fetch(SITE + "data.json")
      .then(function (r) { return r.json(); })
      .then(function (d) {
        state.endpoints = d.endpoints || [];
        state.guides = d.guides || [];
        route();
      })
      .catch(function (err) {
        el("doc").innerHTML = '<div class="notes">文档数据加载失败：' + esc(String(err)) + "</div>";
      });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
