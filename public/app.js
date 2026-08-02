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
    utLang: "python", // URL 传参生成器的语言
    toolMode: "api",  // 右侧面板当前是接口调试还是 URL 传参生成
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

  // 复制按钮拿的是原文，不是高亮后的 HTML；bindCopy 取走后就从 store 删掉
  function stashCopy(src) {
    var id = "cb" + (codeBlock._n = (codeBlock._n || 0) + 1);
    codeBlock.store = codeBlock.store || {};
    codeBlock.store[id] = src;
    return id;
  }

  function codeBlock(src, lang, opts) {
    opts = opts || {};
    src = String(src == null ? "" : src).replace(/\s+$/, "");
    var isJson = lang === "json" || lang === "jsonc" || (!lang && /^\s*[[{]/.test(src));
    var body = isJson ? hlJson(src) : hlGeneric(src);
    var label = LANG_LABEL[lang] || lang || "text";
    var id = stashCopy(src);
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

  // 读某个 Path / Query 参数当前填了什么。
  // 千万别叫 valueOf——那是 Object.prototype 上的方法名，拼错作用域时不会报错，
  // 只会静默拿到 Object.prototype.valueOf 并返回 truthy。
  function paramValue(kind, name) {
    var value = "";
    document.querySelectorAll("[data-" + kind + "]").forEach(function (n) {
      if (n.getAttribute("data-" + kind) === name) value = n.value.trim();
    });
    return value;
  }

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

    if (a) {
      (a.pathParams || []).forEach(function (p) {
        if (p.required && !paramValue("pp", p.name)) issues.push("缺少 Path 参数 " + p.name);
      });
      (a.queryParams || []).forEach(function (p) {
        if (p.required && !paramValue("qp", p.name)) issues.push("缺少 Query 参数 " + p.name);
      });
    }

    var body = bodyText();
    if (body) {
      try { JSON.parse(body); }
      catch (err) { issues.push("Body JSON 不合法"); }
    }
    return { ok: issues.length === 0, issues: issues };
  }

  // heading 是正文里的标题名，点了滚过去；不同页面能跳的标题不一样
  function paramHelpButtonHtml(heading, label) {
    heading = heading || "Request";
    return '<button class="doc-jump" type="button" data-doc-jump="' + esc(heading) +
      '" title="定位正文' + esc(heading) + '">' +
      '<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">' +
      '<path d="M3 2.5h7.25A1.75 1.75 0 0 1 12 4.25V13H4.75A1.75 1.75 0 0 0 3 14.75V2.5Z"/>' +
      '<path d="M3 12.75h7.25M6 5.5h3.5M6 8h3.5"/></svg>' +
      "<span>" + esc(label || "参数说明") + '</span><span aria-hidden="true">↗</span></button>';
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

    state.toolMode = "api";
    var canRun = a.runnable !== false;
    var methods = [a.method].concat(a.alsoMethods || []);

    // 顶部栏：方法胶囊 + 标题/地址两行 + 复制/重置/发送，跟着接口变
    el("runner-req").innerHTML =
      (methods.length > 1
        ? '<select class="runner-verb-sel verb ' + a.method.toLowerCase() + '" id="in-method" ' +
          'title="该接口支持多种方法">' +
          methods.map(function (m) { return '<option value="' + m + '">' + m + "</option>"; }).join("") +
          "</select>"
        : '<span class="verb ' + a.method.toLowerCase() + '">' + esc(a.method) + "</span>") +
      '<code class="runner-url" id="run-url">' + esc(API_BASE + a.path) + "</code>";
    el("btn-send").disabled = !canRun;
    el("btn-send").textContent = "发送请求";
    el("btn-send").classList.remove("cancel");
    el("btn-reset").hidden = !canRun;

    var html = "";

    html += '<div class="rsec"><div class="rsec-head">' +
      '<span class="rsec-tag">AUTH</span><span class="rsec-name">Basic 认证</span></div>' +
      '<div class="rrow"><label for="in-key">API_KEY<span class="star">*</span></label>' +
      '<input class="ipt" id="in-key" type="text" autocomplete="off" placeholder="你的 API Key"></div>' +
      '<div class="rrow"><label for="in-secret">API_SECRET<span class="star">*</span></label>' +
      '<input class="ipt" id="in-secret" type="password" autocomplete="off" placeholder="你的 API Secret"></div>' +
      '<div class="cred-links">在 <a href="https://next.jinshuju.net/profile/api" target="_blank" rel="noopener">个人中心 → API</a>' +
      ' 或 <a href="https://next.jinshuju.net/system/api_licence" target="_blank" rel="noopener">系统设置 → 企业 API</a> 获取</div></div>';

    if (a.pathParams.length) {
      html += '<div class="rsec"><div class="rsec-head">' +
        '<span class="rsec-tag">PATH</span><span class="rsec-name">路径参数</span></div>' +
        a.pathParams.map(function (p) {
          // 数据里的占位符是 FORM_TOKEN 这种大写，显示成小写更像参数名
          return '<div class="rrow"><label title="' + esc(p.desc || p.name) + '">' +
            esc(p.name.toLowerCase()) +
            (p.required ? '<span class="star">*</span>' : "") + "</label>" +
            '<input class="ipt" data-pp="' + esc(p.name) + '" placeholder="' +
            esc(p.name.toLowerCase()) + '"></div>';
        }).join("") + "</div>";
    }

    if (a.queryParams.length) {
      html += '<div class="rsec"><div class="rsec-head">' +
        '<span class="rsec-tag">QUERY</span><span class="rsec-name">查询参数</span>' +
        '<span class="grow"></span>' + paramHelpButtonHtml() + "</div>" +
        a.queryParams.map(function (p) {
          return '<div class="rrow"><label title="' + esc(p.name) + '">' + esc(p.name) +
            (p.required ? '<span class="star">*</span>' : "") + "</label>" +
            '<input class="ipt" data-qp="' + esc(p.name) + '" placeholder="可选"></div>';
        }).join("") + "</div>";
    }

    if (!canRun) {
      html += '<div class="rsec"><div class="rsec-head">' +
        '<span class="rsec-tag">BODY</span><span class="rsec-name">' + esc(a.contentType) + "</span>" +
        '<span class="grow"></span>' +
        (a.bodyParams && a.bodyParams.length ? paramHelpButtonHtml() : "") + "</div>" +
        '<div class="hint-box">该接口是文件上传（multipart/form-data），在线运行暂不支持；' +
        "正文「示例代码」一节给出了可直接使用的写法。</div></div>";
    } else if (["POST", "PUT", "PATCH"].indexOf(a.method) !== -1 || (a.alsoMethods || []).length) {
      // JSON 编辑器的状态和工具按钮都提到分区标题行上，编辑器本身只剩行号 + 代码
      html += '<div class="rsec"><div class="rsec-head">' +
        '<span class="rsec-tag">BODY</span>' +
        '<span class="jsed-status" id="jsed-status"></span>' +
        '<span class="grow"></span>' +
        "</div>" +
        // 格式化 / 全屏 / 参数说明都挂在编辑器自己的菜单栏上，分区标题行保持短，窄面板下才不折行
        jsonEditorHtml(bodyDefault(a), a.bodyParams && a.bodyParams.length) +
        '<div class="rsec-hint">点击任意位置直接编辑 JSON</div></div>';
    }

    wrap.innerHTML = html;

    var k = el("in-key"), s = el("in-secret");
    k.value = state.creds.key; s.value = state.creds.secret;
    function onCred() {
      // 凭据只留在内存里：刷新或重新打开都不该还在（见 init 里的清理）
      state.creds.key = k.value; state.creds.secret = s.value;
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
    // 方法下拉自己就是那个彩色标签，切换时同步配色
    var ms = el("in-method");
    if (ms) ms.addEventListener("change", function () {
      ms.className = "runner-verb-sel verb " + ms.value.toLowerCase();
      if (state.tab === "code") renderOut();
    });

    initJsonEditor(function () { if (state.tab === "code") renderOut(); });

    syncUrl();
    state.response = null;
    renderOut();
  }

  // 文档里的示例值：Path 参数用 example，Body 用 requestExample
  function bodyDefault(a) {
    var init = a.requestExample || "{\n  \n}";
    try { init = JSON.stringify(JSON.parse(init), null, 2); } catch (err) { /* 原样 */ }
    return init;
  }

  function resetRunner() {
    if (state.toolMode === "url") return resetUrlTool();
    var a = api();
    if (!a) return;
    el("runner-scroll").querySelectorAll("[data-pp],[data-qp]").forEach(function (n) { n.value = ""; });
    var ta = el("in-body");
    if (ta) {
      ta.value = bodyDefault(a);
      ta.dispatchEvent(new Event("input"));
    }
    var ms = el("in-method");
    if (ms) { ms.value = a.method; ms.dispatchEvent(new Event("change")); }
    state.response = null;
    syncUrl();
    renderOut();
    toast("已恢复成文档里的示例值");
  }

  function curMethod() {
    var ms = el("in-method");
    return ms ? ms.value : (api() ? api().method : "GET");
  }

  function syncUrl() {
    var u = el("run-url");
    if (!u) return;
    if (state.toolMode === "url") {
      u.textContent = UT.result ? UT.result.url : FORM_BASE;
      u.scrollLeft = u.scrollWidth;
      return;
    }
    var path = builtPath();
    // 还没填的路径参数显示成 {form_token}，一眼看出是占位符而不是真值
    var a = api();
    if (a) {
      (a.pathParams || []).forEach(function (p) {
        if (!paramValue("pp", p.name)) {
          path = path.split(p.name).join("{" + p.name.toLowerCase() + "}");
        }
      });
    }
    u.textContent = API_BASE + path;
    // 放不下时保留末尾可见：路径尾部（资源、参数）比域名前缀更该被看到。
    // 想看前面往左滚即可。
    u.scrollLeft = u.scrollWidth;
  }

  /* ---------- JSON 编辑器 ---------- */

  // 菜单栏在编辑器自己顶上：左边 JSON，右边格式化 / 全屏 / 参数说明
  function jsonEditorHtml(initial, withParamHelp) {
    return '<div class="jsed" id="jsed">' +
      '<div class="jsed-bar">' +
      '<span class="jsed-name">JSON</span>' +
      '<span class="grow"></span>' +
      '<button class="rtool" id="jsed-fmt" type="button" title="按 2 空格缩进重新格式化">格式化</button>' +
      '<button class="rtool rtool-icon" id="jsed-full" type="button"></button>' +
      (withParamHelp ? paramHelpButtonHtml() : "") +
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

    // 四角折线：开口朝外 = 展开到四角；开口朝内 = 收拢回中心
    var ICON_EXPAND = '<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" ' +
      'stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<path d="M6 2.5H2.5V6M10 2.5h3.5V6M6 13.5H2.5V10M10 13.5h3.5V10"/></svg>';
    var ICON_SHRINK = '<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" ' +
      'stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<path d="M2.5 6H6V2.5M13.5 6H10V2.5M2.5 10H6v3.5M13.5 10H10v3.5"/></svg>';
    var fullBtn = el("jsed-full");
    function syncFullBtn() {
      var on = box.classList.contains("jsed-full");
      // 始终只放图标：塞进「退出全屏」四个字会把这个图标按钮的宽度撑爆
      fullBtn.innerHTML = on ? ICON_SHRINK : ICON_EXPAND;
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
    // URL 传参页那个面板不发请求，主按钮是「复制链接」
    if (state.toolMode === "url") {
      if (UT.result) copy(UT.result.url, "链接");
      return;
    }
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
        setSendBtn("发送请求", false);
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
  // 语言图标来自 simple-icons（CC0 公共领域），路径内联在这里，不引外部资源。
  // c = 亮色主题用色，d = 暗色主题用色（官方品牌色在某一侧对比度不够时各调了一档）。
  var LANG_ICONS = {
    curl: { c: "#0B4E7A", d: "#7FB8DE",
      p: "M.803 14.8169c0-.5342.433-.9665.9665-.9665.5335 0 .9665.4323.9665.9665 0 .5335-.433.9657-.9665.9657-.5335 0-.9666-.4322-.9666-.9657m2.736 0c0-.1963-.0532-.376-.1119-.5525-.2344-.7024-.876-1.2169-1.6575-1.2169-.1249 0-.2344.0465-.3524.0708C.6149 13.2865 0 13.9646 0 14.817c0 .9764.7923 1.7694 1.7695 1.7694.9772 0 1.7694-.793 1.7694-1.7694m-1.7694-7.149c.5335 0 .9665.433.9665.9665 0 .5335-.433.9665-.9665.9665-.5343 0-.9666-.433-.9666-.9665 0-.5335.4323-.9665.9666-.9665m0 2.7359c.9772 0 1.7694-.7923 1.7694-1.7694 0-.1956-.0532-.376-.1119-.5525-.2344-.7024-.8767-1.2169-1.6575-1.2169-.1249 0-.2344.0465-.3524.0716C.6149 7.104 0 7.782 0 8.6344c0 .9771.7923 1.7694 1.7695 1.7694m13.221-5.694c-.5342 0-.9665-.433-.9665-.9664a.966.966 0 01.9666-.9665c.5335 0 .9658.4322.9658.9665 0 .5334-.4323.9664-.9658.9664m-9.6 16.5133c-.5335 0-.9666-.433-.9666-.9665 0-.5342.433-.9665.9666-.9665a.966.966 0 01.9665.9665c0 .5335-.4323.9665-.9665.9665m9.6-19.2491c-.978 0-1.7695.7922-1.7695 1.7694 0 .2085.0525.4025.1187.5882L5.039 18.5581c-.803.1681-1.4179.8462-1.4179 1.6985 0 .9772.7923 1.7694 1.7695 1.7694.9772 0 1.7694-.7922 1.7694-1.7694 0-.1963-.0525-.3759-.111-.5525l8.3427-14.2728c.7778-.1865 1.3683-.8531 1.3683-1.688 0-.977-.793-1.7693-1.7694-1.7693m7.24 2.7359c-.5343 0-.9666-.433-.9666-.9665a.966.966 0 01.9665-.9665c.5335 0 .9666.4322.9666.9665 0 .5334-.433.9665-.9666.9665M12.6313 21.223c-.5343 0-.9665-.433-.9665-.9665a.966.966 0 01.9665-.9665c.5335 0 .9658.4323.9658.9665 0 .5335-.4323.9665-.9658.9665M22.2305 1.974c-.9772 0-1.7694.7922-1.7694 1.7694 0 .2085.0525.4025.1187.5882l-8.3009 14.2265c-.8021.1681-1.417.8462-1.417 1.6985 0 .9772.7922 1.7694 1.7694 1.7694.9764 0 1.7687-.7922 1.7687-1.7694 0-.1963-.0525-.3759-.1111-.5525l8.3427-14.2728C23.4094 5.2448 24 4.5782 24 3.7433c0-.977-.7923-1.7693-1.7695-1.7693" },
    js: { c: "#B59A00", d: "#F7DF1E",
      p: "M0 0h24v24H0V0zm22.034 18.276c-.175-1.095-.888-2.015-3.003-2.873-.736-.345-1.554-.585-1.797-1.14-.091-.33-.105-.51-.046-.705.15-.646.915-.84 1.515-.66.39.12.75.42.976.9 1.034-.676 1.034-.676 1.755-1.125-.27-.42-.404-.601-.586-.78-.63-.705-1.469-1.065-2.834-1.034l-.705.089c-.676.165-1.32.525-1.71 1.005-1.14 1.291-.811 3.541.569 4.471 1.365 1.02 3.361 1.244 3.616 2.205.24 1.17-.87 1.545-1.966 1.41-.811-.18-1.26-.586-1.755-1.336l-1.83 1.051c.21.48.45.689.81 1.109 1.74 1.756 6.09 1.666 6.871-1.004.029-.09.24-.705.074-1.65l.046.067zm-8.983-7.245h-2.248c0 1.938-.009 3.864-.009 5.805 0 1.232.063 2.363-.138 2.711-.33.689-1.18.601-1.566.48-.396-.196-.597-.466-.83-.855-.063-.105-.11-.196-.127-.196l-1.825 1.125c.305.63.75 1.172 1.324 1.517.855.51 2.004.675 3.207.405.783-.226 1.458-.691 1.811-1.411.51-.93.402-2.07.397-3.346.012-2.054 0-4.109 0-6.179l.004-.056z" },
    node: { c: "#4F8C40", d: "#7CC768",
      p: "M11.998,24c-0.321,0-0.641-0.084-0.922-0.247l-2.936-1.737c-0.438-0.245-0.224-0.332-0.08-0.383 c0.585-0.203,0.703-0.25,1.328-0.604c0.065-0.037,0.151-0.023,0.218,0.017l2.256,1.339c0.082,0.045,0.197,0.045,0.272,0l8.795-5.076 c0.082-0.047,0.134-0.141,0.134-0.238V6.921c0-0.099-0.053-0.192-0.137-0.242l-8.791-5.072c-0.081-0.047-0.189-0.047-0.271,0 L3.075,6.68C2.99,6.729,2.936,6.825,2.936,6.921v10.15c0,0.097,0.054,0.189,0.139,0.235l2.409,1.392 c1.307,0.654,2.108-0.116,2.108-0.89V7.787c0-0.142,0.114-0.253,0.256-0.253h1.115c0.139,0,0.255,0.112,0.255,0.253v10.021 c0,1.745-0.95,2.745-2.604,2.745c-0.508,0-0.909,0-2.026-0.551L2.28,18.675c-0.57-0.329-0.922-0.945-0.922-1.604V6.921 c0-0.659,0.353-1.275,0.922-1.603l8.795-5.082c0.557-0.315,1.296-0.315,1.848,0l8.794,5.082c0.57,0.329,0.924,0.944,0.924,1.603 v10.15c0,0.659-0.354,1.273-0.924,1.604l-8.794,5.078C12.643,23.916,12.324,24,11.998,24z M19.099,13.993 c0-1.9-1.284-2.406-3.987-2.763c-2.731-0.361-3.009-0.548-3.009-1.187c0-0.528,0.235-1.233,2.258-1.233 c1.807,0,2.473,0.389,2.747,1.607c0.024,0.115,0.129,0.199,0.247,0.199h1.141c0.071,0,0.138-0.031,0.186-0.081 c0.048-0.054,0.074-0.123,0.067-0.196c-0.177-2.098-1.571-3.076-4.388-3.076c-2.508,0-4.004,1.058-4.004,2.833 c0,1.925,1.488,2.457,3.895,2.695c2.88,0.282,3.103,0.703,3.103,1.269c0,0.983-0.789,1.402-2.642,1.402 c-2.327,0-2.839-0.584-3.011-1.742c-0.02-0.124-0.126-0.215-0.253-0.215h-1.137c-0.141,0-0.254,0.112-0.254,0.253 c0,1.482,0.806,3.248,4.655,3.248C17.501,17.007,19.099,15.91,19.099,13.993z" },
    python: { c: "#3776AB", d: "#6BA6DC",
      p: "M14.25.18l.9.2.73.26.59.3.45.32.34.34.25.34.16.33.1.3.04.26.02.2-.01.13V8.5l-.05.63-.13.55-.21.46-.26.38-.3.31-.33.25-.35.19-.35.14-.33.1-.3.07-.26.04-.21.02H8.77l-.69.05-.59.14-.5.22-.41.27-.33.32-.27.35-.2.36-.15.37-.1.35-.07.32-.04.27-.02.21v3.06H3.17l-.21-.03-.28-.07-.32-.12-.35-.18-.36-.26-.36-.36-.35-.46-.32-.59-.28-.73-.21-.88-.14-1.05-.05-1.23.06-1.22.16-1.04.24-.87.32-.71.36-.57.4-.44.42-.33.42-.24.4-.16.36-.1.32-.05.24-.01h.16l.06.01h8.16v-.83H6.18l-.01-2.75-.02-.37.05-.34.11-.31.17-.28.25-.26.31-.23.38-.2.44-.18.51-.15.58-.12.64-.1.71-.06.77-.04.84-.02 1.27.05zm-6.3 1.98l-.23.33-.08.41.08.41.23.34.33.22.41.09.41-.09.33-.22.23-.34.08-.41-.08-.41-.23-.33-.33-.22-.41-.09-.41.09zm13.09 3.95l.28.06.32.12.35.18.36.27.36.35.35.47.32.59.28.73.21.88.14 1.04.05 1.23-.06 1.23-.16 1.04-.24.86-.32.71-.36.57-.4.45-.42.33-.42.24-.4.16-.36.09-.32.05-.24.02-.16-.01h-8.22v.82h5.84l.01 2.76.02.36-.05.34-.11.31-.17.29-.25.25-.31.24-.38.2-.44.17-.51.15-.58.13-.64.09-.71.07-.77.04-.84.01-1.27-.04-1.07-.14-.9-.2-.73-.25-.59-.3-.45-.33-.34-.34-.25-.34-.16-.33-.1-.3-.04-.25-.02-.2.01-.13v-5.34l.05-.64.13-.54.21-.46.26-.38.3-.32.33-.24.35-.2.35-.14.33-.1.3-.06.26-.04.21-.02.13-.01h5.84l.69-.05.59-.14.5-.21.41-.28.33-.32.27-.35.2-.36.15-.36.1-.35.07-.32.04-.28.02-.21V6.07h2.09l.14.01zm-6.47 14.25l-.23.33-.08.41.08.41.23.33.33.23.41.08.41-.08.33-.23.23-.33.08-.41-.08-.41-.23-.33-.33-.23-.41-.08-.41.08z" },
    php: { c: "#6C70A8", d: "#A0A4DC",
      p: "M7.01 10.207h-.944l-.515 2.648h.838c.556 0 .97-.105 1.242-.314.272-.21.455-.559.55-1.049.092-.47.05-.802-.124-.995-.175-.193-.523-.29-1.047-.29zM12 5.688C5.373 5.688 0 8.514 0 12s5.373 6.313 12 6.313S24 15.486 24 12c0-3.486-5.373-6.312-12-6.312zm-3.26 7.451c-.261.25-.575.438-.917.551-.336.108-.765.164-1.285.164H5.357l-.327 1.681H3.652l1.23-6.326h2.65c.797 0 1.378.209 1.744.628.366.418.476 1.002.33 1.752a2.836 2.836 0 0 1-.305.847c-.143.255-.33.49-.561.703zm4.024.715l.543-2.799c.063-.318.039-.536-.068-.651-.107-.116-.336-.174-.687-.174H11.46l-.704 3.625H9.388l1.23-6.327h1.367l-.327 1.682h1.218c.767 0 1.295.134 1.586.401s.378.7.263 1.299l-.572 2.944h-1.389zm7.597-2.265a2.782 2.782 0 0 1-.305.847c-.143.255-.33.49-.561.703a2.44 2.44 0 0 1-.917.551c-.336.108-.765.164-1.286.164h-1.18l-.327 1.682h-1.378l1.23-6.326h2.649c.797 0 1.378.209 1.744.628.366.417.477 1.001.331 1.751zM17.766 10.207h-.943l-.516 2.648h.838c.557 0 .971-.105 1.242-.314.272-.21.455-.559.551-1.049.092-.47.049-.802-.125-.995s-.524-.29-1.047-.29z" },
    ruby: { c: "#CC342D", d: "#F2635C",
      p: "M20.156.083c3.033.525 3.893 2.598 3.829 4.77L24 4.822 22.635 22.71 4.89 23.926h.016C3.433 23.864.15 23.729 0 19.139l1.645-3 2.819 6.586.503 1.172 2.805-9.144-.03.007.016-.03 9.255 2.956-1.396-5.431-.99-3.9 8.82-.569-.615-.51L16.5 2.114 20.159.073l-.003.01zM0 19.089zM5.13 5.073c3.561-3.533 8.157-5.621 9.922-3.84 1.762 1.777-.105 6.105-3.673 9.636-3.563 3.532-8.103 5.734-9.864 3.957-1.766-1.777.045-6.217 3.612-9.75l.003-.003z" },
    java: { c: "#2B2B2B", d: "#D6D6D6",
      p: "M11.915 0 11.7.215C9.515 2.4 7.47 6.39 6.046 10.483c-1.064 1.024-3.633 2.81-3.711 3.551-.093.87 1.746 2.611 1.55 3.235-.198.625-1.304 1.408-1.014 1.939.1.188.823.011 1.277-.491a13.389 13.389 0 0 0-.017 2.14c.076.906.27 1.668.643 2.232.372.563.956.911 1.667.911.397 0 .727-.114 1.024-.264.298-.149.571-.33.91-.5.68-.34 1.634-.666 3.53-.604 1.903.062 2.872.39 3.559.704.687.314 1.15.664 1.925.664.767 0 1.395-.336 1.807-.9.412-.563.631-1.33.72-2.24.06-.623.055-1.32 0-2.066.454.45 1.117.604 1.213.424.29-.53-.816-1.314-1.013-1.937-.198-.624 1.642-2.366 1.549-3.236-.08-.748-2.707-2.568-3.748-3.586C16.428 6.374 14.308 2.394 12.13.215zm.175 6.038a2.95 2.95 0 0 1 2.943 2.942 2.95 2.95 0 0 1-2.943 2.943A2.95 2.95 0 0 1 9.148 8.98a2.95 2.95 0 0 1 2.942-2.942zM8.685 7.983a3.515 3.515 0 0 0-.145.997c0 1.951 1.6 3.55 3.55 3.55 1.95 0 3.55-1.598 3.55-3.55 0-.329-.046-.648-.132-.951.334.095.64.208.915.336a42.699 42.699 0 0 1 2.042 5.829c.678 2.545 1.01 4.92.846 6.607-.082.844-.29 1.51-.606 1.94-.315.431-.713.651-1.315.651-.593 0-.932-.27-1.673-.61-.741-.338-1.825-.694-3.792-.758-1.974-.064-3.073.293-3.821.669-.375.188-.659.373-.911.5s-.466.2-.752.2c-.53 0-.876-.209-1.16-.64-.285-.43-.474-1.101-.545-1.948-.141-1.693.176-4.069.823-6.614a43.155 43.155 0 0 1 1.934-5.783c.348-.167.749-.31 1.192-.425zm-3.382 4.362a.216.216 0 0 1 .13.031c-.166.56-.323 1.116-.463 1.665a33.849 33.849 0 0 0-.547 2.555 3.9 3.9 0 0 0-.2-.39c-.58-1.012-.914-1.642-1.16-2.08.315-.24 1.679-1.755 2.24-1.781zm13.394.01c.562.027 1.926 1.543 2.24 1.783-.246.438-.58 1.068-1.16 2.08a4.428 4.428 0 0 0-.163.309 32.354 32.354 0 0 0-.562-2.49 40.579 40.579 0 0 0-.482-1.652.216.216 0 0 1 .127-.03z" },
    go: { c: "#0089AD", d: "#4DD0F0",
      p: "M1.811 10.231c-.047 0-.058-.023-.035-.059l.246-.315c.023-.035.081-.058.128-.058h4.172c.046 0 .058.035.035.07l-.199.303c-.023.036-.082.07-.117.07zM.047 11.306c-.047 0-.059-.023-.035-.058l.245-.316c.023-.035.082-.058.129-.058h5.328c.047 0 .07.035.058.07l-.093.28c-.012.047-.058.07-.105.07zm2.828 1.075c-.047 0-.059-.035-.035-.07l.163-.292c.023-.035.07-.07.117-.07h2.337c.047 0 .07.035.07.082l-.023.28c0 .047-.047.082-.082.082zm12.129-2.36c-.736.187-1.239.327-1.963.514-.176.046-.187.058-.34-.117-.174-.199-.303-.327-.548-.444-.737-.362-1.45-.257-2.115.175-.795.514-1.204 1.274-1.192 2.22.011.935.654 1.706 1.577 1.835.795.105 1.46-.175 1.987-.77.105-.13.198-.27.315-.434H10.47c-.245 0-.304-.152-.222-.35.152-.362.432-.97.596-1.274a.315.315 0 01.292-.187h4.253c-.023.316-.023.631-.07.947a4.983 4.983 0 01-.958 2.29c-.841 1.11-1.94 1.8-3.33 1.986-1.145.152-2.209-.07-3.143-.77-.865-.655-1.356-1.52-1.484-2.595-.152-1.274.222-2.419.993-3.424.83-1.086 1.928-1.776 3.272-2.02 1.098-.2 2.15-.07 3.096.571.62.41 1.063.97 1.356 1.648.07.105.023.164-.117.2m3.868 6.461c-1.064-.024-2.034-.328-2.852-1.029a3.665 3.665 0 01-1.262-2.255c-.21-1.32.152-2.489.947-3.529.853-1.122 1.881-1.706 3.272-1.95 1.192-.21 2.314-.095 3.33.595.923.63 1.496 1.484 1.648 2.605.198 1.578-.257 2.863-1.344 3.962-.771.783-1.718 1.273-2.805 1.495-.315.06-.63.07-.934.106zm2.78-4.72c-.011-.153-.011-.27-.034-.387-.21-1.157-1.274-1.81-2.384-1.554-1.087.245-1.788.935-2.045 2.033-.21.912.234 1.835 1.075 2.21.643.28 1.285.244 1.905-.07.923-.48 1.425-1.228 1.484-2.233z" },
    shell: { c: "#3E8A1B", d: "#7BD44B",
      p: "M21.038,4.9l-7.577-4.498C13.009,0.134,12.505,0,12,0c-0.505,0-1.009,0.134-1.462,0.403L2.961,4.9 C2.057,5.437,1.5,6.429,1.5,7.503v8.995c0,1.073,0.557,2.066,1.462,2.603l7.577,4.497C10.991,23.866,11.495,24,12,24 c0.505,0,1.009-0.134,1.461-0.402l7.577-4.497c0.904-0.537,1.462-1.529,1.462-2.603V7.503C22.5,6.429,21.943,5.437,21.038,4.9z M15.17,18.946l0.013,0.646c0.001,0.078-0.05,0.167-0.111,0.198l-0.383,0.22c-0.061,0.031-0.111-0.007-0.112-0.085L14.57,19.29 c-0.328,0.136-0.66,0.169-0.872,0.084c-0.04-0.016-0.057-0.075-0.041-0.142l0.139-0.584c0.011-0.046,0.036-0.092,0.069-0.121 c0.012-0.011,0.024-0.02,0.036-0.026c0.022-0.011,0.043-0.014,0.062-0.006c0.229,0.077,0.521,0.041,0.802-0.101 c0.357-0.181,0.596-0.545,0.592-0.907c-0.003-0.328-0.181-0.465-0.613-0.468c-0.55,0.001-1.064-0.107-1.072-0.917 c-0.007-0.667,0.34-1.361,0.889-1.8l-0.007-0.652c-0.001-0.08,0.048-0.168,0.111-0.2l0.37-0.236 c0.061-0.031,0.111,0.007,0.112,0.087l0.006,0.653c0.273-0.109,0.511-0.138,0.726-0.088c0.047,0.012,0.067,0.076,0.048,0.151 l-0.144,0.578c-0.011,0.044-0.036,0.088-0.065,0.116c-0.012,0.012-0.025,0.021-0.038,0.028c-0.019,0.01-0.038,0.013-0.057,0.009 c-0.098-0.022-0.332-0.073-0.699,0.113c-0.385,0.195-0.52,0.53-0.517,0.778c0.003,0.297,0.155,0.387,0.681,0.396 c0.7,0.012,1.003,0.318,1.01,1.023C16.105,17.747,15.736,18.491,15.17,18.946z M19.143,17.859c0,0.06-0.008,0.116-0.058,0.145 l-1.916,1.164c-0.05,0.029-0.09,0.004-0.09-0.056v-0.494c0-0.06,0.037-0.093,0.087-0.122l1.887-1.129 c0.05-0.029,0.09-0.004,0.09,0.056V17.859z M20.459,6.797l-7.168,4.427c-0.894,0.523-1.553,1.109-1.553,2.187v8.833 c0,0.645,0.26,1.063,0.66,1.184c-0.131,0.023-0.264,0.039-0.398,0.039c-0.42,0-0.833-0.114-1.197-0.33L3.226,18.64 c-0.741-0.44-1.201-1.261-1.201-2.142V7.503c0-0.881,0.46-1.702,1.201-2.142l7.577-4.498c0.363-0.216,0.777-0.33,1.197-0.33 c0.419,0,0.833,0.114,1.197,0.33l7.577,4.498c0.624,0.371,1.046,1.013,1.164,1.732C21.686,6.557,21.12,6.411,20.459,6.797z" },
  };

  // 图标跟在下拉左边（原生 <option> 里塞不了 SVG，所以只标当前选中的语言）
  function langIconHtml(id) {
    var ico = LANG_ICONS[id];
    if (!ico) return "";
    return '<span class="lang-ico" style="--ico:' + ico.c + ';--ico-dark:' + ico.d + '" aria-hidden="true">' +
      '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="' + ico.p + '"/></svg></span>';
  }

  // 换语言时只换图标，不重渲染整个下拉（否则会丢焦点）
  function bindLangIcon(sel) {
    if (!sel) return;
    var box = sel.parentNode.querySelector(".lang-ico-slot");
    if (!box) return;
    sel.addEventListener("change", function () { box.innerHTML = langIconHtml(sel.value); });
  }

  var SNIP_LANG = { curl: "bash", js: "javascript", node: "javascript", python: "python", php: "php", ruby: "ruby", java: "java", go: "go" };

  function renderOut() {
    if (state.toolMode === "url") return renderUrlOut();
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
        '<span class="lang-pick"><span class="lang-ico-slot">' + langIconHtml(state.lang) + "</span>" +
        '<select class="lang-select" id="lang-sel">' + LANGS.map(function (l) {
        return '<option value="' + l.id + '"' + (l.id === state.lang ? " selected" : "") + ">" + l.label + "</option>";
      }).join("") + "</select></span>";
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
    bindLangIcon(sel);
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

  var UT_LANGS = [
    { id: "shell", label: "Shell", hl: "bash" },
    { id: "python", label: "Python", hl: "python" },
    { id: "node", label: "Node.js", hl: "javascript" },
    { id: "php", label: "PHP", hl: "php" },
    { id: "ruby", label: "Ruby", hl: "ruby" },
  ];

  var ICON_TRASH = '<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" ' +
    'stroke-width="1.5" stroke-linecap="round" aria-hidden="true">' +
    '<path d="M2.5 4.5h11M6 4.5V3a.5.5 0 01.5-.5h3a.5.5 0 01.5.5v1.5M4 4.5l.6 8a1 1 0 001 .9h4.8a1 1 0 001-.9l.6-8"/>' +
    '<path d="M6.5 7v4M9.5 7v4"/></svg>';

  /* ---------- 生成代码：都封装成一个可直接搬走的函数 ---------- */

  // 各语言的映射字面量。缩进两级（函数调用实参里），跟模板里的排版对齐
  function mapLiteral(lang, pairs) {
    var wrap = { python: ["{", "}"], node: ["{", "}"], php: ["[", "]"], ruby: ["{", "}"] }[lang];
    if (!wrap) return ""; // shell 直接拼字符串，用不到映射字面量
    if (!pairs.length) return wrap[0] + wrap[1];
    var pad = "  ";
    var body = pairs.map(function (p) {
      switch (lang) {
        case "python": return pad + q(p.key) + ": " + q(p.value) + ",";
        case "node": return pad + p.key + ": " + q(p.value) + ",";
        case "php": return pad + "  " + rq(p.key) + " => " + rq(p.value) + ",";
        case "ruby": return pad + rq(p.key) + " => " + rq(p.value) + ",";
        default: return "";
      }
    }).join("\n").replace(/,$/, "");
    return wrap[0] + "\n" + body + "\n" + (lang === "php" ? "  " : "") + wrap[1];
  }

  function urlSnippet(lang, ctx) {
    var token = ctx.token || "YOUR_FORM_TOKEN";
    var secret = ctx.secret || "YOUR_SIGN_SECRET";
    var pairs = ctx.pairs.length ? ctx.pairs : [{ key: ctx.prefix + "1", value: "" }];
    var map = mapLiteral(lang, pairs);
    var rawParams = pairs.map(function (p) { return p.key + "=" + p.value; }).join("&");
    var encodedParams = pairs.map(function (p) {
      return p.key + "=" + encodeURIComponent(p.value);
    }).join("&");
    var jsonPayload = "{" + pairs.map(function (p) { return q(p.key) + ":" + q(p.value); }).join(",") + "}";

    if (ctx.jwt) {
      switch (lang) {
        case "shell":
          return ["#!/usr/bin/env bash",
            "# 把全局字段打成 JWT（HS256），输出带 cusd 的表单链接。",
            "# 只做签名、不加密——别放私密信息。",
            "",
            "b64url() { openssl base64 -A | tr '+/' '-_' | tr -d '='; }",
            "",
            "build_form_url() {",
            '  local form_token="$1" sign_secret="$2" payload_json="$3"',
            "  local header payload signing signature",
            `  header=$(printf '%s' '{"alg":"HS256","typ":"JWT"}' | b64url)`,
            `  payload=$(printf '%s' "$payload_json" | b64url)`,
            '  signing="${header}.${payload}"',
            `  signature=$(printf '%s' "$signing" | openssl dgst -sha256 -hmac "$sign_secret" -binary | b64url)`,
            `  printf 'https://jinshuju.net/f/%s?cusd=%s.%s\\n' "$form_token" "$signing" "$signature"`,
            "}",
            "",
            "build_form_url " + shq(token) + " " + shq(secret) + " " + shq(jsonPayload)].join("\n");

        case "python":
          return ["import base64", "import hashlib", "import hmac", "import json", "",
            "",
            "def build_form_url(form_token, sign_secret, fields):",
            '    """把全局字段打成 JWT（HS256），返回带 cusd 的表单链接。',
            "",
            "    只做签名、不加密——别放私密信息。装了 pyjwt 的话，等价于",
            '    jwt.encode(fields, sign_secret, algorithm="HS256")。',
            '    """',
            "    def b64url(raw):",
            '        return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()',
            "",
            '    header = b64url(json.dumps({"alg": "HS256", "typ": "JWT"}, separators=(",", ":")).encode())',
            '    payload = b64url(json.dumps(fields, separators=(",", ":"), ensure_ascii=False).encode())',
            '    signing = header + "." + payload',
            "    signature = b64url(hmac.new(sign_secret.encode(), signing.encode(), hashlib.sha256).digest())",
            '    return "https://jinshuju.net/f/%s?cusd=%s.%s" % (form_token, signing, signature)',
            "", "",
            "print(build_form_url(" + q(token) + ", " + q(secret) + ", " + map + "))"].join("\n");

        case "node":
          return ['const crypto = require("node:crypto");', "",
            "/**",
            " * 把全局字段打成 JWT（HS256），返回带 cusd 的表单链接。",
            " * 只做签名、不加密——别放私密信息。",
            " */",
            "function buildFormUrl(formToken, signSecret, fields) {",
            '  const b64url = (raw) => Buffer.from(raw).toString("base64url");',
            '  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));',
            "  const payload = b64url(JSON.stringify(fields));",
            "  const signing = `${header}.${payload}`;",
            '  const signature = crypto.createHmac("sha256", signSecret).update(signing).digest("base64url");',
            "  return `https://jinshuju.net/f/${formToken}?cusd=${signing}.${signature}`;",
            "}", "",
            "console.log(buildFormUrl(" + q(token) + ", " + q(secret) + ", " + map + "));"].join("\n");

        case "php":
          return ["<?php", "",
            "/**",
            " * 把全局字段打成 JWT（HS256），返回带 cusd 的表单链接。",
            " * 只做签名、不加密——别放私密信息。",
            " */",
            "function buildFormUrl(string $formToken, string $signSecret, array $fields): string",
            "{",
            "    $b64url = fn (string $raw): string => rtrim(strtr(base64_encode($raw), '+/', '-_'), '=');",
            "    $header = $b64url(json_encode(['alg' => 'HS256', 'typ' => 'JWT']));",
            "    $payload = $b64url(json_encode($fields, JSON_UNESCAPED_UNICODE));",
            "    $signing = $header . '.' . $payload;",
            "    $signature = $b64url(hash_hmac('sha256', $signing, $signSecret, true));",
            "",
            "    return 'https://jinshuju.net/f/' . $formToken . '?cusd=' . $signing . '.' . $signature;",
            "}", "",
            "echo buildFormUrl(" + rq(token) + ", " + rq(secret) + ", " + map + ");"].join("\n");

        case "ruby":
          return ["require 'base64'", "require 'json'", "require 'openssl'", "",
            "# 把全局字段打成 JWT（HS256），返回带 cusd 的表单链接。",
            "# 只做签名、不加密——别放私密信息。",
            "def build_form_url(form_token, sign_secret, fields)",
            "  b64url = ->(raw) { Base64.urlsafe_encode64(raw, padding: false) }",
            "  header = b64url.call(JSON.generate({ alg: 'HS256', typ: 'JWT' }))",
            "  payload = b64url.call(JSON.generate(fields))",
            '  signing = "#{header}.#{payload}"',
            "  signature = b64url.call(OpenSSL::HMAC.digest('sha256', sign_secret, signing))",
            '  "https://jinshuju.net/f/#{form_token}?cusd=#{signing}.#{signature}"',
            "end", "",
            "puts build_form_url(" + rq(token) + ", " + rq(secret) + ", " + map + ")"].join("\n");
      }
      return "";
    }

    switch (lang) {
      case "shell":
        return ["#!/usr/bin/env bash",
          "# 输出带 sign 的表单链接。",
          "#",
          "# raw 和 query 是分开传的，因为签名和链接用的不是同一份内容：",
          "#   raw   —— 按字段 API CODE 升序排列的原始值，用来算签名（不要编码）",
          "#   query —— 同样的字段，但值已做 URL 编码，用来拼链接",
          "# 在 shell 里实现正确的 UTF-8 百分号编码不划算，所以 query 直接给出。",
          "",
          "build_form_url() {",
          '  local form_token="$1" sign_secret="$2" raw="$3" query="$4"',
          "  local digest sign",
          `  digest=$(printf '%s' "$raw" | openssl dgst -sha256 -hmac "$sign_secret" | awk '{print $NF}')`,
          "  # base64 里的 + / = 在 query 里必须转义，否则 + 会被当成空格",
          `  sign=$(printf '%s' "$digest" | base64 | tr -d '\\n' | sed 's/+/%2B/g; s|/|%2F|g; s/=/%3D/g')`,
          `  printf 'https://jinshuju.net/f/%s?%s&sign=%s\\n' "$form_token" "$query" "$sign"`,
          "}", "",
          "build_form_url " + shq(token) + " " + shq(secret) + " " + shq(rawParams) +
            " " + shq(encodedParams)].join("\n");

      case "python":
        return ["import base64", "import hashlib", "import hmac", "from urllib.parse import quote", "",
          "",
          "def build_form_url(form_token, sign_secret, fields):",
          '    """返回带 sign 的表单链接。',
          "",
          "    两个容易踩的点：字段必须按 API CODE 升序拼接，",
          "    且签名针对未编码的原始值——URL 里的值才做转义。",
          '    """',
          "    keys = sorted(fields)",
          '    raw = "&".join("%s=%s" % (k, fields[k]) for k in keys)',
          "    digest = hmac.new(sign_secret.encode(), raw.encode(), hashlib.sha256).hexdigest()",
          "    sign = base64.b64encode(digest.encode()).decode()",
          '    query = "&".join("%s=%s" % (k, quote(str(fields[k]), safe="")) for k in keys)',
          '    return "https://jinshuju.net/f/%s?%s&sign=%s" % (form_token, query, quote(sign, safe=""))',
          "", "",
          "print(build_form_url(" + q(token) + ", " + q(secret) + ", " + map + "))"].join("\n");

      case "node":
        return ['const crypto = require("node:crypto");', "",
          "/**",
          " * 返回带 sign 的表单链接。",
          " * 两个容易踩的点：字段必须按 API CODE 升序拼接，",
          " * 且签名针对未编码的原始值——URL 里的值才做转义。",
          " */",
          "function buildFormUrl(formToken, signSecret, fields) {",
          "  const keys = Object.keys(fields).sort();",
          "  const raw = keys.map((k) => `${k}=${fields[k]}`).join(\"&\");",
          '  const digest = crypto.createHmac("sha256", signSecret).update(raw).digest("hex");',
          '  const sign = Buffer.from(digest).toString("base64");',
          '  const query = keys.map((k) => `${k}=${encodeURIComponent(fields[k])}`).join("&");',
          "  return `https://jinshuju.net/f/${formToken}?${query}&sign=${encodeURIComponent(sign)}`;",
          "}", "",
          "console.log(buildFormUrl(" + q(token) + ", " + q(secret) + ", " + map + "));"].join("\n");

      case "php":
        return ["<?php", "",
          "/**",
          " * 返回带 sign 的表单链接。",
          " * 两个容易踩的点：字段必须按 API CODE 升序拼接，",
          " * 且签名针对未编码的原始值——URL 里的值才做转义。",
          " */",
          "function buildFormUrl(string $formToken, string $signSecret, array $fields): string",
          "{",
          "    ksort($fields);",
          "    $raw = [];",
          "    $query = [];",
          "    foreach ($fields as $key => $value) {",
          "        $raw[] = $key . '=' . $value;",
          "        $query[] = $key . '=' . rawurlencode((string) $value);",
          "    }",
          "    $digest = hash_hmac('sha256', implode('&', $raw), $signSecret);",
          "    $sign = base64_encode($digest);",
          "",
          "    return 'https://jinshuju.net/f/' . $formToken . '?' . implode('&', $query)",
          "        . '&sign=' . rawurlencode($sign);",
          "}", "",
          "echo buildFormUrl(" + rq(token) + ", " + rq(secret) + ", " + map + ");"].join("\n");

      case "ruby":
        return ["require 'base64'", "require 'erb'", "require 'openssl'", "",
          "# 返回带 sign 的表单链接。",
          "# 两个容易踩的点：字段必须按 API CODE 升序拼接，",
          "# 且签名针对未编码的原始值——URL 里的值才做转义。",
          "def build_form_url(form_token, sign_secret, fields)",
          "  sorted = fields.sort.to_h",
          '  raw = sorted.map { |k, v| "#{k}=#{v}" }.join(\'&\')',
          "  digest = OpenSSL::HMAC.hexdigest('sha256', sign_secret, raw)",
          "  sign = Base64.strict_encode64(digest)",
          "  # 用 ERB::Util.url_encode 而不是 encode_www_form_component：后者把空格编成 +",
          '  query = sorted.map { |k, v| "#{k}=#{ERB::Util.url_encode(v.to_s)}" }.join(\'&\')',
          '  "https://jinshuju.net/f/#{form_token}?#{query}&sign=#{ERB::Util.url_encode(sign)}"',
          "end", "",
          "puts build_form_url(" + rq(token) + ", " + rq(secret) + ", " + map + ")"].join("\n");
    }
    return "";
  }

  /* ---------- 面板形态的生成器：结构与「在线运行」一致 ---------- */

  var UT = { cfg: null, rows: [], seq: 0, result: null };

  function renderUrlRunner(cfg) {
    state.toolMode = "url";
    UT.cfg = cfg;
    UT.rows = [{ key: cfg.prefix + "1", value: "" }, { key: cfg.prefix + "2", value: "" }];
    UT.result = null;

    el("runner-req").innerHTML =
      '<span class="verb link">LINK</span>' +
      '<code class="runner-url" id="run-url"></code>';
    el("btn-send").disabled = false;
    el("btn-send").textContent = "复制链接";
    el("btn-send").classList.remove("cancel");
    el("btn-reset").hidden = false;

    el("runner-scroll").innerHTML =
      '<div class="rsec">' +
      '<div class="rrow"><label for="ut-token">form_token<span class="star">*</span></label>' +
      '<input class="ipt" id="ut-token" type="text" autocomplete="off" spellcheck="false" ' +
      'placeholder="表单链接或 /f/ 后那串"></div>' +
      '<div class="rrow"><label for="ut-secret">sign_secret' +
      (cfg.jwt ? '<span class="star">*</span>' : "") + "</label>" +
      '<input class="ipt" id="ut-secret" type="password" autocomplete="off" placeholder="企业密钥"></div></div>' +
      '<div class="rsec"><div class="rsec-head">' +
      '<span class="rsec-tag">FIELDS</span>' +
      '<span class="rsec-name">' + esc(cfg.rowHint) + "</span>" +
      '<span class="grow"></span>' + paramHelpButtonHtml("如何配置", "配置说明") + "</div>" +
      '<div id="ut-rows"></div>' +
      '<button class="urltool-add" id="ut-add" type="button">+ 添加字段</button>' +
      '<div class="rsec-hint">' + esc(cfg.rowNote) + "</div></div>";

    drawUtRows();
    el("ut-token").addEventListener("input", computeUrlTool);
    el("ut-secret").addEventListener("input", computeUrlTool);
    el("ut-add").addEventListener("click", function () {
      UT.rows.push({ key: UT.cfg.prefix + (UT.rows.length + 1), value: "" });
      drawUtRows(); computeUrlTool();
    });
    el("runner-scroll").querySelectorAll("[data-doc-jump]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var heading = btn.getAttribute("data-doc-jump");
        if (!scrollToDocHeading(heading)) { toast("正文中未找到 " + heading); return; }
        toast("已定位到正文 " + heading);
      });
    });

    computeUrlTool();
  }

  function drawUtRows() {
    var box = el("ut-rows");
    box.innerHTML = UT.rows.map(function (r, i) {
      return '<div class="urltool-row">' +
        '<input class="ipt mono" data-k="' + i + '" value="' + esc(r.key) +
        '" placeholder="' + esc(UT.cfg.placeholder) + '" autocomplete="off" spellcheck="false">' +
        '<input class="ipt" data-v="' + i + '" value="' + esc(r.value) +
        '" placeholder="要传入的值" autocomplete="off">' +
        '<button class="urltool-del" data-del="' + i + '" type="button" title="删除这一行" ' +
        'aria-label="删除这一行">' + ICON_TRASH + "</button></div>";
    }).join("");
    box.querySelectorAll("[data-k]").forEach(function (n) {
      n.addEventListener("input", function () { UT.rows[+n.getAttribute("data-k")].key = n.value; computeUrlTool(); });
    });
    box.querySelectorAll("[data-v]").forEach(function (n) {
      n.addEventListener("input", function () { UT.rows[+n.getAttribute("data-v")].value = n.value; computeUrlTool(); });
    });
    box.querySelectorAll("[data-del]").forEach(function (n) {
      n.addEventListener("click", function () {
        UT.rows.splice(+n.getAttribute("data-del"), 1);
        if (!UT.rows.length) UT.rows.push({ key: UT.cfg.prefix + "1", value: "" });
        drawUtRows(); computeUrlTool();
      });
    });
  }

  // 表单 Token 那栏允许直接粘整条表单链接
  function utToken() {
    var raw = (el("ut-token") || { value: "" }).value.trim();
    var m = raw.match(/\/f\/([^/?#\s]+)/);
    return m ? m[1] : raw.replace(/^https?:\/\/[^/]*\/?/, "");
  }

  function computeUrlTool() {
    var cfg = UT.cfg;
    if (!cfg) return;
    var token = utToken();
    var secret = el("ut-secret").value;
    var filled = UT.rows.filter(function (r) { return r.key.trim(); });
    var mine = ++UT.seq; // 签名是异步算的，只认最后一次输入

    // 升序是签名能对上的前提（与文档示例的 TreeMap / sorted 一致）
    var sorted = filled.slice().sort(function (a, b) {
      return a.key.trim() < b.key.trim() ? -1 : a.key.trim() > b.key.trim() ? 1 : 0;
    });
    var pairs = sorted.map(function (r) { return { key: r.key.trim(), value: r.value }; });
    var reordered = sorted.some(function (r, i) { return r !== filled[i]; });
    var shownToken = token || "YOUR_FORM_TOKEN";

    function done(result) {
      if (mine !== UT.seq) return;
      UT.result = result;
      syncUrl();
      renderOut();
    }

    if (cfg.jwt) {
      var payload = {};
      pairs.forEach(function (p) { payload[p.key] = p.value; });
      if (!pairs.length || !secret) {
        done({ pairs: pairs, payload: payload, reordered: reordered, token: token,
          secret: secret, url: FORM_BASE + shownToken });
        return;
      }
      jwtHS256(secret, payload).then(function (jwt) {
        done({ pairs: pairs, payload: payload, reordered: reordered, token: token, secret: secret,
          jwt: jwt, url: FORM_BASE + shownToken + "?cusd=" + jwt });
      });
      return;
    }

    // 签名针对未编码的原始值；URL 里的值才做转义
    var signBase = pairs.map(function (p) { return p.key + "=" + p.value; }).join("&");
    var query = pairs.map(function (p) { return p.key + "=" + encodeURIComponent(p.value); }).join("&");
    // 值一个都还没填时，别把 ?field_1=&field_2= 这种半截 query 拼进链接
    var anyValue = pairs.some(function (p) { return p.value !== ""; });
    if (!pairs.length || !secret) {
      done({ pairs: pairs, signBase: signBase, reordered: reordered, token: token, secret: secret,
        url: FORM_BASE + shownToken + (anyValue ? "?" + query : "") });
      return;
    }
    signParams(secret, signBase).then(function (sign) {
      done({ pairs: pairs, signBase: signBase, reordered: reordered, token: token, secret: secret,
        sign: sign, url: FORM_BASE + shownToken + "?" + query + "&sign=" + encodeURIComponent(sign) });
    });
  }

  function resetUrlTool() {
    UT.rows = [{ key: UT.cfg.prefix + "1", value: "" }, { key: UT.cfg.prefix + "2", value: "" }];
    el("ut-token").value = "";
    drawUtRows();
    computeUrlTool();
    toast("已清空字段");
  }

  function urlResBlock(label, text, opts) {
    opts = opts || {};
    var id = stashCopy(text);
    return '<div class="urltool-res' + (opts.primary ? " primary" : "") + '">' +
      '<div class="urltool-res-head"><span>' + esc(label) + "</span>" +
      '<button class="urltool-copy" type="button" data-copy="' + id + '">复制</button></div>' +
      // 说明单独一行：跟标题挤在一起会把标题行撑成两行，复制按钮就跟着错位
      (opts.note ? '<div class="urltool-res-note">' + esc(opts.note) + "</div>" : "") +
      '<pre class="urltool-res-body"><code>' + (opts.json ? hlJson(text) : esc(text)) + "</code></pre></div>";
  }

  function renderUrlOut() {
    var tabs = el("out-tabs"), pane = el("out-pane");
    var r = UT.result, cfg = UT.cfg;
    if (!r || !cfg) return;

    var ready = r.pairs.length && (cfg.jwt ? !!r.secret : true);
    tabs.innerHTML =
      '<button class="tab' + (state.tab === "result" ? " on" : "") + '" data-tab="result">生成结果</button>' +
      '<button class="tab' + (state.tab === "code" ? " on" : "") + '" data-tab="code">生成代码</button>' +
      '<span class="right">' +
      (state.tab === "code"
        ? '<span class="lang-pick"><span class="lang-ico-slot">' + langIconHtml(state.utLang) + "</span>" +
          '<select class="lang-select" id="ut-lang">' + UT_LANGS.map(function (l) {
            return '<option value="' + l.id + '"' + (l.id === state.utLang ? " selected" : "") + ">" + l.label + "</option>";
          }).join("") + "</select></span>"
        : '<span class="pill ' + (ready ? "ok" : "bad") + '">' + (ready ? "已生成" : "待填写") + "</span>") +
      "</span>";

    if (state.tab === "code") {
      var meta = UT_LANGS.filter(function (l) { return l.id === state.utLang; })[0] || UT_LANGS[0];
      pane.innerHTML = '<div class="code-ready-note">已代入当前字段与密钥，请勿分享生成的代码。</div>' +
        codeBlock(urlSnippet(state.utLang, {
          token: r.token, secret: r.secret, pairs: r.pairs, prefix: cfg.prefix, jwt: !!cfg.jwt,
        }), meta.hl);
    } else {
      var parts = [];
      if (!r.pairs.length) {
        parts.push('<div class="urltool-note">填一个字段 API CODE 就能看到生成结果。</div>');
      } else if (cfg.jwt) {
        parts.push(urlResBlock("原始数据", JSON.stringify(r.payload, null, 2), { json: true }));
        if (r.jwt) parts.push(urlResBlock("JWT", r.jwt));
        parts.push(urlResBlock("表单链接", r.url, { primary: true }));
        if (!r.secret) parts.push('<div class="urltool-note">填入 sign_secret 后会生成 JWT。' +
          "JWT 只签名、不加密，别放私密信息。</div>");
      } else {
        parts.push(urlResBlock("签名用的参数串", r.signBase, { note: "按 API CODE 升序，值不编码" }));
        if (r.reordered) {
          parts.push('<div class="urltool-note">你填的顺序不是升序，已自动重排——顺序错了签名就对不上。</div>');
        }
        if (r.sign) parts.push(urlResBlock("sign", r.sign));
        parts.push(urlResBlock(r.sign ? "表单链接" : "表单链接（未签名）", r.url, { primary: true }));
        if (!r.secret) parts.push('<div class="urltool-note">填入 sign_secret 后会追加 sign 参数。</div>');
      }
      if (r.pairs.length && !r.token) {
        parts.push('<div class="urltool-note">填入 form_token 才是可直接打开的链接。</div>');
      }
      pane.innerHTML = parts.join("");
    }

    tabs.querySelectorAll("[data-tab]").forEach(function (n) {
      n.addEventListener("click", function () { state.tab = n.getAttribute("data-tab"); renderOut(); });
    });
    var sel = el("ut-lang");
    bindLangIcon(sel);
    if (sel) sel.addEventListener("change", function () { state.utLang = sel.value; renderOut(); });
    bindCopy(pane);
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
    // URL 传参这两页的生成器放在右侧面板里，跟接口页的「在线运行」同一个形态
    var urlTool = URL_TOOLS[r.doc.route];
    var hasRunner = !!(r.doc.api || urlTool);

    el("doc").innerHTML =
      '<div class="doc-head' + (r.doc.route === "" ? " no-crumbs" : "") + '">' +
      breadcrumbsHtml(r.doc) +
      '<div class="doc-head-actions">' +
      '<button class="btn" data-act="copy-page" title="复制原始 Markdown">' + COPY_PAGE_ICON + '<span>复制页面</span></button>' +
      (hasRunner ? '<button class="btn" data-act="toggle-runner">' + RUNNER_ICON +
        "<span>" + (urlTool ? "生成链接" : "在线运行") + "</span></button>" : "") +
      "</div></div>" +
      '<div class="markdown" id="md">' + bodyHtml + "</div>";

    var layout = el("layout");
    layout.classList.toggle("has-api", hasRunner);
    if (hasRunner) {
      layout.classList.toggle("runner-open", state.runnerOpen);
      if (urlTool) renderUrlRunner(urlTool); else renderRunner();
    } else {
      layout.classList.remove("runner-open");
    }
    if (state.refreshLayout) state.refreshLayout();

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
    // 顶部栏的按钮是静态的，只绑一次；renderRunner 只改它们的状态
    el("btn-send").addEventListener("click", send);
    el("btn-reset").addEventListener("click", resetRunner);
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

    // API 凭据和 sign_secret 一律不落盘：刷新、重开都要求重填。
    // 这里顺手清掉早先版本写进 sessionStorage 的那份，免得老用户浏览器里一直留着。
    try { sessionStorage.removeItem("jsj_creds"); } catch (e) { /* noop */ }

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
