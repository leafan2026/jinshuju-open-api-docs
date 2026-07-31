/* 金数据开放平台 · API 文档站前端
 *
 * 正文 = open.jinshuju.net 原文 markdown，排版对齐原站。
 * 新增部分只有右侧「在线运行」：真实发请求 + 生成对应语言的请求代码。
 */
(function () {
  "use strict";

  var API_BASE = "https://jinshuju.net";
  var GROUP_ORDER = ["开发指南", "表单", "文件夹", "数据", "账户", "Schema"];
  var SITE = location.pathname.endsWith("/") ? location.pathname : location.pathname + "/";

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
    endpoints: [],
    guides: [],
    current: null,
    filter: "",
    runnerOpen: true,
    creds: { key: "", secret: "" },
    tab: "result", // result | code
    lang: "curl",
    response: null,
    sending: false,
    collapsed: {},
  };

  /* ================= 工具 ================= */

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  // 原文里已有的 HTML 实体（如 Array&lt;String&gt;）不要被二次转义
  function unesc2(s) {
    return s.replace(/&amp;(lt|gt|amp|quot|#\d+);/g, "&$1;");
  }
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
    php: "php", go: "go", jsonc: "jsonc",
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
      '<div class="code-block-head"><span>' + esc(label) + "</span><span class=\"grow\"></span>" +
      (opts.noCopy ? "" : '<button class="mini" data-copy="' + id + '">复制</button>') +
      "</div><pre><code>" + body + "</code></pre></div>";
  }

  /* ================= Markdown 渲染 ================= */

  function inlineMd(s) {
    var out = esc(s);
    out = unesc2(out);
    // 行内代码优先，避免代码里的 * _ 被当成强调
    var codes = [];
    out = out.replace(/`([^`]+)`/g, function (_, c) {
      codes.push(c);
      return "\u0000" + (codes.length - 1) + "\u0000";
    });
    out = out
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
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

  function stripAnchor(s) {
    return s.replace(/\[\u200b?\]\(#[^)]*\)\s*$/, "").replace(/\s*\u200b\s*$/, "").trim();
  }

  function renderMarkdown(md) {
    var lines = String(md || "").split("\n");
    var out = [], i = 0;

    while (i < lines.length) {
      var line = lines[i];

      // 代码块
      var fence = line.match(/^\s*```(\S*)\s*$/);
      if (fence) {
        var lang = fence[1] || "", buf = [];
        i++;
        while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) { buf.push(lines[i]); i++; }
        i++;
        out.push(codeBlock(buf.join("\n").replace(/[ \t]+$/gm, ""), lang));
        continue;
      }

      // 表格
      if (/^\s*\|/.test(line) && i + 1 < lines.length && /^\s*\|[\s:\-|]+\|\s*$/.test(lines[i + 1])) {
        var cut = function (l) {
          // 保留 \| 转义
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
        out.push("<table><thead><tr>" +
          head.map(function (c) { return "<th>" + inlineMd(c) + "</th>"; }).join("") +
          "</tr></thead><tbody>" +
          rows.map(function (r) {
            return "<tr>" + r.map(function (c) { return "<td>" + inlineMd(c) + "</td>"; }).join("") + "</tr>";
          }).join("") + "</tbody></table>");
        continue;
      }

      // 标题
      var hd = line.match(/^(#{1,6})\s+(.*)$/);
      if (hd) {
        var lv = Math.min(hd[1].length, 4);
        out.push("<h" + lv + ">" + inlineMd(stripAnchor(hd[2])) + "</h" + lv + ">");
        i++;
        continue;
      }

      // 引用
      if (/^\s*>\s?/.test(line)) {
        var q = [];
        while (i < lines.length && (/^\s*>\s?/.test(lines[i]) || (q.length && lines[i].trim() !== "" && !/^\s*(#|```|\|)/.test(lines[i])))) {
          if (!/^\s*>/.test(lines[i])) break;
          q.push(lines[i].replace(/^\s*>\s?/, ""));
          i++;
        }
        out.push("<blockquote>" + renderMarkdown(q.join("\n")) + "</blockquote>");
        continue;
      }

      // 分隔线
      if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) { out.push("<hr>"); i++; continue; }

      // 列表（支持一层嵌套）
      if (/^\s*([-*+]|\d+\.)\s+/.test(line)) {
        var ordered = /^\s*\d+\./.test(line);
        var items = [], baseIndent = line.match(/^\s*/)[0].length;
        while (i < lines.length && /^\s*([-*+]|\d+\.)\s+/.test(lines[i])) {
          var ind = lines[i].match(/^\s*/)[0].length;
          var txt = lines[i].replace(/^\s*([-*+]|\d+\.)\s+/, "");
          if (ind > baseIndent && items.length) {
            items[items.length - 1].sub = items[items.length - 1].sub || [];
            items[items.length - 1].sub.push(txt);
          } else {
            items.push({ txt: txt, sub: null });
          }
          i++;
          // 列表项的续行
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

      // 段落
      var p = [];
      while (i < lines.length && lines[i].trim() !== "" &&
             !/^\s*(#{1,6}\s|[-*+]\s|\d+\.\s|>|\||```|-{3,}$)/.test(lines[i])) {
        p.push(lines[i]); i++;
      }
      out.push("<p>" + inlineMd(p.join(" ")) + "</p>");
    }
    return out.join("\n");
  }

  /* ================= 目录 ================= */

  function groupsOf() {
    var map = {};
    state.guides.forEach(function (g) { (map[g.group] = map[g.group] || []).push({ kind: "guide", item: g }); });
    state.endpoints.forEach(function (e) { (map[e.group] = map[e.group] || []).push({ kind: "endpoint", item: e }); });
    var names = GROUP_ORDER.filter(function (g) { return map[g]; })
      .concat(Object.keys(map).filter(function (g) { return GROUP_ORDER.indexOf(g) === -1; }));
    return names.map(function (n) { return { name: n, entries: map[n] }; });
  }

  function hit(entry, q) {
    if (!q) return true;
    var it = entry.item;
    return [it.name, it.id, it.path, it.method, it.description].filter(Boolean)
      .join(" ").toLowerCase().indexOf(q) !== -1;
  }

  function renderMenu() {
    var menu = el("menu");
    var q = state.filter.trim().toLowerCase();
    var html = "", any = false;

    groupsOf().forEach(function (g) {
      var entries = g.entries.filter(function (e) { return hit(e, q); });
      if (!entries.length) return;
      any = true;
      var collapsed = state.collapsed[g.name] && !q;
      html += '<div class="menu-group' + (collapsed ? " collapsed" : "") + '" data-group="' + esc(g.name) + '">' +
        '<button class="menu-group-label"><span>' + esc(g.name) + "</span>" +
        '<svg class="caret" width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 6.5l4 4 4-4"/></svg>' +
        "</button><div class=\"menu-list\">" +
        entries.map(function (e) {
          var it = e.item;
          var on = state.current && state.current.kind === e.kind && state.current.item.id === it.id;
          return '<button class="menu-link' + (on ? " active" : "") + '" data-go="' + e.kind + "/" + it.id + '">' +
            '<span class="txt">' + esc(it.name) + "</span>" +
            (e.kind === "endpoint" ? '<span class="verb ' + it.method.toLowerCase() + '">' + esc(it.method) + "</span>" : "") +
            "</button>";
        }).join("") + "</div></div>";
    });

    menu.innerHTML = any ? html : '<div class="menu-empty">没有匹配的内容</div>';

    menu.querySelectorAll(".menu-group-label").forEach(function (n) {
      n.addEventListener("click", function () {
        var g = n.parentElement.getAttribute("data-group");
        state.collapsed[g] = !state.collapsed[g];
        n.parentElement.classList.toggle("collapsed");
      });
    });
    menu.querySelectorAll("[data-go]").forEach(function (n) {
      n.addEventListener("click", function () { location.hash = "#/" + n.getAttribute("data-go"); });
    });
  }

  /* ================= 在线运行 ================= */

  function pathParamInputs() { return document.querySelectorAll("[data-pp]"); }
  function queryParamInputs() { return document.querySelectorAll("[data-qp]"); }

  function builtPath() {
    var e = state.current && state.current.kind === "endpoint" ? state.current.item : null;
    if (!e) return "";
    var p = e.path;
    pathParamInputs().forEach(function (n) {
      var name = n.getAttribute("data-pp");
      var v = n.value.trim();
      if (v) p = p.split(name).join(encodeURIComponent(v));
    });
    var qs = [];
    queryParamInputs().forEach(function (n) {
      var v = n.value.trim();
      if (v) qs.push(encodeURIComponent(n.getAttribute("data-qp")) + "=" + encodeURIComponent(v));
    });
    return p + (qs.length ? "?" + qs.join("&") : "");
  }

  function bodyText() {
    var t = el("in-body");
    return t && t.value.trim() ? t.value : null;
  }

  function renderRunner(e) {
    var wrap = el("runner-scroll");
    if (!e) return;

    var noRun = e.id === "create_entry_attachment";
    var html = "";

    html += '<div class="req-line">' +
      '<span class="verb ' + e.method.toLowerCase() + '">' + esc(e.method) + "</span>" +
      '<span class="u" id="run-url">' + esc(API_BASE + e.path) + "</span>" +
      '<button class="btn btn-accent" id="btn-send"' + (noRun ? " disabled" : "") + ">发送</button></div>";

    html += '<div class="rgroup"><h3>认证 <span class="note">Basic Auth</span></h3>' +
      '<div class="frow"><label>API_KEY<span class="star">*</span></label>' +
      '<input class="ipt" id="in-key" type="text" autocomplete="off" placeholder="你的 API Key"></div>' +
      '<div class="frow"><label>API_SECRET<span class="star">*</span></label>' +
      '<input class="ipt" id="in-secret" type="password" autocomplete="off" placeholder="你的 API Secret"></div>' +
      '<div class="cred-links">在 <a href="https://next.jinshuju.net/profile/api" target="_blank" rel="noopener">个人中心 → API</a>' +
      ' 或 <a href="https://next.jinshuju.net/system/api_licence" target="_blank" rel="noopener">系统设置 → 企业 API</a> 获取</div></div>';

    if (e.pathParams && e.pathParams.length) {
      html += '<div class="rgroup"><h3>Path 参数</h3>' + e.pathParams.map(function (p) {
        return '<div class="frow"><label title="' + esc(p.name) + '">' + esc(p.name) +
          (p.required ? '<span class="star">*</span>' : "") + "</label>" +
          '<input class="ipt" data-pp="' + esc(p.name) + '" placeholder="' + esc(p.name) + '"></div>';
      }).join("") + "</div>";
    }

    if (e.queryParams && e.queryParams.length) {
      html += '<div class="rgroup"><h3>Query 参数</h3>' + e.queryParams.map(function (p) {
        return '<div class="frow"><label title="' + esc(p.name) + '">' + esc(p.name) +
          (p.required ? '<span class="star">*</span>' : "") + "</label>" +
          '<input class="ipt" data-qp="' + esc(p.name) + '" placeholder="' +
          esc(p.default != null && p.default !== "" ? String(p.default) : "可选") + '"></div>';
      }).join("") + "</div>";
    }

    if (["POST", "PUT", "PATCH"].indexOf(e.method) !== -1) {
      if (noRun) {
        html += '<div class="rgroup"><h3>Body</h3><div class="hint-box">' +
          "该接口为 multipart/form-data 文件上传，在线运行暂不支持；正文「示例代码」一节给出了可直接使用的写法。</div></div>";
      } else {
        var init = e.requestExample && /^\s*[[{]/.test(e.requestExample) ? e.requestExample.trim() : "{\n  \n}";
        try { init = JSON.stringify(JSON.parse(init), null, 2); } catch (err) { /* 保留原样 */ }
        html += '<div class="rgroup"><h3>Body <span class="note">application/json</span></h3>' +
          jsonEditorHtml(init) + "</div>";
      }
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
    initJsonEditor(function () { if (state.tab === "code") renderOut(); });

    if (!noRun) el("btn-send").addEventListener("click", send);
    syncUrl();
    state.response = null;
    renderOut();
  }

  function syncUrl() {
    var u = el("run-url");
    if (u) u.textContent = API_BASE + builtPath();
  }

  /* ---------- 带高亮 / 行号 / 校验 / 全屏的 JSON 编辑器 ---------- */

  function jsonEditorHtml(initial) {
    return '<div class="jsed" id="jsed">' +
      '<div class="jsed-bar">' +
      '<span class="jsed-name">JSON</span>' +
      '<span class="jsed-status" id="jsed-status"></span>' +
      '<span class="grow"></span>' +
      '<button class="mini" id="jsed-fmt" title="按 2 空格缩进重新格式化">格式化</button>' +
      '<button class="mini" id="jsed-full" title="全屏编辑（Esc 退出）">' +
      '<svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7">' +
      '<path d="M9.5 2h4.5v4.5M6.5 14H2V9.5M14 9.5V14H9.5M2 6.5V2h4.5"/></svg></button>' +
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
      var n = src.split("\n").length;
      var nums = "";
      for (var i = 1; i <= n; i++) nums += i + "\n";
      gutter.textContent = nums;
      // 校验
      var t = src.trim();
      if (!t) {
        status.className = "jsed-status";
        status.textContent = "空";
      } else {
        try {
          JSON.parse(t);
          status.className = "jsed-status ok";
          status.textContent = "JSON 合法";
        } catch (err) {
          status.className = "jsed-status bad";
          status.textContent = describeJsonError(err, src);
        }
      }
      sync();
    }

    function sync() {
      hl.scrollTop = ta.scrollTop;
      hl.scrollLeft = ta.scrollLeft;
      gutter.scrollTop = ta.scrollTop;
    }

    ta.addEventListener("input", function () { paint(); if (onChange) onChange(); });
    ta.addEventListener("scroll", sync);
    ta.addEventListener("keydown", function (ev) {
      if (ev.key === "Tab") {
        ev.preventDefault();
        var s = ta.selectionStart, e2 = ta.selectionEnd;
        ta.value = ta.value.slice(0, s) + "  " + ta.value.slice(e2);
        ta.selectionStart = ta.selectionEnd = s + 2;
        paint(); if (onChange) onChange();
      }
      if (ev.key === "Escape" && box.classList.contains("jsed-full")) exitFull();
    });

    el("jsed-fmt").addEventListener("click", function () {
      try {
        ta.value = JSON.stringify(JSON.parse(ta.value), null, 2);
        paint(); if (onChange) onChange();
        toast("已格式化");
      } catch (err) {
        paint();
        toast("JSON 不合法，无法格式化");
      }
    });

    function enterFull() {
      box.classList.add("jsed-full");
      document.body.classList.add("no-scroll");
      ta.focus();
      paint();
    }
    function exitFull() {
      box.classList.remove("jsed-full");
      document.body.classList.remove("no-scroll");
      paint();
    }
    el("jsed-full").addEventListener("click", function () {
      if (box.classList.contains("jsed-full")) exitFull(); else enterFull();
    });
    document.addEventListener("keydown", function (ev) {
      if (ev.key === "Escape" && box.classList.contains("jsed-full")) exitFull();
    });

    paint();
  }

  function describeJsonError(err, src) {
    var msg = String(err.message || err);
    var pos = msg.match(/position (\d+)/);
    if (pos) {
      var idx = +pos[1];
      var before = src.slice(0, idx);
      var line = before.split("\n").length;
      var col = idx - before.lastIndexOf("\n");
      return "第 " + line + " 行第 " + col + " 列: " + msg.replace(/\s*in JSON at position.*$/, "").replace(/^JSON\.parse:\s*/, "");
    }
    var ln = msg.match(/line (\d+)/);
    if (ln) return "第 " + ln[1] + " 行: " + msg;
    return msg;
  }

  function send() {
    if (state.sending) return;
    var e = state.current.item;
    if (!state.creds.key || !state.creds.secret) { toast("请先填写 API_KEY 和 API_SECRET"); return; }
    var body = bodyText();
    if (body) { try { JSON.parse(body); } catch (err) { toast("Body 不是合法 JSON"); return; } }

    state.sending = true;
    var btn = el("btn-send");
    btn.disabled = true; btn.textContent = "发送中";
    state.tab = "result"; state.response = { pending: true };
    renderOut();

    fetch(SITE + "_proxy", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        method: e.method, path: builtPath(),
        apiKey: state.creds.key, apiSecret: state.creds.secret,
        body: body || undefined,
      }),
    })
      .then(function (r) { return r.json(); })
      .then(function (r) { state.response = r; })
      .catch(function (err) { state.response = { error: String(err) }; })
      .finally(function () {
        state.sending = false;
        btn.disabled = false; btn.textContent = "发送";
        renderOut();
      });
  }

  /* ---------- 请求代码生成 ---------- */

  function snippet(lang) {
    var e = state.current && state.current.kind === "endpoint" ? state.current.item : null;
    if (!e) return "";
    var url = API_BASE + builtPath();
    var key = state.creds.key || "YOUR_API_KEY";
    var secret = state.creds.secret || "YOUR_API_SECRET";
    var body = bodyText();
    var compact = body ? JSON.stringify(JSON.parse(safeJson(body) ? body : "{}")) : null;
    var m = e.method;

    switch (lang) {
      case "curl":
        return [
          "curl -X " + m + ' "' + url + '" \\',
          '  -u "' + key + ":" + secret + '" \\',
          '  -H "Content-Type: application/json" \\',
          '  -H "Accept: application/json"' + (compact ? " \\" : ""),
        ].concat(compact ? ["  -d '" + compact + "'"] : []).join("\n");

      case "js":
        return [
          "const auth = btoa(`" + key + ":" + secret + "`);",
          "",
          "const res = await fetch(" + q(url) + ", {",
          "  method: " + q(m) + ",",
          "  headers: {",
          "    Authorization: `Basic ${auth}`,",
          '    "Content-Type": "application/json",',
          '    Accept: "application/json",',
          "  },",
        ].concat(compact ? ["  body: JSON.stringify(" + pretty(body, 2) + "),"] : [])
          .concat(["});", "", "const data = await res.json();", "console.log(res.status, data);"]).join("\n");

      case "node":
        return [
          "// npm i axios",
          'import axios from "axios";',
          "",
          "const { status, data } = await axios({",
          "  method: " + q(m.toLowerCase()) + ",",
          "  url: " + q(url) + ",",
          "  auth: { username: " + q(key) + ", password: " + q(secret) + " },",
          '  headers: { "Content-Type": "application/json", Accept: "application/json" },',
        ].concat(compact ? ["  data: " + pretty(body, 2) + ","] : [])
          .concat(["});", "", "console.log(status, data);"]).join("\n");

      case "python":
        return [
          "# pip install requests",
          "import requests",
          "",
          "url = " + q(url),
          "auth = (" + q(key) + ", " + q(secret) + ")",
          'headers = {"Content-Type": "application/json", "Accept": "application/json"}',
        ].concat(compact ? ["payload = " + pyLit(body)] : [])
          .concat([
            "",
            "res = requests." + m.toLowerCase() + "(url, auth=auth, headers=headers" +
              (compact ? ", json=payload" : "") + ")",
            "print(res.status_code, res.json())",
          ]).join("\n");

      case "php":
        return [
          "<?php",
          "$ch = curl_init(" + q(url) + ");",
          "curl_setopt_array($ch, [",
          "    CURLOPT_CUSTOMREQUEST => " + q(m) + ",",
          "    CURLOPT_RETURNTRANSFER => true,",
          "    CURLOPT_USERPWD => " + q(key + ":" + secret) + ",",
          '    CURLOPT_HTTPHEADER => ["Content-Type: application/json", "Accept: application/json"],',
        ].concat(compact ? ["    CURLOPT_POSTFIELDS => " + q(compact) + ","] : [])
          .concat([
            "]);",
            "",
            "$response = curl_exec($ch);",
            "echo curl_getinfo($ch, CURLINFO_HTTP_CODE), PHP_EOL, $response, PHP_EOL;",
            "curl_close($ch);",
          ]).join("\n");

      case "ruby":
        return [
          "require 'net/http'",
          "require 'uri'",
          "require 'json'",
          "",
          "uri = URI.parse(" + rq(url) + ")",
          "request = Net::HTTP::" + rubyClass(m) + ".new(uri, 'Content-Type' => 'application/json', 'Accept' => 'application/json')",
          "request.basic_auth(" + rq(key) + ", " + rq(secret) + ")",
        ].concat(compact ? ["request.body = " + rq(compact)] : [])
          .concat([
            "",
            "response = Net::HTTP.start(uri.hostname, uri.port, use_ssl: true) do |http|",
            "  http.request(request)",
            "end",
            "",
            "puts response.code",
            "puts response.body",
          ]).join("\n");

      case "java":
        return [
          "import java.net.URI;",
          "import java.net.http.*;",
          "import java.util.Base64;",
          "",
          'String auth = Base64.getEncoder().encodeToString(("' + key + ":" + secret + '").getBytes());',
          "",
          "HttpRequest request = HttpRequest.newBuilder()",
          "    .uri(URI.create(" + q(url) + "))",
          '    .header("Authorization", "Basic " + auth)',
          '    .header("Content-Type", "application/json")',
          '    .header("Accept", "application/json")',
          "    " + javaVerb(m, compact),
          "    .build();",
          "",
          "HttpResponse<String> response = HttpClient.newHttpClient()",
          "    .send(request, HttpResponse.BodyHandlers.ofString());",
          "",
          "System.out.println(response.statusCode());",
          "System.out.println(response.body());",
        ].join("\n");

      case "go":
        return [
          "package main",
          "",
          "import (",
          '\t"fmt"',
          '\t"io"',
          '\t"net/http"',
          compact ? '\t"strings"' : "",
          ")",
          "",
          "func main() {",
          compact ? "\tbody := strings.NewReader(" + gq(compact) + ")" : "",
          "\treq, _ := http.NewRequest(" + q(m) + ", " + q(url) + ", " + (compact ? "body" : "nil") + ")",
          "\treq.SetBasicAuth(" + q(key) + ", " + q(secret) + ")",
          '\treq.Header.Set("Content-Type", "application/json")',
          '\treq.Header.Set("Accept", "application/json")',
          "",
          "\tres, err := http.DefaultClient.Do(req)",
          "\tif err != nil {",
          "\t\tpanic(err)",
          "\t}",
          "\tdefer res.Body.Close()",
          "",
          "\tout, _ := io.ReadAll(res.Body)",
          "\tfmt.Println(res.StatusCode, string(out))",
          "}",
        ].filter(function (l) { return l !== ""; }).join("\n");
    }
    return "";
  }

  function safeJson(s) { try { JSON.parse(s); return true; } catch (e) { return false; } }
  function q(s) { return JSON.stringify(String(s)); }
  function rq(s) { return "'" + String(s).replace(/\\/g, "\\\\").replace(/'/g, "\\'") + "'"; }
  function gq(s) { return "`" + String(s).replace(/`/g, "` + \"`\" + `") + "`"; }
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
      var s = JSON.stringify(JSON.parse(json), null, 2);
      var pad = " ".repeat(indent);
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

  /* ---------- 结果 / 代码面板 ---------- */

  function renderOut() {
    var isEp = state.current && state.current.kind === "endpoint";
    var tabs = el("out-tabs"), pane = el("out-pane");
    if (!isEp) return;

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
      n.addEventListener("click", function () {
        copy(codeBlock.store[n.getAttribute("data-copy")] || "", "代码");
      });
    });
  }

  /* ================= 路由与渲染 ================= */

  function resolve() {
    var m = location.hash.match(/^#\/(endpoint|guide)\/([\w.-]+)/);
    if (m) {
      var list = m[1] === "endpoint" ? state.endpoints : state.guides;
      for (var i = 0; i < list.length; i++) if (list[i].id === m[2]) return { kind: m[1], item: list[i] };
    }
    return { kind: "guide", item: state.guides[0] };
  }

  function route() {
    state.current = resolve();
    var cur = state.current, it = cur.item;
    var isEp = cur.kind === "endpoint";

    el("doc").innerHTML =
      '<div class="doc-head"><div class="breadcrumbs"><span>API v1</span><span>' + esc(it.group) + "</span></div>" +
      '<div class="doc-head-actions">' +
      '<button class="btn" data-act="copy-page">复制页面</button>' +
      (isEp ? '<button class="btn" data-act="toggle-runner">在线运行</button>' : "") +
      "</div></div>" +
      '<div class="markdown" id="md">' + renderMarkdown(it.markdown || "") + "</div>";

    var layout = el("layout");
    if (isEp) {
      layout.classList.toggle("runner-open", state.runnerOpen);
      renderRunner(it);
    } else {
      layout.classList.remove("runner-open");
    }

    el("main").scrollTop = 0;
    document.title = it.name + " | 金数据开放平台 API";
    renderMenu();

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

    window.addEventListener("hashchange", route);

    fetch(SITE + "data.json")
      .then(function (r) { return r.json(); })
      .then(function (d) {
        state.endpoints = d.endpoints || [];
        state.guides = d.guides || [];
        route();
      })
      .catch(function (err) {
        el("doc").innerHTML = '<div class="markdown"><p>文档数据加载失败：' + esc(String(err)) + "</p></div>";
      });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
