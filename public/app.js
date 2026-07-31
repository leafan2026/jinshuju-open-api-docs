/* 金数据开放平台 · API 文档站前端
 *
 * 内容源是 jinshuju/open-doc 仓库里的 markdown（由 scripts/build-data.mjs 生成 site.json），
 * 排版沿用原站；新增的只有右侧「在线运行」——真实发请求 + 生成多语言请求代码。
 */
(function () {
  "use strict";

  var API_BASE = "https://jinshuju.net";
  var SITE = location.pathname.endsWith("/") ? location.pathname : location.pathname + "/";
  // 留空 = 浏览器直连（默认）。想走转发就设 window.__JSJ_PROXY_URL__
  var PROXY_URL = (typeof window !== "undefined" && window.__JSJ_PROXY_URL__) || "";

  var LANGS = [
    { id: "curl", label: "cURL" },
    { id: "js", label: "JavaScript" },
    { id: "node", label: "Node.js" },
    { id: "python", label: "Python" },
    { id: "php", label: "PHP" },
    { id: "ruby", label: "Ruby" },
    { id: "java", label: "Java" },
    { id: "go", label: "Go" },
  ];

  var state = {
    nav: [],
    docs: {},
    order: [],
    current: null,
    filter: "",
    runnerOpen: true,
    creds: { key: "", secret: "" },
    tab: "result",
    lang: "curl",
    response: null,
    sending: false,
    collapsed: {},
    closeFullEditor: null,
  };

  /* ================= 工具 ================= */

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function unesc2(s) { return s.replace(/&amp;(lt|gt|amp|quot|#\d+);/g, "&$1;"); }
  function el(id) { return document.getElementById(id); }

  var toastTimer;
  function toast(msg) {
    var t = el("toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove("show"); }, 1700);
  }
  function copy(text, label) {
    navigator.clipboard.writeText(text).then(
      function () { toast((label || "内容") + "已复制"); },
      function () { toast("复制失败"); }
    );
  }

  /* ================= 语法高亮 ================= */

  function hlJson(src) {
    var out = "", last = 0, m;
    var re = /("(?:\\.|[^"\\])*")(\s*:)?|(\btrue\b|\bfalse\b|\bnull\b)|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|([{}\[\],])/g;
    while ((m = re.exec(src)) !== null) {
      out += esc(src.slice(last, m.index));
      if (m[1] !== undefined) {
        out += m[2] ? '<span class="tok-key">' + esc(m[1]) + "</span>" + esc(m[2])
                    : '<span class="tok-str">' + esc(m[1]) + "</span>";
      } else if (m[3] !== undefined) out += '<span class="tok-bool">' + esc(m[3]) + "</span>";
      else if (m[4] !== undefined) out += '<span class="tok-num">' + esc(m[4]) + "</span>";
      else out += '<span class="tok-punc">' + esc(m[5]) + "</span>";
      last = re.lastIndex;
    }
    return out + esc(src.slice(last));
  }

  function hlGeneric(src) {
    var out = "", last = 0, m;
    var re = /(#[^\n]*|\/\/[^\n]*)|('(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*")|(\b(?:GET|POST|PUT|PATCH|DELETE)\b)|(\b\d+\b)/g;
    while ((m = re.exec(src)) !== null) {
      out += esc(src.slice(last, m.index));
      if (m[1] !== undefined) out += '<span class="tok-cmt">' + esc(m[1]) + "</span>";
      else if (m[2] !== undefined) out += '<span class="tok-str">' + esc(m[2]) + "</span>";
      else if (m[3] !== undefined) out += '<span class="tok-bool">' + esc(m[3]) + "</span>";
      else out += '<span class="tok-num">' + esc(m[4]) + "</span>";
      last = re.lastIndex;
    }
    return out + esc(src.slice(last));
  }

  var LANG_LABEL = {
    json: "json", bash: "bash", shell: "bash", sh: "bash", text: "text", http: "http",
    python: "python", ruby: "ruby", java: "java", javascript: "javascript", js: "javascript",
    php: "php", go: "go", jsonc: "jsonc", yaml: "yaml", ts: "typescript", csharp: "csharp",
  };

  function codeBlock(src, lang, opts) {
    opts = opts || {};
    src = String(src == null ? "" : src).replace(/\s+$/, "");
    var isJson = lang === "json" || lang === "jsonc" || (!lang && /^\s*[[{]/.test(src));
    var body = isJson ? hlJson(src) : hlGeneric(src);
    var label = LANG_LABEL[lang] || lang || "text";
    var id = "cb" + (codeBlock._n = (codeBlock._n || 0) + 1);
    codeBlock.store = codeBlock.store || {};
    codeBlock.store[id] = src;
    return '<div class="code-block">' +
      '<div class="code-block-head"><span>' + esc(label) + '</span><span class="grow"></span>' +
      (opts.noCopy ? "" : '<button class="mini" data-copy="' + id + '">复制</button>') +
      "</div><pre><code>" + body + "</code></pre></div>";
  }

  /* ================= Markdown ================= */

  function inlineMd(s) {
    var out = unesc2(esc(s));
    var codes = [];
    out = out.replace(/`([^`]+)`/g, function (_, c) {
      codes.push(c);
      return "\u0000" + (codes.length - 1) + "\u0000";
    });
    out = out
      .replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+&quot;[^&]*&quot;)?\)/g, function (_, alt, src) {
        return '<img src="' + src + '" alt="' + alt + '" loading="lazy">';
      })
      .replace(/\*\*([^*]+)\*\*|__([^_]+)__/g, function (_, a, b) { return "<strong>" + (a || b) + "</strong>"; })
      .replace(/\\([\\`*_{}\[\]()#+\-.!|])/g, "$1")
      .replace(/\[([^\]]*)\]\(([^)\s]+)(?:\s+&quot;[^&]*&quot;)?\)/g, function (_, txt, href) {
        var ext = /^https?:/.test(href);
        return '<a href="' + href + '"' + (ext ? ' target="_blank" rel="noopener"' : "") + ">" + txt + "</a>";
      });
    out = out.replace(/\u0000(\d+)\u0000/g, function (_, i) {
      return "<code>" + unesc2(esc(codes[+i])) + "</code>";
    });
    return out;
  }

  var slugSeen = {};
  function slugify(text) {
    var base = text.toLowerCase().trim()
      .replace(/<[^>]*>/g, "")
      .replace(/[\s]+/g, "-")
      .replace(/[^\w\u4e00-\u9fa5-]/g, "");
    base = base || "section";
    if (slugSeen[base] === undefined) { slugSeen[base] = 0; return base; }
    slugSeen[base]++;
    return base + "-" + slugSeen[base];
  }

  // 渲染时顺带收集 h2/h3 供「本页总览」使用
  var tocItems = [];

  function renderMarkdown(md, topLevel) {
    var lines = String(md || "").split("\n");
    var out = [], i = 0;

    while (i < lines.length) {
      var line = lines[i];

      var fence = line.match(/^\s*```(\S*)\s*$/);
      if (fence) {
        var lang = fence[1] || "", buf = [];
        i++;
        while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) { buf.push(lines[i]); i++; }
        i++;
        out.push(codeBlock(buf.join("\n").replace(/[ \t]+$/gm, ""), lang));
        continue;
      }

      if (/^\s*\|/.test(line) && i + 1 < lines.length && /^\s*\|[\s:\-|]+\|\s*$/.test(lines[i + 1])) {
        var cut = function (l) {
          var t = l.trim().replace(/^\|/, "").replace(/\|$/, "");
          var parts = [], cur = "";
          for (var k = 0; k < t.length; k++) {
            if (t[k] === "\\" && t[k + 1] === "|") { cur += "|"; k++; }
            else if (t[k] === "|") { parts.push(cur); cur = ""; }
            else cur += t[k];
          }
          parts.push(cur);
          return parts.map(function (x) { return x.trim(); });
        };
        var head = cut(line);
        i += 2;
        var rows = [];
        while (i < lines.length && /^\s*\|/.test(lines[i])) { rows.push(cut(lines[i])); i++; }
        out.push('<div class="table-wrap"><table><thead><tr>' +
          head.map(function (c) { return "<th>" + inlineMd(c) + "</th>"; }).join("") +
          "</tr></thead><tbody>" +
          rows.map(function (r) {
            return "<tr>" + r.map(function (c) { return "<td>" + inlineMd(c) + "</td>"; }).join("") + "</tr>";
          }).join("") + "</tbody></table></div>");
        continue;
      }

      var hd = line.match(/^(#{1,6})\s+(.*)$/);
      if (hd) {
        var lv = Math.min(hd[1].length, 4);
        var txt = inlineMd(hd[2].trim());
        if (topLevel && (lv === 2 || lv === 3)) {
          var id = slugify(hd[2].trim());
          tocItems.push({ level: lv, id: id, text: hd[2].trim().replace(/[`*_]/g, "") });
          out.push("<h" + lv + ' id="' + id + '">' + txt + "</h" + lv + ">");
        } else {
          out.push("<h" + lv + ">" + txt + "</h" + lv + ">");
        }
        i++;
        continue;
      }

      if (/^\s*>\s?/.test(line)) {
        var q = [];
        while (i < lines.length && /^\s*>/.test(lines[i])) { q.push(lines[i].replace(/^\s*>\s?/, "")); i++; }
        out.push("<blockquote>" + renderMarkdown(q.join("\n"), false) + "</blockquote>");
        continue;
      }

      if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) { out.push("<hr>"); i++; continue; }

      if (/^\s*([-*+]|\d+\.)\s+/.test(line)) {
        var ordered = /^\s*\d+\./.test(line);
        var items = [], baseIndent = line.match(/^\s*/)[0].length;
        while (i < lines.length && /^\s*([-*+]|\d+\.)\s+/.test(lines[i])) {
          var ind = lines[i].match(/^\s*/)[0].length;
          var t2 = lines[i].replace(/^\s*([-*+]|\d+\.)\s+/, "");
          if (ind > baseIndent && items.length) {
            var host = items[items.length - 1];
            host.sub = host.sub || [];
            host.sub.push(t2);
          } else items.push({ txt: t2, sub: null });
          i++;
          while (i < lines.length && lines[i].trim() !== "" &&
                 !/^\s*([-*+]|\d+\.)\s+/.test(lines[i]) && !/^\s*(#|```|\||>)/.test(lines[i]) &&
                 lines[i].match(/^\s*/)[0].length > baseIndent) {
            items[items.length - 1].txt += " " + lines[i].trim();
            i++;
          }
        }
        var tag = ordered ? "ol" : "ul";
        out.push("<" + tag + ">" + items.map(function (it) {
          return "<li>" + inlineMd(it.txt) +
            (it.sub ? "<ul>" + it.sub.map(function (s) { return "<li>" + inlineMd(s) + "</li>"; }).join("") + "</ul>" : "") +
            "</li>";
        }).join("") + "</" + tag + ">");
        continue;
      }

      if (line.trim() === "") { i++; continue; }

      var p = [];
      while (i < lines.length && lines[i].trim() !== "" &&
             !/^\s*(#{1,6}\s|[-*+]\s|\d+\.\s|>|\||```|-{3,}$)/.test(lines[i])) {
        p.push(lines[i]); i++;
      }
      var html = inlineMd(p.join(" "));
      // 独立成段的图片不要包在 <p> 里
      out.push(/^<img[^>]*>$/.test(html) ? '<p class="img-only">' + html + "</p>" : "<p>" + html + "</p>");
    }
    return out.join("\n");
  }

  /* ================= 目录树 ================= */

  function eachDoc(items, fn) {
    items.forEach(function (it) {
      if (it.type === "category") eachDoc(it.items, fn);
      else fn(it);
    });
  }

  function hit(item, q) {
    if (!q) return true;
    var doc = state.docs[item.route] || {};
    return [item.name, doc.title, item.route, item.method, doc.api && doc.api.path]
      .filter(Boolean).join(" ").toLowerCase().indexOf(q) !== -1;
  }

  function menuHtml(items, depth, q) {
    var html = "", any = false;
    items.forEach(function (it) {
      if (it.type === "category") {
        var inner = menuHtml(it.items, depth + 1, q);
        if (!inner.any) return;
        any = true;
        var key = depth + ":" + it.label;
        var collapsed = state.collapsed[key] && !q;
        html += '<div class="menu-group d' + depth + (collapsed ? " collapsed" : "") + '" data-key="' + esc(key) + '">' +
          '<button class="menu-group-label"><span>' + esc(it.label) + "</span>" +
          '<svg class="caret" width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 6.5l4 4 4-4"/></svg>' +
          '</button><div class="menu-list">' + inner.html + "</div></div>";
      } else {
        if (!hit(it, q)) return;
        any = true;
        var on = state.current && state.current.route === it.route;
        html += '<button class="menu-link d' + depth + (on ? " active" : "") + '" data-go="' + esc(it.route) + '">' +
          '<span class="txt">' + esc(it.name) + "</span>" +
          (it.method ? '<span class="verb ' + it.method.toLowerCase() + '">' + esc(it.method) + "</span>" : "") +
          "</button>";
      }
    });
    return { html: html, any: any };
  }

  function renderMenu() {
    var menu = el("menu");
    var q = state.filter.trim().toLowerCase();
    var r = menuHtml(state.nav, 0, q);
    menu.innerHTML = r.any ? r.html : '<div class="menu-empty">没有匹配的内容</div>';

    menu.querySelectorAll(".menu-group-label").forEach(function (n) {
      n.addEventListener("click", function () {
        var g = n.parentElement.getAttribute("data-key");
        state.collapsed[g] = !state.collapsed[g];
        n.parentElement.classList.toggle("collapsed");
      });
    });
    menu.querySelectorAll("[data-go]").forEach(function (n) {
      n.addEventListener("click", function () { location.hash = "#/" + n.getAttribute("data-go"); });
    });
  }

  /* ================= 本页总览 ================= */

  function renderToc() {
    var box = el("toc");
    if (!tocItems.length) { box.innerHTML = ""; box.classList.add("empty"); return; }
    box.classList.remove("empty");
    box.innerHTML = '<div class="toc-inner"><div class="toc-title">本页总览</div><ul class="toc-list">' +
      tocItems.map(function (t) {
        return '<li class="lv' + t.level + '"><a href="#" data-toc="' + esc(t.id) + '">' + esc(t.text) + "</a></li>";
      }).join("") + "</ul></div>";

    box.querySelectorAll("[data-toc]").forEach(function (a) {
      a.addEventListener("click", function (ev) {
        ev.preventDefault();
        var target = document.getElementById(a.getAttribute("data-toc"));
        if (target) el("main").scrollTo({ top: target.offsetTop - 16, behavior: "smooth" });
      });
    });
    spyToc();
  }

  function spyToc() {
    if (!tocItems.length) return;
    var main = el("main");
    var top = main.scrollTop + 90;
    var active = tocItems[0].id;
    for (var i = 0; i < tocItems.length; i++) {
      var n = document.getElementById(tocItems[i].id);
      if (n && n.offsetTop <= top) active = tocItems[i].id;
    }
    el("toc").querySelectorAll("[data-toc]").forEach(function (a) {
      a.classList.toggle("on", a.getAttribute("data-toc") === active);
    });
  }

  /* ================= 在线运行 ================= */

  function api() { return state.current && state.current.api ? state.current.api : null; }

  function builtPath() {
    var a = api();
    if (!a) return "";
    var p = a.path;
    document.querySelectorAll("[data-pp]").forEach(function (n) {
      var name = n.getAttribute("data-pp");
      var v = n.value.trim();
      if (v) p = p.split(name).join(encodeURIComponent(v));
    });
    var qs = [];
    document.querySelectorAll("[data-qp]").forEach(function (n) {
      if (n.value.trim()) qs.push(encodeURIComponent(n.getAttribute("data-qp")) + "=" + encodeURIComponent(n.value.trim()));
    });
    return p + (qs.length ? "?" + qs.join("&") : "");
  }

  function bodyText() {
    var t = el("in-body");
    return t && t.value.trim() ? t.value : null;
  }

  function renderRunner() {
    var wrap = el("runner-scroll");
    var a = api();
    if (!a) return;

    if (state.closeFullEditor) { state.closeFullEditor(); state.closeFullEditor = null; }
    var mr = el("modal-root");
    if (mr) { mr.innerHTML = ""; mr.hidden = true; }
    document.body.classList.remove("modal-open");

    var canRun = a.runnable !== false;
    var html = "";

    html += '<div class="req-line">' +
      '<span class="verb ' + a.method.toLowerCase() + '">' + esc(a.method) + "</span>" +
      '<span class="u" id="run-url">' + esc(API_BASE + a.path) + "</span>" +
      '<button class="btn btn-accent" id="btn-send"' + (canRun ? "" : " disabled") + ">发送</button></div>";

    if (a.alsoMethods && a.alsoMethods.length) {
      html += '<div class="rgroup"><h3>方法</h3><select class="ipt" id="in-method">' +
        [a.method].concat(a.alsoMethods).map(function (m) {
          return '<option value="' + m + '">' + m + "</option>";
        }).join("") + "</select></div>";
    }

    html += '<div class="rgroup"><h3>认证 <span class="note">Basic Auth</span></h3>' +
      '<div class="frow"><label>API_KEY<span class="star">*</span></label>' +
      '<input class="ipt" id="in-key" type="text" autocomplete="off" placeholder="你的 API Key"></div>' +
      '<div class="frow"><label>API_SECRET<span class="star">*</span></label>' +
      '<input class="ipt" id="in-secret" type="password" autocomplete="off" placeholder="你的 API Secret"></div>' +
      '<div class="cred-links">在 <a href="https://next.jinshuju.net/profile/api" target="_blank" rel="noopener">个人中心 → API</a>' +
      ' 或 <a href="https://next.jinshuju.net/system/api_licence" target="_blank" rel="noopener">系统设置 → 企业 API</a> 获取</div></div>';

    if (a.pathParams.length) {
      html += '<div class="rgroup"><h3>Path 参数</h3>' + a.pathParams.map(function (p) {
        return '<div class="frow"><label title="' + esc(p.name) + '">' + esc(p.name) +
          (p.required ? '<span class="star">*</span>' : "") + "</label>" +
          '<input class="ipt" data-pp="' + esc(p.name) + '" placeholder="' + esc(p.name) + '"></div>';
      }).join("") + "</div>";
    }

    if (a.queryParams.length) {
      html += '<div class="rgroup"><h3>Query 参数</h3>' + a.queryParams.map(function (p) {
        return '<div class="frow"><label title="' + esc(p.name) + '">' + esc(p.name) +
          (p.required ? '<span class="star">*</span>' : "") + "</label>" +
          '<input class="ipt" data-qp="' + esc(p.name) + '" placeholder="可选"></div>';
      }).join("") + "</div>";
    }

    if (!canRun) {
      html += '<div class="rgroup"><h3>Body <span class="note">' + esc(a.contentType) + "</span></h3>" +
        '<div class="hint-box">该接口是文件上传（multipart/form-data），在线运行暂不支持；' +
        "正文「示例代码」一节给出了可直接使用的写法。</div></div>";
    } else if (["POST", "PUT", "PATCH"].indexOf(a.method) !== -1 || (a.alsoMethods || []).length) {
      var init = a.requestExample || "{\n  \n}";
      try { init = JSON.stringify(JSON.parse(init), null, 2); } catch (err) { /* 保留 */ }
      html += '<div class="rgroup"><h3>Body <span class="note">application/json</span></h3>' +
        jsonEditorHtml(init) + "</div>";
    }

    wrap.innerHTML = html;

    var k = el("in-key"), s = el("in-secret");
    k.value = state.creds.key; s.value = state.creds.secret;
    function onCred() {
      state.creds.key = k.value; state.creds.secret = s.value;
      try { sessionStorage.setItem("jsj_creds", JSON.stringify(state.creds)); } catch (err) { /* noop */ }
      if (state.tab === "code") renderOut();
    }
    k.addEventListener("input", onCred);
    s.addEventListener("input", onCred);

    wrap.querySelectorAll("[data-pp],[data-qp]").forEach(function (n) {
      n.addEventListener("input", function () { syncUrl(); if (state.tab === "code") renderOut(); });
    });
    var ms = el("in-method");
    if (ms) ms.addEventListener("change", function () {
      wrap.querySelector(".req-line .verb").className = "verb " + ms.value.toLowerCase();
      wrap.querySelector(".req-line .verb").textContent = ms.value;
      if (state.tab === "code") renderOut();
    });

    initJsonEditor(function () { if (state.tab === "code") renderOut(); });
    if (canRun) el("btn-send").addEventListener("click", send);

    syncUrl();
    state.response = null;
    renderOut();
  }

  function curMethod() {
    var ms = el("in-method");
    return ms ? ms.value : (api() ? api().method : "GET");
  }

  function syncUrl() {
    var u = el("run-url");
    if (u) u.textContent = API_BASE + builtPath();
  }

  /* ---------- JSON 编辑器 ---------- */

  function jsonEditorHtml(initial) {
    return '<div class="jsed" id="jsed">' +
      '<div class="jsed-bar">' +
      '<span class="jsed-name">JSON</span>' +
      '<span class="jsed-status" id="jsed-status"></span>' +
      '<span class="grow"></span>' +
      '<button class="mini" id="jsed-fmt" title="按 2 空格缩进重新格式化">格式化</button>' +
      '<button class="mini" id="jsed-full"></button>' +
      "</div>" +
      '<div class="jsed-body">' +
      '<div class="jsed-gutter" id="jsed-gutter"></div>' +
      '<div class="jsed-code">' +
      '<pre class="jsed-hl" id="jsed-hl" aria-hidden="true"><code></code></pre>' +
      '<textarea class="jsed-input" id="in-body" spellcheck="false" wrap="off"' +
      ' autocapitalize="off" autocorrect="off">' + esc(initial) + "</textarea>" +
      "</div></div></div>";
  }

  function initJsonEditor(onChange) {
    var box = el("jsed"), ta = el("in-body"), hl = el("jsed-hl"),
        gutter = el("jsed-gutter"), status = el("jsed-status");
    if (!box || !ta) return;

    function paint() {
      var src = ta.value;
      hl.firstChild.innerHTML = hlJson(src) + "\n";
      var n = src.split("\n").length, nums = "";
      for (var i = 1; i <= n; i++) nums += i + "\n";
      gutter.textContent = nums;
      var t = src.trim();
      if (!t) { status.className = "jsed-status"; status.textContent = "空"; }
      else {
        try { JSON.parse(t); status.className = "jsed-status ok"; status.textContent = "JSON 合法"; }
        catch (err) { status.className = "jsed-status bad"; status.textContent = describeJsonError(err, src); }
      }
      sync();
    }
    function sync() {
      hl.scrollTop = ta.scrollTop; hl.scrollLeft = ta.scrollLeft; gutter.scrollTop = ta.scrollTop;
    }

    ta.addEventListener("input", function () { paint(); if (onChange) onChange(); });
    ta.addEventListener("scroll", sync);
    ta.addEventListener("keydown", function (ev) {
      if (ev.key === "Tab") {
        ev.preventDefault();
        var a1 = ta.selectionStart, a2 = ta.selectionEnd;
        ta.value = ta.value.slice(0, a1) + "  " + ta.value.slice(a2);
        ta.selectionStart = ta.selectionEnd = a1 + 2;
        paint(); if (onChange) onChange();
      }
    });

    el("jsed-fmt").addEventListener("click", function () {
      try {
        ta.value = JSON.stringify(JSON.parse(ta.value), null, 2);
        paint(); if (onChange) onChange();
        toast("已格式化");
      } catch (err) { paint(); toast("JSON 不合法，无法格式化"); }
    });

    var modal = el("modal-root");
    var home = document.createElement("div");
    home.className = "jsed-slot";

    var ICON_EXPAND = '<svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7">' +
      '<path d="M9.5 2h4.5v4.5M6.5 14H2V9.5M14 9.5V14H9.5M2 6.5V2h4.5"/></svg>';
    var ICON_SHRINK = '<svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7">' +
      '<path d="M14 2.5l-4.5 4.5M9.5 2.5H14V7M2 13.5l4.5-4.5M6.5 13.5H2V9"/></svg>';
    var fullBtn = el("jsed-full");
    function syncFullBtn() {
      var on = box.classList.contains("jsed-full");
      fullBtn.innerHTML = on ? ICON_SHRINK + "退出全屏" : ICON_EXPAND;
      fullBtn.title = on ? "退出全屏（Esc）" : "全屏编辑";
    }
    function enterFull() {
      if (box.classList.contains("jsed-full")) return;
      box.parentNode.insertBefore(home, box);
      modal.appendChild(box);
      modal.hidden = false;
      box.classList.add("jsed-full");
      document.body.classList.add("modal-open");
      ta.focus(); paint();
    }
    function exitFull() {
      if (!box.classList.contains("jsed-full")) return;
      box.classList.remove("jsed-full");
      if (home.parentNode) home.parentNode.replaceChild(box, home);
      modal.hidden = true;
      document.body.classList.remove("modal-open");
      paint();
    }
    fullBtn.addEventListener("click", function () {
      if (box.classList.contains("jsed-full")) exitFull(); else enterFull();
      syncFullBtn();
    });
    modal.addEventListener("mousedown", function (ev) {
      if (ev.target === modal) { exitFull(); syncFullBtn(); }
    });
    document.addEventListener("keydown", function (ev) {
      if (ev.key === "Escape" && box.classList.contains("jsed-full")) { exitFull(); syncFullBtn(); }
    });
    state.closeFullEditor = exitFull;

    syncFullBtn();
    paint();
  }

  function describeJsonError(err, src) {
    var msg = String(err.message || err);
    var pos = msg.match(/position (\d+)/);
    if (pos) {
      var idx = +pos[1], before = src.slice(0, idx);
      var line = before.split("\n").length, col = idx - before.lastIndexOf("\n");
      return "第 " + line + " 行第 " + col + " 列: " +
        msg.replace(/\s*in JSON at position.*$/, "").replace(/^JSON\.parse:\s*/, "");
    }
    var ln = msg.match(/line (\d+)/);
    return ln ? "第 " + ln[1] + " 行: " + msg : msg;
  }

  /* ---------- 发送 ---------- */

  function basic(key, secret) {
    var bytes = new TextEncoder().encode(key + ":" + secret);
    var bin = "";
    for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return "Basic " + btoa(bin);
  }

  // 金数据 API 开放了 CORS（Access-Control-Allow-Origin: *，允许 authorization 头），
  // 所以默认浏览器直连——凭据不经任何第三方服务器。
  // PROXY_URL 只是给「CORS 被收紧」或「需要内网出口」这类情况留的后门，默认不启用。
  function sendDirect(method, path, body) {
    var started = Date.now();
    var headers = {
      Authorization: basic(state.creds.key, state.creds.secret),
      Accept: "application/json",
    };
    if (body) headers["Content-Type"] = "application/json";
    return fetch(API_BASE + path, { method: method, headers: headers, body: body || undefined })
      .then(function (r) {
        return r.text().then(function (text) {
          return {
            status: r.status,
            statusText: r.statusText,
            durationMs: Date.now() - started,
            contentType: r.headers.get("content-type") || "",
            body: text,
          };
        });
      });
  }

  function sendViaProxy(method, path, body) {
    return fetch(PROXY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        method: method, path: path,
        apiKey: state.creds.key, apiSecret: state.creds.secret,
        body: body || undefined,
      }),
    }).then(function (r) { return r.json(); });
  }

  function send() {
    if (state.sending) return;
    if (!state.creds.key || !state.creds.secret) { toast("请先填写 API_KEY 和 API_SECRET"); return; }
    var body = bodyText();
    if (body) { try { JSON.parse(body); } catch (err) { toast("Body 不是合法 JSON"); return; } }

    var method = curMethod(), path = builtPath();

    state.sending = true;
    var btn = el("btn-send");
    btn.disabled = true; btn.textContent = "发送中";
    state.tab = "result"; state.response = { pending: true };
    renderOut();

    (PROXY_URL ? sendViaProxy(method, path, body) : sendDirect(method, path, body))
      .then(function (r) { state.response = r; })
      .catch(function (err) {
        state.response = {
          error: "请求失败：" + String(err && err.message ? err.message : err) +
            "\n\n浏览器直连被拦截时，常见原因是网络策略或 CORS。" +
            "可以在页面里设置 window.__JSJ_PROXY_URL__ 指向一个转发端点（见 README）。",
        };
      })
      .finally(function () {
        state.sending = false;
        btn.disabled = false; btn.textContent = "发送";
        renderOut();
      });
  }

  /* ---------- 请求代码 ---------- */

  function snippet(lang) {
    if (!api()) return "";
    var url = API_BASE + builtPath();
    var key = state.creds.key || "YOUR_API_KEY";
    var secret = state.creds.secret || "YOUR_API_SECRET";
    var body = bodyText();
    var compact = null;
    if (body) { try { compact = JSON.stringify(JSON.parse(body)); } catch (e) { compact = null; } }
    var m = curMethod();

    switch (lang) {
      case "curl":
        return ["curl -X " + m + ' "' + url + '" \\',
          '  -u "' + key + ":" + secret + '" \\',
          '  -H "Content-Type: application/json" \\',
          '  -H "Accept: application/json"' + (compact ? " \\" : "")]
          .concat(compact ? ["  -d '" + compact + "'"] : []).join("\n");

      case "js":
        return ["const auth = btoa(`" + key + ":" + secret + "`);", "",
          "const res = await fetch(" + q(url) + ", {",
          "  method: " + q(m) + ",", "  headers: {",
          "    Authorization: `Basic ${auth}`,",
          '    "Content-Type": "application/json",',
          '    Accept: "application/json",', "  },"]
          .concat(compact ? ["  body: JSON.stringify(" + pretty(body, 2) + "),"] : [])
          .concat(["});", "", "const data = await res.json();", "console.log(res.status, data);"]).join("\n");

      case "node":
        return ["// npm i axios", 'import axios from "axios";', "",
          "const { status, data } = await axios({",
          "  method: " + q(m.toLowerCase()) + ",", "  url: " + q(url) + ",",
          "  auth: { username: " + q(key) + ", password: " + q(secret) + " },",
          '  headers: { "Content-Type": "application/json", Accept: "application/json" },']
          .concat(compact ? ["  data: " + pretty(body, 2) + ","] : [])
          .concat(["});", "", "console.log(status, data);"]).join("\n");

      case "python":
        return ["# pip install requests", "import requests", "",
          "url = " + q(url), "auth = (" + q(key) + ", " + q(secret) + ")",
          'headers = {"Content-Type": "application/json", "Accept": "application/json"}']
          .concat(compact ? ["payload = " + pyLit(body)] : [])
          .concat(["",
            "res = requests." + m.toLowerCase() + "(url, auth=auth, headers=headers" +
              (compact ? ", json=payload" : "") + ")",
            "print(res.status_code, res.json())"]).join("\n");

      case "php":
        return ["<?php", "$ch = curl_init(" + q(url) + ");", "curl_setopt_array($ch, [",
          "    CURLOPT_CUSTOMREQUEST => " + q(m) + ",",
          "    CURLOPT_RETURNTRANSFER => true,",
          "    CURLOPT_USERPWD => " + q(key + ":" + secret) + ",",
          '    CURLOPT_HTTPHEADER => ["Content-Type: application/json", "Accept: application/json"],']
          .concat(compact ? ["    CURLOPT_POSTFIELDS => " + q(compact) + ","] : [])
          .concat(["]);", "", "$response = curl_exec($ch);",
            "echo curl_getinfo($ch, CURLINFO_HTTP_CODE), PHP_EOL, $response, PHP_EOL;",
            "curl_close($ch);"]).join("\n");

      case "ruby":
        return ["require 'net/http'", "require 'uri'", "require 'json'", "",
          "uri = URI.parse(" + rq(url) + ")",
          "request = Net::HTTP::" + rubyClass(m) + ".new(uri, 'Content-Type' => 'application/json', 'Accept' => 'application/json')",
          "request.basic_auth(" + rq(key) + ", " + rq(secret) + ")"]
          .concat(compact ? ["request.body = " + rq(compact)] : [])
          .concat(["",
            "response = Net::HTTP.start(uri.hostname, uri.port, use_ssl: true) do |http|",
            "  http.request(request)", "end", "", "puts response.code", "puts response.body"]).join("\n");

      case "java":
        return ["import java.net.URI;", "import java.net.http.*;", "import java.util.Base64;", "",
          'String auth = Base64.getEncoder().encodeToString(("' + key + ":" + secret + '").getBytes());', "",
          "HttpRequest request = HttpRequest.newBuilder()",
          "    .uri(URI.create(" + q(url) + "))",
          '    .header("Authorization", "Basic " + auth)',
          '    .header("Content-Type", "application/json")',
          '    .header("Accept", "application/json")',
          "    " + javaVerb(m, compact), "    .build();", "",
          "HttpResponse<String> response = HttpClient.newHttpClient()",
          "    .send(request, HttpResponse.BodyHandlers.ofString());", "",
          "System.out.println(response.statusCode());",
          "System.out.println(response.body());"].join("\n");

      case "go":
        return ["package main", "", "import (", '\t"fmt"', '\t"io"', '\t"net/http"',
          compact ? '\t"strings"' : "", ")", "", "func main() {",
          compact ? "\tbody := strings.NewReader(" + gq(compact) + ")" : "",
          "\treq, _ := http.NewRequest(" + q(m) + ", " + q(url) + ", " + (compact ? "body" : "nil") + ")",
          "\treq.SetBasicAuth(" + q(key) + ", " + q(secret) + ")",
          '\treq.Header.Set("Content-Type", "application/json")',
          '\treq.Header.Set("Accept", "application/json")', "",
          "\tres, err := http.DefaultClient.Do(req)", "\tif err != nil {", "\t\tpanic(err)", "\t}",
          "\tdefer res.Body.Close()", "", "\tout, _ := io.ReadAll(res.Body)",
          "\tfmt.Println(res.StatusCode, string(out))", "}"]
          .filter(function (l) { return l !== ""; }).join("\n");
    }
    return "";
  }

  function q(s) { return JSON.stringify(String(s)); }
  function rq(s) { return "'" + String(s).replace(/\\/g, "\\\\").replace(/'/g, "\\'") + "'"; }
  function gq(s) { return "`" + String(s).replace(/`/g, '` + "`" + `') + "`"; }
  function rubyClass(m) { return { GET: "Get", POST: "Post", PUT: "Put", PATCH: "Patch", DELETE: "Delete" }[m] || "Get"; }
  function javaVerb(m, compact) {
    var pub = compact ? "HttpRequest.BodyPublishers.ofString(" + q(compact) + ")" : "HttpRequest.BodyPublishers.noBody()";
    if (m === "GET") return ".GET()";
    if (m === "DELETE") return ".DELETE()";
    if (m === "POST") return ".POST(" + pub + ")";
    if (m === "PUT") return ".PUT(" + pub + ")";
    return '.method("' + m + '", ' + pub + ")";
  }
  function pretty(json, indent) {
    try {
      var s = JSON.stringify(JSON.parse(json), null, 2), pad = " ".repeat(indent);
      return s.split("\n").map(function (l, i) { return i === 0 ? l : pad + l; }).join("\n");
    } catch (e) { return json; }
  }
  function pyLit(json) {
    try {
      return JSON.stringify(JSON.parse(json), null, 4)
        .replace(/\btrue\b/g, "True").replace(/\bfalse\b/g, "False").replace(/\bnull\b/g, "None");
    } catch (e) { return json; }
  }

  var SNIP_LANG = { curl: "bash", js: "javascript", node: "javascript", python: "python", php: "php", ruby: "ruby", java: "java", go: "go" };

  function renderOut() {
    if (!api()) return;
    var tabs = el("out-tabs"), pane = el("out-pane");

    var right = "";
    if (state.tab === "result" && state.response && !state.response.pending && !state.response.error) {
      var ok = state.response.status >= 200 && state.response.status < 300;
      right = '<span class="pill ' + (ok ? "ok" : "bad") + '">' + state.response.status + "</span>" +
        '<span class="ms">' + state.response.durationMs + " ms</span>";
    } else if (state.tab === "code") {
      right = '<select class="lang-select" id="lang-sel">' + LANGS.map(function (l) {
        return '<option value="' + l.id + '"' + (l.id === state.lang ? " selected" : "") + ">" + l.label + "</option>";
      }).join("") + "</select>";
    }

    tabs.innerHTML =
      '<button class="tab' + (state.tab === "result" ? " on" : "") + '" data-tab="result">返回结果</button>' +
      '<button class="tab' + (state.tab === "code" ? " on" : "") + '" data-tab="code">请求代码</button>' +
      '<span class="right">' + right + "</span>";

    if (state.tab === "code") {
      pane.innerHTML = codeBlock(snippet(state.lang), SNIP_LANG[state.lang]);
    } else if (!state.response) {
      pane.innerHTML = '<div class="out-empty"><div class="ico">' +
        '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">' +
        '<path d="M5 19l3.5-1.2 8-8a2.5 2.5 0 10-3.5-3.5l-8 8L5 19z"/></svg></div>' +
        "<div>填好参数后点「发送」查看真实返回<br>也可以切到「请求代码」直接复制</div></div>";
    } else if (state.response.pending) {
      pane.innerHTML = '<div class="out-empty">请求中…</div>';
    } else if (state.response.error) {
      pane.innerHTML = codeBlock(state.response.error, "text");
    } else {
      var t = state.response.body || "";
      try { t = JSON.stringify(JSON.parse(t), null, 2); } catch (err) { /* 原样 */ }
      pane.innerHTML = codeBlock(t, "json");
    }

    tabs.querySelectorAll("[data-tab]").forEach(function (n) {
      n.addEventListener("click", function () { state.tab = n.getAttribute("data-tab"); renderOut(); });
    });
    var sel = el("lang-sel");
    if (sel) sel.addEventListener("change", function () { state.lang = sel.value; renderOut(); });
    bindCopy(pane);
  }

  function bindCopy(root) {
    root.querySelectorAll("[data-copy]").forEach(function (n) {
      n.addEventListener("click", function () { copy(codeBlock.store[n.getAttribute("data-copy")] || "", "代码"); });
    });
  }

  /* ================= 路由 ================= */

  function resolve() {
    var raw = location.hash.replace(/^#\/?/, "");
    var frag = "";
    var hi = raw.indexOf("#");
    if (hi !== -1) { frag = raw.slice(hi + 1); raw = raw.slice(0, hi); }
    raw = raw.replace(/\/$/, "");
    var doc = state.docs[raw];
    if (!doc && raw === "") doc = state.docs[""];
    if (!doc) doc = state.docs[state.order[0]];
    return { doc: doc, frag: frag };
  }

  var HOME_ICON = '<svg viewBox="0 0 24 24" class="breadcrumb-home" aria-hidden="true">' +
    '<path fill="currentColor" d="M10 19v-5h4v5c0 .55.45 1 1 1h3c.55 0 1-.45 1-1v-7h1.7c.46 0 .68-.57.33-.87L12.67 3.6c-.38-.34-.96-.34-1.34 0l-8.36 7.53c-.34.3-.13.87.33.87H5v7c0 .55.45 1 1 1h3c.55 0 1-.45 1-1z"/></svg>';

  // 与原站一致：首页图标 › 各级分类 › 当前页标题；首页本身不显示面包屑
  function breadcrumbsHtml(doc) {
    if (doc.route === "") return '<div class="breadcrumbs-placeholder"></div>';
    var items = '<li class="breadcrumbs__item"><a class="breadcrumbs__link" href="#/" aria-label="主页">' +
      HOME_ICON + "</a></li>";
    (doc.breadcrumb || []).forEach(function (c) {
      items += '<li class="breadcrumbs__item"><span class="breadcrumbs__link">' + esc(c) + "</span></li>";
    });
    items += '<li class="breadcrumbs__item breadcrumbs__item--active">' +
      '<span class="breadcrumbs__link">' + esc(doc.title) + "</span></li>";
    return '<ul class="breadcrumbs" aria-label="面包屑导航">' + items + "</ul>";
  }

  function route() {
    var r = resolve();
    if (!r.doc) return;
    state.current = r.doc;

    slugSeen = {};
    tocItems = [];
    var bodyHtml = renderMarkdown(r.doc.markdown, true);

    el("doc").innerHTML =
      '<div class="doc-head' + (r.doc.route === "" ? " no-crumbs" : "") + '">' +
      breadcrumbsHtml(r.doc) +
      '<div class="doc-head-actions">' +
      '<button class="btn" data-act="copy-page">复制页面</button>' +
      (r.doc.api ? '<button class="btn" data-act="toggle-runner">在线运行</button>' : "") +
      "</div></div>" +
      '<div class="markdown" id="md">' + bodyHtml + "</div>";

    var layout = el("layout");
    layout.classList.toggle("has-api", !!r.doc.api);
    if (r.doc.api) {
      layout.classList.toggle("runner-open", state.runnerOpen);
      renderRunner();
    } else {
      layout.classList.remove("runner-open");
    }

    renderToc();
    renderMenu();
    document.title = r.doc.title + " | 金数据开放平台";

    var main = el("main");
    main.scrollTop = 0;
    if (r.frag) {
      var target = document.getElementById(r.frag);
      if (target) main.scrollTop = target.offsetTop - 16;
    }

    var doc = el("doc");
    bindCopy(doc);
    doc.querySelectorAll("[data-act]").forEach(function (n) {
      n.addEventListener("click", function () {
        var a = n.getAttribute("data-act");
        if (a === "copy-page") copy(el("md").innerText, "页面内容");
        else if (a === "toggle-runner") {
          state.runnerOpen = !layout.classList.contains("runner-open");
          layout.classList.toggle("runner-open", state.runnerOpen);
        }
      });
    });
  }

  /* ================= 主题 ================= */

  function applyTheme(t) {
    document.documentElement.setAttribute("data-theme", t);
    try { localStorage.setItem("jsj_theme", t); } catch (e) { /* noop */ }
    el("btn-theme").innerHTML = t === "dark"
      ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M20 14.5A8.2 8.2 0 019.5 4 8.5 8.5 0 1020 14.5z"/></svg>'
      : '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="12" cy="12" r="4.2"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.2 5.2l1.4 1.4M17.4 17.4l1.4 1.4M18.8 5.2l-1.4 1.4M6.6 17.4l-1.4 1.4"/></svg>';
  }

  /* ================= 启动 ================= */

  function init() {
    var th = "light";
    try { th = localStorage.getItem("jsj_theme") || "light"; } catch (e) { /* noop */ }
    applyTheme(th);
    el("btn-theme").addEventListener("click", function () {
      applyTheme(document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark");
    });
    el("btn-close-runner").addEventListener("click", function () {
      state.runnerOpen = false;
      el("layout").classList.remove("runner-open");
    });

    var search = el("search");
    search.addEventListener("input", function () { state.filter = search.value; renderMenu(); });
    document.addEventListener("keydown", function (ev) {
      if ((ev.metaKey || ev.ctrlKey) && ev.key.toLowerCase() === "k") { ev.preventDefault(); search.focus(); search.select(); }
      if (ev.key === "Escape" && document.activeElement === search) {
        search.value = ""; state.filter = ""; renderMenu(); search.blur();
      }
    });

    try {
      var c = JSON.parse(sessionStorage.getItem("jsj_creds") || "{}");
      state.creds.key = c.key || ""; state.creds.secret = c.secret || "";
    } catch (e) { /* noop */ }

    el("main").addEventListener("scroll", function () {
      if (spyToc.raf) return;
      spyToc.raf = requestAnimationFrame(function () { spyToc.raf = null; spyToc(); });
    });

    window.addEventListener("hashchange", route);

    fetch(SITE + "data.json")
      .then(function (r) { return r.json(); })
      .then(function (d) {
        state.nav = d.nav || [];
        state.docs = d.docs || {};
        state.order = [];
        eachDoc(state.nav, function (it) { state.order.push(it.route); });
        route();
      })
      .catch(function (err) {
        el("doc").innerHTML = '<div class="markdown"><p>文档数据加载失败：' + esc(String(err)) + "</p></div>";
      });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
