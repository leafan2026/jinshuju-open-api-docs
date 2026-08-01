/* 金数据开放平台 · API 文档站前端
 *
 * 内容源是 jinshuju/open-doc 仓库里的 markdown（由 scripts/build-data.mjs 生成 site.json），
 * 排版沿用原站；新增的只有右侧「在线运行」——真实发请求 + 生成多语言请求代码。
 */
(function () {
  "use strict";

  var API_BASE = "https://jinshuju.net";
  var SITE = location.pathname.endsWith("/") ? location.pathname : location.pathname + "/";
  // 静态资源（含正文图片）的基地址，由页面模板写在 <html data-asset-base> 上。
  // 部署到 WDL 时 public/ 在 CDN 上，站点路径下并没有这些文件，所以不能用 SITE 拼图片。
  var ASSET_BASE = (document.documentElement.getAttribute("data-asset-base") || SITE);
  // 留空 = 浏览器直连（默认）。想走转发就设 window.__JSJ_PROXY_URL__
  var PROXY_URL = (typeof window !== "undefined" && window.__JSJ_PROXY_URL__) || "";
  var REQUEST_TIMEOUT_MS = 15000;

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
    abort: null,
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

  /* ================= 链接 / 图片地址 ================= */

  // 正文经过 esc()，地址里可能残留 &#58; 这类实体；浏览器读属性时会解码，
  // 所以协议判断必须先解码，否则 `javascript&#58;` 能绕过白名单。
  var NAMED_ENTITY = { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" };
  function decodeEntities(s) {
    return String(s).replace(/&(?:#(\d+)|#x([0-9a-fA-F]+)|(lt|gt|amp|quot|apos));/g,
      function (_, dec, hex, name) {
        if (dec) return String.fromCharCode(+dec);
        if (hex) return String.fromCharCode(parseInt(hex, 16));
        return NAMED_ENTITY[name] || "";
      });
  }

  function protocolOf(url) {
    var s = decodeEntities(url).replace(/[\u0000-\u0020]/g, "").toLowerCase();
    var m = s.match(/^([a-z][a-z0-9+.\-]*):/);
    return m ? m[1] : "";
  }

  var LINK_PROTOCOLS = { http: 1, https: 1, mailto: 1, tel: 1 };
  var RESOURCE_EXT = /\.(png|jpe?g|gif|svg|webp|pdf|zip|csv|xlsx?|docx?)$/i;

  // 站内路径按「站点根」解析（open-doc 里就是根相对写法），再拼上部署子路径。
  function stripBase(path) {
    return path.replace(/^(?:\.{1,2}\/)+/, "").replace(/^\/+/, "");
  }

  // 构建时 index/overview 会折叠到目录本身（url_params/overview → url_params），
  // 但正文里还按原文件名写链接，这里兜一下，免得落到不存在的路由
  function resolveRoute(route) {
    var docs = state.docs || {};
    if (docs[route] !== undefined) return route;
    var folded = route.replace(/\/(overview|index|readme)$/i, "");
    if (folded !== route && docs[folded] !== undefined) return folded;
    return route;
  }

  // 页面是 Hash 路由，正文里的文档链接必须落到 #/xxx，否则会跳出文档站
  function internalHref(href) {
    var raw = decodeEntities(href);
    var frag = "";
    var qi = raw.indexOf("?");
    if (qi !== -1) {
      var id = raw.slice(qi + 1).match(/(?:^|&)id=([^&]*)/); // docsify 风格的 ?id=锚点
      if (id) frag = id[1];
      raw = raw.slice(0, qi);
    }
    var hi = raw.indexOf("#");
    if (hi !== -1) {
      if (!frag) frag = raw.slice(hi + 1);
      raw = raw.slice(0, hi);
    }
    var path = stripBase(raw);
    if (!path) return frag ? "#" + frag : "#";
    // 图片、附件之类的静态资源：拼资源基地址，别当路由
    if (RESOURCE_EXT.test(path)) return ASSET_BASE + path;
    var route = resolveRoute(path.replace(/\.md$/i, "").replace(/\/$/, ""));
    return "#/" + route + (frag ? "#" + frag : "");
  }

  // 返回 null 表示协议不在白名单，调用方退化成纯文本
  function safeLinkHref(href) {
    var proto = protocolOf(href);
    if (!proto) {
      var raw = decodeEntities(href);
      if (raw.charAt(0) === "#") return raw; // 页内锚点
      return internalHref(href);
    }
    return LINK_PROTOCOLS[proto] ? decodeEntities(href) : null;
  }

  function safeImgSrc(src) {
    var raw = decodeEntities(src);
    var proto = protocolOf(src);
    if (!proto) {
      var path = stripBase(raw);
      return path ? ASSET_BASE + path : null;
    }
    if (proto === "http" || proto === "https") return raw;
    if (proto === "data" && /^data:image\//i.test(raw.trim())) return raw;
    return null;
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
        var safeSrc = safeImgSrc(src);
        if (!safeSrc) return alt;
        return '<img src="' + esc(safeSrc) + '" alt="' + alt + '" loading="lazy">';
      })
      .replace(/\*\*([^*]+)\*\*|__([^_]+)__/g, function (_, a, b) { return "<strong>" + (a || b) + "</strong>"; })
      .replace(/\\([\\`*_{}\[\]()#+\-.!|])/g, "$1")
      .replace(/\[([^\]]*)\]\(([^)\s]+)(?:\s+&quot;[^&]*&quot;)?\)/g, function (_, txt, href) {
        var safeHref = safeLinkHref(href);
        if (safeHref === null) return txt; // 协议不在白名单：只留文字，不生成链接
        var ext = /^https?:/i.test(safeHref);
        return '<a href="' + esc(safeHref) + '"' + (ext ? ' target="_blank" rel="noopener"' : "") + ">" + txt + "</a>";
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

  function requestReadiness() {
    var a = api();
    var issues = [];
    if (!state.creds.key.trim()) issues.push("缺少 API_KEY");
    if (!state.creds.secret.trim()) issues.push("缺少 API_SECRET");

    function valueOf(kind, name) {
      var value = "";
      document.querySelectorAll("[data-" + kind + "]").forEach(function (n) {
        if (n.getAttribute("data-" + kind) === name) value = n.value.trim();
      });
      return value;
    }

    if (a) {
      (a.pathParams || []).forEach(function (p) {
        if (p.required && !valueOf("pp", p.name)) issues.push("缺少 Path 参数 " + p.name);
      });
      (a.queryParams || []).forEach(function (p) {
        if (p.required && !valueOf("qp", p.name)) issues.push("缺少 Query 参数 " + p.name);
      });
    }

    var body = bodyText();
    if (body) {
      try { JSON.parse(body); }
      catch (err) { issues.push("Body JSON 不合法"); }
    }
    return { ok: issues.length === 0, issues: issues };
  }

  function paramHelpButtonHtml() {
    return '<button class="doc-jump" type="button" data-doc-jump="Request" title="定位正文 Request">' +
      '<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">' +
      '<path d="M3 2.5h7.25A1.75 1.75 0 0 1 12 4.25V13H4.75A1.75 1.75 0 0 0 3 14.75V2.5Z"/>' +
      '<path d="M3 12.75h7.25M6 5.5h3.5M6 8h3.5"/></svg>' +
      '<span>参数说明</span><span aria-hidden="true">↗</span></button>';
  }

  function scrollToDocHeading(name) {
    var item = tocItems.find(function (entry) {
      return entry.text.trim().toLowerCase() === String(name).trim().toLowerCase();
    });
    var target = item ? document.getElementById(item.id) : null;
    if (!target) return false;
    el("main").scrollTo({ top: target.offsetTop - 16, behavior: "smooth" });
    return true;
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
      html += '<div class="rgroup"><div class="rgroup-head"><h3>Query 参数</h3>' +
        paramHelpButtonHtml() + "</div>" + a.queryParams.map(function (p) {
        return '<div class="frow"><label title="' + esc(p.name) + '">' + esc(p.name) +
          (p.required ? '<span class="star">*</span>' : "") + "</label>" +
          '<input class="ipt" data-qp="' + esc(p.name) + '" placeholder="可选"></div>';
      }).join("") + "</div>";
    }

    if (!canRun) {
      html += '<div class="rgroup"><div class="rgroup-head"><h3>Body <span class="note">' +
        esc(a.contentType) + "</span></h3>" +
        (a.bodyParams && a.bodyParams.length ? paramHelpButtonHtml() : "") + "</div>" +
        '<div class="hint-box">该接口是文件上传（multipart/form-data），在线运行暂不支持；' +
        "正文「示例代码」一节给出了可直接使用的写法。</div></div>";
    } else if (["POST", "PUT", "PATCH"].indexOf(a.method) !== -1 || (a.alsoMethods || []).length) {
      var init = a.requestExample || "{\n  \n}";
      try { init = JSON.stringify(JSON.parse(init), null, 2); } catch (err) { /* 保留 */ }
      html += '<div class="rgroup"><div class="rgroup-head"><h3>Body <span class="note">application/json</span></h3>' +
        (a.bodyParams && a.bodyParams.length ? paramHelpButtonHtml() : "") + "</div>" +
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
    wrap.querySelectorAll("[data-doc-jump]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var heading = btn.getAttribute("data-doc-jump");
        if (!scrollToDocHeading(heading)) { toast("正文中未找到 " + heading); return; }
        toast("已定位到正文 " + heading);
      });
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
      var t = src.trim();
      var errorInfo = null;
      if (!t) { status.className = "jsed-status"; status.textContent = "空"; status.title = "空"; }
      else {
        try {
          JSON.parse(src); status.className = "jsed-status ok"; status.textContent = "JSON 合法";
          status.title = "JSON 合法";
        } catch (err) {
          errorInfo = jsonErrorInfo(err, src);
          status.className = "jsed-status bad"; status.textContent = "格式错误";
          status.title = errorInfo.detail;
        }
      }
      var n = src.split("\n").length, nums = "";
      for (var i = 1; i <= n; i++) {
        var bad = errorInfo && errorInfo.line === i;
        nums += '<span class="jsed-line' + (bad ? " has-error" : "") + '"' +
          (bad ? ' title="' + esc(errorInfo.detail) + '"' : "") + ">" + i + "</span>";
      }
      gutter.innerHTML = nums;
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
    // 编辑器每换一个接口页面就重建一次，所以这里不能再往 document / modal 上挂监听，
    // 否则每次都新增一份、永不移除。Esc 和点遮罩关闭统一由 init() 注册一次，
    // 通过 state.closeFullEditor 回调到当前这个编辑器。
    state.closeFullEditor = function () {
      if (!box.classList.contains("jsed-full")) return;
      exitFull();
      syncFullBtn();
    };

    syncFullBtn();
    paint();
  }

  function jsonErrorInfo(err, src) {
    var msg = String(err.message || err);
    var line = 1, col = null;
    var pos = msg.match(/position\s+(\d+)/i);
    if (pos) {
      var idx = +pos[1], before = src.slice(0, idx);
      line = before.split("\n").length;
      col = idx - before.lastIndexOf("\n");
    } else {
      var ln = msg.match(/line\s+(\d+)/i);
      var cn = msg.match(/column\s+(\d+)/i);
      if (ln) line = +ln[1];
      if (cn) col = +cn[1];
    }
    var prefix = "第 " + line + " 行" + (col ? "第 " + col + " 列" : "");
    return {
      line: line,
      column: col,
      detail: prefix + ": " + msg.replace(/\s*in JSON at position.*$/, "").replace(/^JSON\.parse:\s*/, ""),
    };
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
  function sendDirect(method, path, body, signal) {
    var started = Date.now();
    var headers = {
      Authorization: basic(state.creds.key, state.creds.secret),
      Accept: "application/json",
      "Content-Type": "application/json",
    };
    return fetch(API_BASE + path, { method: method, headers: headers, body: body || undefined, signal: signal })
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

  function sendViaProxy(method, path, body, signal) {
    return fetch(PROXY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: signal,
      body: JSON.stringify({
        method: method, path: path,
        apiKey: state.creds.key, apiSecret: state.creds.secret,
        body: body || undefined,
      }),
    }).then(function (r) { return r.json(); });
  }

  function setSendBtn(text, sending) {
    var btn = el("btn-send");
    if (!btn) return;
    btn.disabled = false;
    btn.textContent = text;
    btn.classList.toggle("cancel", !!sending);
    btn.title = sending ? "点击中止本次请求" : "";
  }

  function cancelSend() {
    if (state.abort) state.abort();
  }

  function send() {
    if (state.sending) { cancelSend(); return; } // 发送中再点一次 = 取消
    var readiness = requestReadiness();
    if (!readiness.ok) { toast(readiness.issues.join("；")); return; }
    var body = bodyText();

    var method = curMethod(), path = builtPath();

    // 网络挂住时不能一直停在「发送中」：超时自动中断，中途也允许手动取消
    var controller = new AbortController();
    var timedOut = false;
    var timer = setTimeout(function () { timedOut = true; controller.abort(); }, REQUEST_TIMEOUT_MS);

    state.sending = true;
    state.abort = function () { clearTimeout(timer); controller.abort(); };
    setSendBtn("取消", true);
    state.tab = "result"; state.response = { pending: true };
    renderOut();

    (PROXY_URL
      ? sendViaProxy(method, path, body, controller.signal)
      : sendDirect(method, path, body, controller.signal))
      .then(function (r) { state.response = r; })
      .catch(function (err) {
        var aborted = err && (err.name === "AbortError" || err.name === "TimeoutError");
        if (aborted && timedOut) {
          state.response = {
            error: "请求超时：" + Math.round(REQUEST_TIMEOUT_MS / 1000) + " 秒内没有收到响应。\n\n" +
              "可以检查网络后重试，或确认地址与参数是否正确。",
          };
        } else if (aborted) {
          state.response = { error: "已取消本次请求。" };
        } else {
          state.response = {
            error: "请求失败：" + String(err && err.message ? err.message : err) +
              "\n\n浏览器直连被拦截时，常见原因是网络策略或 CORS。" +
              "可以在页面里设置 window.__JSJ_PROXY_URL__ 指向一个转发端点（见 README）。",
          };
        }
      })
      .finally(function () {
        clearTimeout(timer);
        state.sending = false;
        state.abort = null;
        setSendBtn("发送", false);
        renderOut();
      });
  }

  /* ---------- 请求代码 ---------- */

  function snippet(lang) {
    if (!api()) return "";
    var url = API_BASE + builtPath();
    var key = state.creds.key;
    var secret = state.creds.secret;
    var body = bodyText();
    var compact = null;
    if (body) { try { compact = JSON.stringify(JSON.parse(body)); } catch (e) { compact = null; } }
    var m = curMethod();
    var authorization = basic(key, secret);

    switch (lang) {
      case "curl":
        // --request 必须显式给出：只有 --data 时 curl 会按 POST 发，
        // 不带 body 的 DELETE 会退化成 GET
        var curlLines = ["curl --location --request " + m + " " + shq(url),
          "--header " + shq("Authorization: " + authorization),
          "--header 'Content-Type: application/json'",
          "--header 'Accept: application/json'"];
        if (compact) {
          curlLines.push("--data " + shq(compact));
        }
        var curlCommand = curlLines.map(function (line, i) {
          return line + (i < curlLines.length - 1 ? " \\" : "");
        }).join("\n");
        return curlCommand;

      case "js":
        return ["const headers = new Headers();",
          "headers.append(\"Authorization\", " + q(authorization) + ");",
          "headers.append(\"Content-Type\", \"application/json\");",
          "headers.append(\"Accept\", \"application/json\");"]
          .concat(["", "const requestOptions = {", "  method: " + q(m) + ",", "  headers,",
            compact ? "  body: JSON.stringify(" + pretty(body, 2) + ")," : "",
            '  redirect: "follow",', "};", "",
            "fetch(" + q(url) + ", requestOptions)", "  .then((response) => response.text())",
            "  .then(console.log)", "  .catch(console.error);"])
          .filter(function (line) { return line !== "" || !compact; }).join("\n");

      case "node":
        return ["// npm i axios", 'import axios from "axios";', "",
          "const config = {", "  method: " + q(m.toLowerCase()) + ",", "  maxBodyLength: Infinity,",
          "  url: " + q(url) + ",", "  headers: {", "    Authorization: " + q(authorization) + ",",
          '    "Content-Type": "application/json",', '    Accept: "application/json",']
          .concat(["  },"])
          .concat(compact ? ["  data: " + pretty(body, 2) + ","] : [])
          .concat(["};", "", "axios.request(config)", "  .then((response) => console.log(response.data))",
            "  .catch((error) => console.error(error));"]).join("\n");

      case "python":
        var pythonLines = ["import requests"];
        if (compact) pythonLines.push("import json");
        pythonLines.push("", "url = " + q(url), "");
        pythonLines.push(compact ? "payload = json.dumps(" + pyPayload(body, 0) + ")" : "payload = {}");
        pythonLines.push("", "headers = {", "  'Authorization': " + rq(authorization) + ",",
          "  'Content-Type': 'application/json',", "  'Accept': 'application/json'");
        pythonLines.push("}", "", "response = requests.request(" + q(m) + ", url, headers=headers, data=payload)", "", "print(response.text)");
        return pythonLines.join("\n");

      case "php":
        return ["<?php", "", "$curl = curl_init();", "", "curl_setopt_array($curl, [",
          "    CURLOPT_URL => " + rq(url) + ",", "    CURLOPT_RETURNTRANSFER => true,",
          "    CURLOPT_FOLLOWLOCATION => true,", "    CURLOPT_CUSTOMREQUEST => " + rq(m) + ","]
          .concat(compact ? ["    CURLOPT_POSTFIELDS => " + rq(compact) + ","] : [])
          .concat(["    CURLOPT_HTTPHEADER => [", "        " + rq("Authorization: " + authorization) + ",",
            "        'Content-Type: application/json',", "        'Accept: application/json'", "    ],", "]);", "",
            "$response = curl_exec($curl);", "curl_close($curl);", "", "echo $response;"]).join("\n");

      case "ruby":
        return ["require 'uri'", "require 'net/http'", "", "url = URI(" + rq(url) + ")", "",
          "https = Net::HTTP.new(url.host, url.port)", "https.use_ssl = true", "",
          "request = Net::HTTP::" + rubyClass(m) + ".new(url)",
          "request['Authorization'] = " + rq(authorization),
          "request['Content-Type'] = 'application/json'", "request['Accept'] = 'application/json'"]
          .concat(compact ? ["request.body = " + rq(compact)] : [])
          .concat(["", "response = https.request(request)", "puts response.read_body"]).join("\n");

      case "java":
        var javaLines = ["import java.net.URI;", "import java.net.http.*;", "", "public class Main {",
          "  public static void main(String[] args) throws Exception {", "    HttpRequest request = HttpRequest.newBuilder()",
          "        .uri(URI.create(" + q(url) + "))",
          "        .header(\"Authorization\", " + q(authorization) + ")",
          '        .header("Content-Type", "application/json")',
          '        .header("Accept", "application/json")'];
        return javaLines.concat([
          "        " + javaVerb(m, compact), "        .build();", "",
          "    HttpResponse<String> response = HttpClient.newHttpClient()",
          "        .send(request, HttpResponse.BodyHandlers.ofString());", "", "    System.out.println(response.body());",
          "  }", "}"]).join("\n");

      case "go":
        var goLines = ["package main", "", "import (", '\t"fmt"', '\t"io"', '\t"net/http"'];
        if (compact) goLines.push('\t"strings"');
        goLines.push(")", "", "func main() {");
        if (compact) goLines.push("\tbody := strings.NewReader(" + gq(compact) + ")");
        goLines.push("\treq, _ := http.NewRequest(" + q(m) + ", " + q(url) + ", " + (compact ? "body" : "nil") + ")");
        goLines.push("\treq.Header.Add(\"Authorization\", " + q(authorization) + ")");
        goLines.push('\treq.Header.Add("Content-Type", "application/json")');
        goLines.push('\treq.Header.Add("Accept", "application/json")');
        goLines.push("", "\tres, err := http.DefaultClient.Do(req)", "\tif err != nil {", "\t\tpanic(err)", "\t}",
          "\tdefer res.Body.Close()", "", "\tbody, err := io.ReadAll(res.Body)",
          "\tif err != nil {", "\t\tpanic(err)", "\t}", "\tfmt.Println(string(body))", "}");
        return goLines.join("\n");
    }
    return "";
  }

  function q(s) { return JSON.stringify(String(s)); }
  function shq(s) { return "'" + String(s).replace(/'/g, "'\"'\"'") + "'"; }
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
  // JSON 直接塞进 Python 会报 NameError：true/false/null 得写成 True/False/None。
  // 字符串沿用 JSON.stringify——它产出的转义（\n \t \" \\ \uXXXX）Python 全都认。
  function pyLiteral(value, indent) {
    if (value === null) return "None";
    if (value === true) return "True";
    if (value === false) return "False";
    if (typeof value === "number") return isFinite(value) ? String(value) : "None";
    if (typeof value === "string") return JSON.stringify(value);
    var pad = " ".repeat(indent), padIn = " ".repeat(indent + 2);
    if (Array.isArray(value)) {
      if (!value.length) return "[]";
      return "[\n" + value.map(function (v) { return padIn + pyLiteral(v, indent + 2); }).join(",\n") +
        "\n" + pad + "]";
    }
    var keys = Object.keys(value);
    if (!keys.length) return "{}";
    return "{\n" + keys.map(function (k) {
      return padIn + JSON.stringify(k) + ": " + pyLiteral(value[k], indent + 2);
    }).join(",\n") + "\n" + pad + "}";
  }

  function pyPayload(body, indent) {
    try {
      return pyLiteral(JSON.parse(body), indent);
    } catch (err) {
      return pretty(body, indent); // 调用点已确认 body 是合法 JSON，这里只是兜底
    }
  }

  function pretty(json, indent) {
    try {
      var s = JSON.stringify(JSON.parse(json), null, 2), pad = " ".repeat(indent);
      return s.split("\n").map(function (l, i) { return i === 0 ? l : pad + l; }).join("\n");
    } catch (e) { return json; }
  }
  var SNIP_LANG = { curl: "bash", js: "javascript", node: "javascript", python: "python", php: "php", ruby: "ruby", java: "java", go: "go" };

  function renderOut() {
    if (!api()) return;
    var tabs = el("out-tabs"), pane = el("out-pane");
    var readiness = requestReadiness();

    var right = "";
    if (state.tab === "result" && state.response && !state.response.pending && !state.response.error) {
      var ok = state.response.status >= 200 && state.response.status < 300;
      right = ok
        ? '<span class="pill ok">' + state.response.status + "</span>"
        : '<button class="pill bad status-doc-jump" type="button" title="查看正文状态码说明">' +
          state.response.status + "</button>";
      right +=
        '<span class="ms">' + state.response.durationMs + " ms</span>";
    } else if (state.tab === "code") {
      right = '<span class="pill ' + (readiness.ok ? "ok" : "bad") + '">' +
        (readiness.ok ? "可执行" : "待填写") + '</span>' +
        '<select class="lang-select" id="lang-sel">' + LANGS.map(function (l) {
        return '<option value="' + l.id + '"' + (l.id === state.lang ? " selected" : "") + ">" + l.label + "</option>";
      }).join("") + "</select>";
    }

    tabs.innerHTML =
      '<button class="tab' + (state.tab === "result" ? " on" : "") + '" data-tab="result">返回结果</button>' +
      '<button class="tab' + (state.tab === "code" ? " on" : "") + '" data-tab="code">请求代码</button>' +
      '<span class="right">' + right + "</span>";

    if (state.tab === "code") {
      if (!readiness.ok) {
        pane.innerHTML = '<div class="out-empty"><div class="ico">' +
          '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">' +
          '<path d="M12 8v5M12 16.5v.5M10.3 3.8L2.5 17.3A2 2 0 004.2 20h15.6a2 2 0 001.7-2.7L13.7 3.8a2 2 0 00-3.4 0z"/></svg></div>' +
          '<div><strong>填写完整后生成可执行代码</strong><br>' + esc(readiness.issues.join("；")) + "</div></div>";
      } else {
        pane.innerHTML = '<div class="code-ready-note">已代入当前参数和凭据，请勿分享生成的代码。</div>' +
          codeBlock(snippet(state.lang), SNIP_LANG[state.lang]);
      }
    } else if (!state.response) {
      pane.innerHTML = '<div class="out-empty"><div class="ico">' +
        '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">' +
        '<path d="M5 19l3.5-1.2 8-8a2.5 2.5 0 10-3.5-3.5l-8 8L5 19z"/></svg></div>' +
        "<div>填好参数后点「发送」查看真实返回<br>也可以切到「请求代码」直接复制</div></div>";
    } else if (state.response.pending) {
      pane.innerHTML = '<div class="out-empty">请求中…<br><span class="note">最多等 ' +
        Math.round(REQUEST_TIMEOUT_MS / 1000) + ' 秒，也可以点「取消」中止</span></div>';
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
    var statusJump = tabs.querySelector(".status-doc-jump");
    if (statusJump) statusJump.addEventListener("click", function () {
      if (scrollToDocHeading("状态码")) { toast("已定位到正文状态码"); return; }
      location.hash = "#/api_v1/status_code";
    });
    bindCopy(pane);
  }

  // 源码从 store 转交给闭包持有：元素被下一次 innerHTML 覆盖时一起回收，
  // 不会像原来那样把历史代码（含已替换的 Authorization）一直攒在 store 里
  function bindCopy(root) {
    root.querySelectorAll("[data-copy]").forEach(function (n) {
      var id = n.getAttribute("data-copy");
      var src = (codeBlock.store && codeBlock.store[id]) || "";
      if (codeBlock.store) delete codeBlock.store[id];
      n.addEventListener("click", function () { copy(src, "代码"); });
    });
  }

  /* ================= URL 传参生成器 ================= */

  // 这两页讲的是怎么手工拼带签名的表单链接，最容易错的两处交给代码做：
  //   1. 字段 API CODE 必须按字典序升序拼接（和文档里 Java TreeMap / Python sorted 一致），
  //      顺序错了签名就对不上
  //   2. 签名针对「未编码的原始值」计算，最终 URL 里才做 URL 编码
  // sign_secret 只在浏览器里参与计算，不发给任何服务器。
  var URL_TOOLS = {
    "url_params/form_field_url_params": {
      title: "在线生成带签名的表单链接",
      prefix: "field_",
      placeholder: "field_1",
      rowHint: "字段 API CODE 与要传入的值",
      secretHint: "企业密钥 sign_secret（只在本机参与计算，不会发送）",
    },
    "url_params/global_field_url_params": {
      title: "在线生成带 JWT 的表单链接",
      prefix: "gf_",
      placeholder: "gf_1",
      rowHint: "全局字段 API CODE 与要传入的值",
      secretHint: "企业密钥 sign_secret（JWT 必需，只在本机参与计算，不会发送）",
      jwt: true,
    },
  };

  var FORM_BASE = "https://jinshuju.net/f/";
  var utf8 = new TextEncoder();

  function bytesToB64(bytes) {
    var bin = "";
    for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
  }
  function bytesToHex(bytes) {
    var out = "";
    for (var i = 0; i < bytes.length; i++) out += ("0" + bytes[i].toString(16)).slice(-2);
    return out;
  }
  function b64ToB64Url(s) {
    return s.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  function hmacSha256(secret, message) {
    return crypto.subtle
      .importKey("raw", utf8.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"])
      .then(function (key) { return crypto.subtle.sign("HMAC", key, utf8.encode(message)); })
      .then(function (sig) { return new Uint8Array(sig); });
  }

  // 文档里三份示例（Java/Python/Ruby）都是：先取 hex 摘要，再对那串 hex 做 Base64
  function signParams(secret, urlParams) {
    return hmacSha256(secret, urlParams).then(function (bytes) {
      return bytesToB64(utf8.encode(bytesToHex(bytes)));
    });
  }

  function jwtHS256(secret, payload) {
    var head = b64ToB64Url(bytesToB64(utf8.encode(JSON.stringify({ alg: "HS256", typ: "JWT" }))));
    var body = b64ToB64Url(bytesToB64(utf8.encode(JSON.stringify(payload))));
    var signing = head + "." + body;
    return hmacSha256(secret, signing).then(function (bytes) {
      return signing + "." + b64ToB64Url(bytesToB64(bytes));
    });
  }

  function urlToolHtml(cfg, id) {
    return '<h2 id="' + id + '">' + esc(cfg.title) + "</h2>" +
      '<div class="urltool" id="urltool">' +
      '<div class="urltool-grid">' +
      '<label>表单 Token</label>' +
      '<input class="ipt" id="ut-token" type="text" placeholder="表单链接 /f/ 后面那串" autocomplete="off">' +
      "<label>sign_secret</label>" +
      '<input class="ipt" id="ut-secret" type="password" placeholder="' + esc(cfg.secretHint) + '" autocomplete="off">' +
      "</div>" +
      '<div class="urltool-rows-head"><span>' + esc(cfg.rowHint) + "</span>" +
      '<button class="mini" id="ut-add">添加一行</button></div>' +
      '<div class="urltool-rows" id="ut-rows"></div>' +
      '<div class="urltool-out" id="ut-out"></div>' +
      "</div>";
  }

  function mountUrlTool(cfg) {
    var rowsBox = el("ut-rows"), out = el("ut-out");
    if (!rowsBox) return;
    var rows = [{ key: cfg.prefix + "1", value: "" }, { key: cfg.prefix + "2", value: "" }];
    var seq = 0;

    function drawRows() {
      rowsBox.innerHTML = rows.map(function (r, i) {
        return '<div class="urltool-row">' +
          '<input class="ipt code" data-k="' + i + '" value="' + esc(r.key) + '" placeholder="' + esc(cfg.placeholder) + '" autocomplete="off">' +
          '<input class="ipt" data-v="' + i + '" value="' + esc(r.value) + '" placeholder="要传入的值" autocomplete="off">' +
          '<button class="mini ghost" data-del="' + i + '" title="删除这一行" aria-label="删除这一行">✕</button>' +
          "</div>";
      }).join("");
      rowsBox.querySelectorAll("[data-k]").forEach(function (n) {
        n.addEventListener("input", function () { rows[+n.getAttribute("data-k")].key = n.value; update(); });
      });
      rowsBox.querySelectorAll("[data-v]").forEach(function (n) {
        n.addEventListener("input", function () { rows[+n.getAttribute("data-v")].value = n.value; update(); });
      });
      rowsBox.querySelectorAll("[data-del]").forEach(function (n) {
        n.addEventListener("click", function () {
          rows.splice(+n.getAttribute("data-del"), 1);
          if (!rows.length) rows.push({ key: cfg.prefix + "1", value: "" });
          drawRows(); update();
        });
      });
    }

    function update() {
      var token = el("ut-token").value.trim();
      var secret = el("ut-secret").value;
      var filled = rows.filter(function (r) { return r.key.trim(); });
      var mine = ++seq; // 异步算签名，只认最后一次输入的结果

      if (!filled.length) {
        out.innerHTML = '<div class="urltool-note">填一个字段 API CODE 就能看到生成结果。</div>';
        return;
      }

      // 升序是签名能对上的前提，这里直接按字典序排（与文档示例的 TreeMap / sorted 一致）
      var sorted = filled.slice().sort(function (a, b) {
        return a.key.trim() < b.key.trim() ? -1 : a.key.trim() > b.key.trim() ? 1 : 0;
      });
      var reordered = sorted.some(function (r, i) { return r !== filled[i]; });
      var shownToken = token || "YOUR_FORM_TOKEN";

      if (cfg.jwt) {
        var payload = {};
        sorted.forEach(function (r) { payload[r.key.trim()] = r.value; });
        if (!secret) {
          render(mine, [
            block("原始数据", JSON.stringify(payload, null, 2), "json"),
            note("填入 sign_secret 后会生成 JWT 和完整链接。JWT 只签名、不加密，别放私密信息。"),
          ]);
          return;
        }
        jwtHS256(secret, payload).then(function (jwt) {
          render(mine, [
            block("原始数据", JSON.stringify(payload, null, 2), "json"),
            block("JWT", jwt, "text"),
            block("表单链接", FORM_BASE + shownToken + "?cusd=" + encodeURIComponent(jwt), "text"),
            token ? "" : note("填入表单 Token 才是可直接打开的链接。"),
          ]);
        });
        return;
      }

      // 签名针对未编码的原始值；最终 URL 里才做 URL 编码
      var signBase = sorted.map(function (r) { return r.key.trim() + "=" + r.value; }).join("&");
      var query = sorted.map(function (r) {
        return r.key.trim() + "=" + encodeURIComponent(r.value);
      }).join("&");

      var parts = [
        block("签名用的参数串（按 API CODE 升序，值不编码）", signBase, "text"),
        reordered ? note("你填的顺序不是升序，已自动按 API CODE 升序重排——顺序错了签名就对不上。") : "",
      ];

      if (!secret) {
        parts.push(block("表单链接（未签名）", FORM_BASE + shownToken + "?" + query, "text"));
        parts.push(note("填入 sign_secret 后会追加 sign 参数。"));
        render(mine, parts);
        return;
      }
      signParams(secret, signBase).then(function (sign) {
        parts.push(block("sign", sign, "text"));
        parts.push(block("表单链接", FORM_BASE + shownToken + "?" + query + "&sign=" + encodeURIComponent(sign), "text"));
        if (!token) parts.push(note("填入表单 Token 才是可直接打开的链接。"));
        render(mine, parts);
      });
    }

    function block(label, text, lang) {
      return '<div class="urltool-block"><div class="urltool-label">' + esc(label) + "</div>" +
        codeBlock(text, lang) + "</div>";
    }
    function note(text) { return '<div class="urltool-note">' + esc(text) + "</div>"; }
    function render(mine, parts) {
      if (mine !== seq) return; // 有更新的输入了，丢掉这次结果
      out.innerHTML = parts.filter(Boolean).join("");
      bindCopy(out);
    }

    el("ut-token").addEventListener("input", update);
    el("ut-secret").addEventListener("input", update);
    el("ut-add").addEventListener("click", function () {
      rows.push({ key: cfg.prefix + (rows.length + 1), value: "" });
      drawRows(); update();
    });
    drawRows();
    update();
  }

  /* ================= 路由 ================= */

  function resolve() {
    var raw = location.hash.replace(/^#\/?/, "");
    var frag = "";
    var hi = raw.indexOf("#");
    if (hi !== -1) { frag = raw.slice(hi + 1); raw = raw.slice(0, hi); }
    // 中文标题在 location.hash 里是百分号编码的，解码后才能对上元素 id
    try { frag = decodeURIComponent(frag); } catch (err) { /* 保持原样 */ }
    raw = raw.replace(/\/$/, "");
    var doc = state.docs[raw];
    if (!doc && raw === "") doc = state.docs[""];
    if (!doc) doc = state.docs[state.order[0]];
    return { doc: doc, frag: frag };
  }

  var HOME_ICON = '<svg viewBox="0 0 24 24" class="breadcrumb-home" aria-hidden="true">' +
    '<path fill="currentColor" d="M10 19v-5h4v5c0 .55.45 1 1 1h3c.55 0 1-.45 1-1v-7h1.7c.46 0 .68-.57.33-.87L12.67 3.6c-.38-.34-.96-.34-1.34 0l-8.36 7.53c-.34.3-.13.87.33.87H5v7c0 .55.45 1 1 1h3c.55 0 1-.45 1-1z"/></svg>';
  var COPY_PAGE_ICON = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true">' +
    '<rect x="5.5" y="5.5" width="8" height="8" rx="1.5"/><path d="M3.5 10.5h-1A1.5 1.5 0 011 9V2.5A1.5 1.5 0 012.5 1H9a1.5 1.5 0 011.5 1.5v1"/></svg>';
  var RUNNER_ICON = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true">' +
    '<circle cx="8" cy="8" r="6.25"/><path d="M6.5 5.25L10.75 8 6.5 10.75z" fill="currentColor" stroke="none"/></svg>';

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
    codeBlock.store = {}; // 上一页的代码块 id 已失效，别留着
    var bodyHtml = renderMarkdown(r.doc.markdown, true);

    // URL 传参这两页讲的是手工拼签名链接，正文末尾接一个生成器
    var urlTool = URL_TOOLS[r.doc.route];
    if (urlTool) {
      var toolId = slugify(urlTool.title);
      tocItems.push({ level: 2, id: toolId, text: urlTool.title });
      bodyHtml += urlToolHtml(urlTool, toolId);
    }

    el("doc").innerHTML =
      '<div class="doc-head' + (r.doc.route === "" ? " no-crumbs" : "") + '">' +
      breadcrumbsHtml(r.doc) +
      '<div class="doc-head-actions">' +
      '<button class="btn" data-act="copy-page" title="复制原始 Markdown">' + COPY_PAGE_ICON + '<span>复制页面</span></button>' +
      (r.doc.api ? '<button class="btn" data-act="toggle-runner">' + RUNNER_ICON + '<span>在线运行</span></button>' : "") +
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
    if (state.refreshLayout) state.refreshLayout();

    if (urlTool) mountUrlTool(urlTool);

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
        if (a === "copy-page") copy(r.doc.markdown.replace(/\s+$/, "") + "\n", "Markdown");
        else if (a === "toggle-runner") {
          state.runnerOpen = !layout.classList.contains("runner-open");
          layout.classList.toggle("runner-open", state.runnerOpen);
          if (state.refreshLayout) state.refreshLayout();
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

  /* ================= 可调布局 ================= */

  var MAIN_SAFE_WIDTH = 760;

  function clamp(n, min, max) { return Math.min(max, Math.max(min, n)); }

  function initResizers() {
    var root = document.documentElement;
    var runner = document.querySelector(".runner");
    var runnerTop = document.querySelector(".runner-top");
    var runnerOut = document.querySelector(".runner-out");

    function remember(key, value) {
      try { localStorage.setItem(key, String(Math.round(value))); } catch (e) { /* noop */ }
    }

    function recalled(key, fallback) {
      try {
        var value = Number(localStorage.getItem(key));
        return Number.isFinite(value) && value > 0 ? value : fallback;
      } catch (e) { return fallback; }
    }

    function cssNumber(name) {
      return parseFloat(getComputedStyle(root).getPropertyValue(name)) || 0;
    }

    function sidebarBounds() {
      return { min: 220, max: Math.min(420, Math.max(280, window.innerWidth * 0.32)) };
    }

    function runnerDockLimit() {
      var sidebarWidth = window.innerWidth > 1240 ?
        document.querySelector(".sidebar").getBoundingClientRect().width : 0;
      var safeMax = window.innerWidth - sidebarWidth - MAIN_SAFE_WIDTH - 24;
      var defaultWidth = window.innerWidth <= 1560 ? 440 : 480;
      return Math.max(defaultWidth, Math.min(720, safeMax));
    }

    function runnerBounds() {
      var max = Math.min(960, window.innerWidth * 0.68, window.innerWidth - 32);
      return { min: 360, max: Math.max(360, max) };
    }

    function updateRunnerMode(value) {
      var layout = el("layout");
      if (!layout.classList.contains("runner-open") || window.innerWidth <= 820) {
        layout.classList.remove("runner-overlay");
        return;
      }
      var limit = runnerDockLimit();
      if (!layout.classList.contains("runner-overlay") && value > limit + 1) {
        layout.classList.add("runner-overlay");
      } else if (layout.classList.contains("runner-overlay") && value <= limit) {
        layout.classList.remove("runner-overlay");
      }
    }

    function splitBounds() {
      var topHeight = runnerTop ? runnerTop.getBoundingClientRect().height : 50;
      var available = runner ? runner.getBoundingClientRect().height - topHeight - 262 : 520;
      return { min: 180, max: Math.max(180, available) };
    }

    function setValue(handle, property, value, bounds) {
      value = clamp(value, bounds.min, bounds.max);
      root.style.setProperty(property, Math.round(value) + "px");
      handle.setAttribute("aria-valuemin", Math.round(bounds.min));
      handle.setAttribute("aria-valuemax", Math.round(bounds.max));
      handle.setAttribute("aria-valuenow", Math.round(value));
      return value;
    }

    function bind(handle, options) {
      if (!handle) return;

      function current() { return options.measure(); }
      function defaultValue() {
        return typeof options.defaultValue === "function" ? options.defaultValue() : options.defaultValue;
      }
      function apply(value) {
        var bounds = options.bounds();
        value = clamp(value, bounds.min, bounds.max);
        if (options.beforeApply) options.beforeApply(value);
        return setValue(handle, options.property, value, bounds);
      }
      function finish(value) { remember(options.storage, apply(value)); }

      handle.addEventListener("pointerdown", function (ev) {
        if (ev.isPrimary === false) return;
        ev.preventDefault();
        var startPoint = options.axis === "x" ? ev.clientX : ev.clientY;
        var startValue = current();
        var bodyClass = options.axis === "x" ? "resize-col" : "resize-row";
        handle.classList.add("active");
        document.body.classList.add(bodyClass);
        if (handle.setPointerCapture) handle.setPointerCapture(ev.pointerId);

        function move(moveEvent) {
          var point = options.axis === "x" ? moveEvent.clientX : moveEvent.clientY;
          apply(startValue + (point - startPoint) * options.direction);
        }
        function end(endEvent) {
          window.removeEventListener("pointermove", move);
          window.removeEventListener("pointerup", end);
          window.removeEventListener("pointercancel", end);
          handle.classList.remove("active");
          document.body.classList.remove(bodyClass);
          if (handle.releasePointerCapture && handle.hasPointerCapture(endEvent.pointerId)) {
            handle.releasePointerCapture(endEvent.pointerId);
          }
          finish(current());
        }
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", end);
        window.addEventListener("pointercancel", end);
      });

      handle.addEventListener("keydown", function (ev) {
        var physical = 0;
        if (options.axis === "x" && ev.key === "ArrowLeft") physical = -10;
        if (options.axis === "x" && ev.key === "ArrowRight") physical = 10;
        if (options.axis === "y" && ev.key === "ArrowUp") physical = -12;
        if (options.axis === "y" && ev.key === "ArrowDown") physical = 12;
        if (!physical) return;
        ev.preventDefault();
        finish(current() + physical * options.direction);
      });

      handle.addEventListener("dblclick", function () { finish(defaultValue()); });
      apply(recalled(options.storage, defaultValue()));
      options.refresh = function () { apply(cssNumber(options.property) || current()); };
    }

    var configs = [
      {
        handle: el("resize-sidebar"), property: "--sidebar-w", storage: "jsj_sidebar_w",
        axis: "x", direction: 1, defaultValue: 280, bounds: sidebarBounds,
        measure: function () { return document.querySelector(".sidebar").getBoundingClientRect().width; },
      },
      {
        handle: el("resize-runner"), property: "--runner-w", storage: "jsj_runner_w",
        axis: "x", direction: -1,
        defaultValue: function () { return window.innerWidth <= 1560 ? 440 : 480; },
        bounds: runnerBounds,
        beforeApply: updateRunnerMode,
        measure: function () { return runner.getBoundingClientRect().width; },
      },
      {
        handle: el("resize-runner-split"), property: "--runner-out-h", storage: "jsj_runner_out_h",
        axis: "y", direction: -1, defaultValue: 344, bounds: splitBounds,
        measure: function () { return runnerOut.getBoundingClientRect().height; },
      },
    ];

    // 1280 这类窗口上，停靠的调试面板 + 目录 + 总览会把正文压到三百来像素。
    // 正文低于这个宽度就先收起「本页总览」——它是三者里最可让的。
    var MIN_DOC_WIDTH = 520;
    function syncTocVisibility() {
      var layout = el("layout"), main = el("main");
      if (!layout || !main) return;
      var tocWidth = cssNumber("--toc-w") || 210;
      // 浮层模式下 main 是全宽，这里量出来自然就够宽，总览会保留
      var available = main.getBoundingClientRect().width - tocWidth - 44;
      layout.classList.toggle("toc-cramped", available < MIN_DOC_WIDTH);
    }

    configs.forEach(function (config) { bind(config.handle, config); });
    function refreshAll() {
      configs.forEach(function (config) { if (config.refresh) config.refresh(); });
      syncTocVisibility();
    }
    state.refreshLayout = refreshAll;
    refreshAll();
    window.addEventListener("resize", refreshAll);

    // 切页面时 refreshAll 的测量会早于浏览器把新布局算出来，光靠它会漏判；
    // 直接盯正文区的实际宽度，拖面板、缩窗口、换页面都能覆盖。
    // （收起总览不改变 main 的宽度，所以不会自激。）
    if (window.ResizeObserver) {
      new ResizeObserver(syncTocVisibility).observe(el("main"));
    }
  }

  /* ================= 启动 ================= */

  function init() {
    var th = "light";
    try { th = localStorage.getItem("jsj_theme") || "light"; } catch (e) { /* noop */ }
    applyTheme(th);
    initResizers();
    el("btn-theme").addEventListener("click", function () {
      applyTheme(document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark");
    });
    el("btn-close-runner").addEventListener("click", function () {
      state.runnerOpen = false;
      el("layout").classList.remove("runner-open", "runner-overlay");
      if (state.refreshLayout) state.refreshLayout();
    });
    el("runner-backdrop").addEventListener("click", function () {
      state.runnerOpen = false;
      el("layout").classList.remove("runner-open", "runner-overlay");
      if (state.refreshLayout) state.refreshLayout();
    });

    var search = el("search");
    search.addEventListener("input", function () { state.filter = search.value; renderMenu(); });
    document.addEventListener("keydown", function (ev) {
      if ((ev.metaKey || ev.ctrlKey) && ev.key.toLowerCase() === "k") { ev.preventDefault(); search.focus(); search.select(); }
      if (ev.key === "Escape") {
        if (document.activeElement === search) {
          search.value = ""; state.filter = ""; renderMenu(); search.blur();
        } else if (state.closeFullEditor) {
          state.closeFullEditor(); // 全屏 JSON 编辑器；不在全屏时它自己会忽略
        }
      }
    });

    // 点全屏遮罩空白处关闭：只在这里注册一次，编辑器重建时不重复挂
    el("modal-root").addEventListener("mousedown", function (ev) {
      if (ev.target === ev.currentTarget && state.closeFullEditor) state.closeFullEditor();
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
