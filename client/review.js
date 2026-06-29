(function () {
  "use strict";

  var VERSION = 1;
  var SELECTOR = "[data-review-id], [data-cid]";
  var AUTO_SELECTOR = [
    "main", "article", "section", "aside", "header", "footer", "nav",
    "h1", "h2", "h3", "h4", "h5", "h6",
    "div", "p", "li", "blockquote", "pre", "figure", "figcaption", "img", "canvas",
    "table", "thead", "tbody", "tr", "th", "td", "dt", "dd",
    "[role='row']", "[role='listitem']", "[role='article']", "[role='region']",
    "[class*='card']", "[class*='panel']", "[class*='item']", "[class*='row']", "[class*='section']"
  ].join(",");
  var REVIEW_UI_SELECTOR = ".cfab,.cmodal,.cpop";
  var comments = {};
  var adapter = null;
  var saveTimer = null;
  var fileHandle = null;
  var fileName = "";
  var fsState = "off";

  function $(id) {
    return document.getElementById(id);
  }

  function escHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function nowIso() {
    return new Date().toISOString();
  }

  function storageKey() {
    var serverTarget = window.__REVIEW_SERVER__ && window.__REVIEW_SERVER__.target;
    return "fidibaku:comments:" + (serverTarget || location.pathname);
  }

  function fileHandleKey() {
    return "commentsFile:" + storageKey();
  }

  function pickerId() {
    return "fidibaku-" + hashString(storageKey()).slice(0, 20);
  }

  function itemId(el) {
    return el.dataset.reviewId || el.dataset.cid || "";
  }

  function itemGroup(el) {
    return el.dataset.reviewGroup || el.dataset.cgroup || "Ungrouped";
  }

  function itemLabel(el) {
    return el.dataset.reviewLabel || el.dataset.clabel || itemId(el);
  }

  function textSummary(el, fallback) {
    var text = String(el.innerText || el.textContent || "").replace(/\s+/g, " ").trim();
    if (!text) return fallback;
    return text.length > 80 ? text.slice(0, 77) + "..." : text;
  }

  function hashString(value) {
    var hash = 2166136261;
    for (var i = 0; i < value.length; i += 1) {
      hash ^= value.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
  }

  function elementPath(el) {
    var parts = [];
    var cur = el;
    while (cur && cur.nodeType === 1 && cur !== document.body && parts.length < 8) {
      var tag = cur.tagName.toLowerCase();
      var index = 1;
      var sib = cur;
      while ((sib = sib.previousElementSibling)) {
        if (sib.tagName === cur.tagName) index += 1;
      }
      parts.unshift(tag + ":nth-of-type(" + index + ")");
      cur = cur.parentElement;
    }
    return parts.join(">");
  }

  function autoGroup(el) {
    var section = el.closest("section, article, main, aside, nav, header, footer");
    if (section && section !== el) {
      var heading = section.querySelector("h1,h2,h3,h4,h5,h6");
      if (heading) return textSummary(heading, "Auto");
    }
    var tag = el.tagName.toLowerCase();
    if (/^h[1-6]$/.test(tag)) return "Headings";
    if (tag === "tr" || tag === "td" || tag === "th" || tag === "table") return "Tables";
    if (tag === "li") return "Lists";
    return "Auto";
  }

  function autoLabel(el) {
    var explicit = el.getAttribute("aria-label") || el.getAttribute("title");
    if (explicit) return explicit;
    return textSummary(el, el.tagName.toLowerCase());
  }

  function isAutoCandidate(el) {
    if (!el || el.nodeType !== 1) return false;
    if (el.closest(REVIEW_UI_SELECTOR)) return false;
    if (el.matches("script,style,link,meta,template,br,hr")) return false;
    if (el.matches(SELECTOR)) return false;
    var rect = el.getBoundingClientRect();
    if (rect.width < 12 || rect.height < 10) return false;
    var text = String(el.innerText || el.textContent || "").replace(/\s+/g, " ").trim();
    var tag = el.tagName.toLowerCase();
    if (/^h[1-6]$/.test(tag) || tag === "tr" || tag === "td" || tag === "th") return text.length > 0;
    if (["main", "article", "section", "aside", "header", "footer", "nav", "table", "tbody", "thead"].indexOf(tag) >= 0) return text.length >= 8;
    if (["div", "p", "li", "blockquote", "pre", "figure", "figcaption", "dt", "dd"].indexOf(tag) >= 0) return text.length >= 8;
    if (tag === "img" || tag === "canvas") return !!(el.getAttribute("alt") || el.getAttribute("title") || el.getAttribute("aria-label"));
    if (el.matches("[role='row'],[role='listitem'],[role='article'],[role='region'],[class*='card'],[class*='panel'],[class*='item'],[class*='row'],[class*='section']")) return text.length >= 8;
    return false;
  }

  function ensureAutoAnchor(el) {
    if (!el || !isAutoCandidate(el)) return null;
    if (itemId(el)) return el;
    var tag = el.tagName.toLowerCase();
    var text = textSummary(el, tag);
    var hash = hashString(tag + "|" + elementPath(el) + "|" + text);
    el.dataset.reviewId = "auto:" + tag + ":" + hash;
    el.dataset.reviewGroup = autoGroup(el);
    el.dataset.reviewLabel = autoLabel(el);
    el.dataset.reviewAuto = "true";
    return el;
  }

  function autoInstrument(root) {
    var scope = root && root.querySelectorAll ? root : document;
    scope.querySelectorAll(AUTO_SELECTOR).forEach(ensureAutoAnchor);
  }

  function findReviewTarget(target) {
    var el = target && target.closest ? target.closest(SELECTOR) : null;
    if (el && !el.closest(REVIEW_UI_SELECTOR)) return el;

    var cur = target && target.nodeType === 1 ? target : target.parentElement;
    while (cur && cur !== document.documentElement) {
      var anchored = ensureAutoAnchor(cur);
      if (anchored) return anchored;
      cur = cur.parentElement;
    }
    return null;
  }

  function commentCount() {
    return Object.keys(comments).filter(function (id) { return comments[id] && comments[id].text; }).length;
  }

  function normalizeMap(map) {
    var normalized = {};
    Object.keys(map || {}).forEach(function (id) {
      var c = map[id] || {};
      var text = String(c.text || "").trim();
      if (!id || !text) return;
      normalized[id] = {
        id: id,
        group: c.group || "Ungrouped",
        label: c.label || id,
        text: text,
        status: c.status || "open",
        createdAt: c.createdAt || nowIso(),
        updatedAt: c.updatedAt || nowIso(),
        reply: c.reply || null
      };
    });
    return normalized;
  }

  function documentToMap(doc) {
    var map = {};
    if (Array.isArray(doc)) return normalizeMap(doc.reduce(function (acc, c) {
      if (c && c.id) acc[c.id] = c;
      return acc;
    }, {}));
    if (doc && Array.isArray(doc.comments)) {
      doc.comments.forEach(function (c) { if (c && c.id) map[c.id] = c; });
      return normalizeMap(map);
    }
    return normalizeMap(doc || {});
  }

  function mapToDocument(map) {
    return {
      version: VERSION,
      target: location.pathname.split("/").pop() || "report.html",
      updatedAt: nowIso(),
      comments: Object.keys(map).sort().map(function (id) { return map[id]; })
    };
  }

  function readLocal() {
    try {
      return normalizeMap(JSON.parse(localStorage.getItem(storageKey()) || "{}"));
    } catch (err) {
      return {};
    }
  }

  function writeLocal(map) {
    localStorage.setItem(storageKey(), JSON.stringify(normalizeMap(map)));
  }

  function markdownFence(value, indent) {
    var text = String(value || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
    var runs = text.match(/`+/g) || [];
    var longest = runs.reduce(function (max, run) { return Math.max(max, run.length); }, 0);
    var fence = new Array(Math.max(3, longest + 1) + 1).join("`");
    var prefix = indent || "";
    var body = text.split("\n").map(function (line) { return prefix + line; }).join("\n");
    return prefix + fence + "text\n" + body + "\n" + prefix + fence + "\n";
  }

  function buildMd() {
    var doc = mapToDocument(comments);
    var items = doc.comments;
    var open = items.filter(function (c) { return c.status === "open"; }).length;
    var out = "# " + doc.target + " comments (" + items.length + ")\n\n";
    out += "Updated: " + doc.updatedAt + "\n\n";
    out += "Open: " + open + " / Resolved: " + items.filter(function (c) { return c.status === "resolved"; }).length + " / Won't fix: " + items.filter(function (c) { return c.status === "wontfix"; }).length + "\n";
    if (!items.length) return out + "\nNo comments.\n";

    var groups = {};
    items.forEach(function (c) {
      groups[c.group] = groups[c.group] || [];
      groups[c.group].push(c);
    });
    Object.keys(groups).forEach(function (group) {
      out += "\n## " + group + "\n";
      groups[group].forEach(function (c) {
        out += "- [" + c.status + "] **" + c.label + "** (" + c.id + "):\n";
        out += markdownFence(c.text, "  ");
        if (c.reply && c.reply.text) {
          out += "  - Reply:\n";
          out += markdownFence(c.reply.text, "    ");
        }
      });
    });
    return out;
  }

  function ensureScaffold() {
    if ($("cFab")) return;
    var root = document.createElement("div");
    root.id = "cReviewRoot";
    root.innerHTML = [
      '<button class="cfab empty" id="cFab"><span class="fdot" title="autosaving to file"></span>Comments <span class="cn" id="cCount">0</span></button>',
      '<div class="cmodal" id="cModal"><div class="cmwrap">',
      '<span class="ctick tl"></span><span class="ctick tr"></span><span class="ctick bl"></span><span class="ctick br"></span>',
      '<div class="cmhead"><span class="t">Comments</span><button class="cmx" id="cClose">esc</button></div>',
      '<div class="cmbody"><p>Right-click any marked element to add or edit a comment. Comments autosave when a file or server adapter is connected.</p><div id="cList"></div><details class="cmd-details"><summary>Show markdown</summary><textarea id="cMd" readonly></textarea></details></div>',
      '<div class="cmfoot" style="justify-content:space-between"><span class="as-status" id="asStatus"><span class="d"></span>Autosave: local only</span><button class="cmbtn" id="asConnect">Connect file</button></div>',
      '<div class="cmfoot"><button class="cmbtn ghost" id="cCopy">Copy markdown</button><button class="cmbtn ghost" id="cDownload">Download .md</button><button class="cmbtn ghost" id="cClear">Clear all</button></div>',
      '</div></div>',
      '<div class="cpop" id="cPop"><div class="cpop-h"><span class="lbl" id="cpopLabel"></span><button class="del" id="cpopDel">delete</button></div><textarea id="cpopTa" placeholder="Comment for the agent to implement..."></textarea><div class="cpop-f"><span class="muted">auto-saves</span><button class="done" id="cpopDone">done</button></div></div>'
    ].join("");
    // Mount everything under one tracked root so a host framework re-render
    // (e.g. SSR hydration replacing <body>) can be detected and healed.
    document.body.appendChild(root);
    bindScaffoldEvents();
  }

  function getC(id) {
    return comments[id] && comments[id].text ? comments[id].text : "";
  }

  function setC(id, group, label, text) {
    var previous = comments[id] || {};
    var trimmed = String(text || "").trim();
    if (trimmed) {
      comments[id] = {
        id: id,
        group: group || previous.group || "Ungrouped",
        label: label || previous.label || id,
        text: trimmed,
        status: previous.status || "open",
        createdAt: previous.createdAt || nowIso(),
        updatedAt: nowIso(),
        reply: previous.reply || null
      };
    } else {
      delete comments[id];
    }
    writeLocal(comments);
    scheduleSave();
  }

  function updateFab() {
    if (!$("cCount")) return;
    var n = commentCount();
    $("cCount").textContent = n;
    $("cFab").classList.toggle("empty", n === 0);
  }

  function markComments() {
    autoInstrument(document);
    document.querySelectorAll(SELECTOR).forEach(function (el) {
      var id = itemId(el);
      var c = comments[id];
      var has = !!(c && c.text);
      el.classList.toggle("has-review-comment", has);
      el.classList.toggle("has-comment", has);
      if (has) {
        el.dataset.reviewStatus = c.status || "open";
        el.title = (c.status === "resolved" ? "Resolved comment: " : "Comment: ") + c.text;
      } else {
        delete el.dataset.reviewStatus;
        if ((el.title || "").startsWith("Comment: ") || (el.title || "").startsWith("Resolved comment: ")) el.removeAttribute("title");
      }
    });
    updateFab();
  }

  function renderList() {
    var ids = Object.keys(comments).filter(function (id) { return comments[id] && comments[id].text; }).sort();
    if (!ids.length) {
      $("cList").innerHTML = '<p>No comments yet. Right-click a marked element to add one.</p>';
      return;
    }

    autoInstrument(document);
    var anchored = {};
    document.querySelectorAll(SELECTOR).forEach(function (el) { anchored[itemId(el)] = true; });

    $("cList").innerHTML = ids.map(function (id) {
      var c = comments[id];
      var orphan = anchored[id] ? "" : " / orphaned";
      var reply = c.reply && c.reply.text ? '<div class="cl-reply">Reply: ' + escHtml(c.reply.text) + '</div>' : "";
      return '<div class="cl-item"><div class="cl-main"><div class="cl-loc">' +
        escHtml(c.group) + ' / ' + escHtml(c.label) +
        '<span class="cl-status">[' + escHtml(c.status || "open") + orphan + ']</span></div><div class="cl-txt">' +
        escHtml(c.text) + '</div>' + reply + '</div><button class="cl-del" data-del="' + escHtml(id) + '">remove</button></div>';
    }).join("");
  }

  function openModal() {
    renderList();
    $("cMd").value = buildMd();
    $("cModal").classList.add("open");
  }

  function closeModal() {
    var modal = $("cModal");
    if (modal) modal.classList.remove("open");
  }

  var popEl = null;
  function openPop(el, x, y) {
    if (!$("cPop")) return;
    popEl = el;
    $("cpopLabel").textContent = (itemGroup(el) ? itemGroup(el) + " · " : "") + itemLabel(el);
    $("cpopTa").value = getC(itemId(el));
    $("cPop").classList.add("open");
    var w = 300;
    var ph = $("cPop").offsetHeight || 180;
    var maxX = window.scrollX + document.documentElement.clientWidth - w - 12;
    var maxY = window.scrollY + document.documentElement.clientHeight - ph - 12;
    $("cPop").style.left = Math.max(window.scrollX + 8, Math.min(x, maxX)) + "px";
    $("cPop").style.top = Math.max(window.scrollY + 8, Math.min(y, maxY)) + "px";
    $("cpopTa").focus();
  }

  function closePop() {
    var pop = $("cPop");
    if (pop) pop.classList.remove("open");
    popEl = null;
  }

  function setStatus(className, html, connectVisible, connectText, fileOn) {
    $("asStatus").className = "as-status" + (className ? " " + className : "");
    $("asStatus").innerHTML = '<span class="d"></span>' + html;
    $("asConnect").style.display = connectVisible ? "" : "none";
    if (connectText) $("asConnect").textContent = connectText;
    $("cFab").classList.toggle("fson", !!fileOn);
  }

  function updateAdapterUI() {
    if (adapter && adapter.kind === "http") {
      setStatus("on", "Autosave -> file (served)", false, "", true);
      return;
    }
    if (!("showSaveFilePicker" in window)) {
      setStatus("", "Autosave: local only", false, "", false);
      return;
    }
    if (!fileHandle) {
      setStatus("", "Autosave: local only", true, "Connect file", false);
      return;
    }
    if (fsState === "on") {
      setStatus("on", "Autosave -> " + escHtml(fileName), true, "Change file", true);
    } else {
      setStatus("err", "Autosave: reconnect needed", true, "Reconnect", false);
    }
  }

  function httpAdapter(config) {
    function api(path, options) {
      var sep = path.indexOf("?") === -1 ? "?" : "&";
      var url = config.base.replace(/\/$/, "") + path + sep + "t=" + encodeURIComponent(config.token || "");
      options = options || {};
      options.headers = Object.assign({ "X-Review-Token": config.token || "" }, options.headers || {});
      return fetch(url, options).then(function (res) {
        if (!res.ok) throw new Error("Review server returned " + res.status);
        return res.json();
      });
    }
    return {
      kind: "http",
      load: function () { return api("/__review/comments").then(documentToMap); },
      save: function (map) {
        return api("/__review/comments", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(map)
        });
      }
    };
  }

  function idbReq(fn) {
    return new Promise(function (resolve, reject) {
      var open = indexedDB.open("fidibakuReview", 1);
      open.onupgradeneeded = function () { open.result.createObjectStore("kv"); };
      open.onerror = function () { reject(open.error); };
      open.onsuccess = function () {
        try { fn(open.result, resolve, reject); } catch (err) { reject(err); }
      };
    });
  }

  function idbSet(k, v) {
    return idbReq(function (db, resolve, reject) {
      var t = db.transaction("kv", "readwrite");
      t.objectStore("kv").put(v, k);
      t.oncomplete = function () { resolve(); };
      t.onerror = function () { reject(t.error); };
    });
  }

  function idbGet(k) {
    return idbReq(function (db, resolve, reject) {
      var t = db.transaction("kv", "readonly");
      var rq = t.objectStore("kv").get(k);
      rq.onsuccess = function () { resolve(rq.result); };
      rq.onerror = function () { reject(rq.error); };
    });
  }

  function ensurePerm(handle) {
    var opts = { mode: "readwrite" };
    return handle.queryPermission(opts).then(function (state) {
      if (state === "granted") return true;
      return handle.requestPermission(opts).then(function (next) { return next === "granted"; }).catch(function () { return false; });
    });
  }

  function fsWrite() {
    if (!fileHandle) return Promise.resolve();
    return ensurePerm(fileHandle).then(function (ok) {
      if (!ok) {
        fsState = "reconnect";
        updateAdapterUI();
        return;
      }
      return fileHandle.createWritable().then(function (writable) {
        return writable.write(buildMd()).then(function () { return writable.close(); });
      }).then(function () {
        fsState = "on";
        updateAdapterUI();
      }).catch(function () {
        fsState = "reconnect";
        updateAdapterUI();
      });
    });
  }

  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      if (adapter) {
        adapter.save(comments).catch(function () {
          setStatus("err", "Autosave: server disconnected", false, "", false);
        });
      } else {
        fsWrite();
      }
    }, 400);
  }

  function connectFile() {
    if (!("showSaveFilePicker" in window)) return;
    window.showSaveFilePicker({
      id: pickerId(),
      suggestedName: (location.pathname.split("/").pop() || "report.html").replace(/\.html?$/i, "") + ".comments.md",
      types: [{ description: "Markdown", accept: { "text/markdown": [".md"] } }]
    }).then(function (handle) {
      fileHandle = handle;
      fileName = handle.name;
      return idbSet(fileHandleKey(), handle);
    }).then(fsWrite).catch(function () {});
  }

  function initFileHandle() {
    if (!("showSaveFilePicker" in window) || adapter) {
      updateAdapterUI();
      return Promise.resolve();
    }
    return idbGet(fileHandleKey()).then(function (handle) {
      if (!handle) return;
      fileHandle = handle;
      fileName = handle.name;
      return handle.queryPermission({ mode: "readwrite" }).then(function (state) {
        fsState = state === "granted" ? "on" : "reconnect";
      });
    }).catch(function () {}).then(updateAdapterUI);
  }

  function bindScaffoldEvents() {
    if (!$("cpopTa")) return;
    $("cpopTa").addEventListener("input", function () {
      if (!popEl) return;
      setC(itemId(popEl), itemGroup(popEl), itemLabel(popEl), $("cpopTa").value);
      markComments();
    });
    $("cpopTa").addEventListener("keydown", function (event) {
      if (event.key !== "Enter" || event.shiftKey) return;
      event.preventDefault();
      if (popEl) {
        setC(itemId(popEl), itemGroup(popEl), itemLabel(popEl), $("cpopTa").value);
        markComments();
      }
      closePop();
    });
    $("cpopDone").addEventListener("click", closePop);
    $("cpopDel").addEventListener("click", function () {
      if (!popEl) return;
      setC(itemId(popEl), itemGroup(popEl), itemLabel(popEl), "");
      $("cpopTa").value = "";
      markComments();
      closePop();
    });
    $("cFab").addEventListener("click", openModal);
    $("cClose").addEventListener("click", closeModal);
    $("cModal").addEventListener("click", function (event) {
      if (event.target === $("cModal")) closeModal();
    });
    $("cList").addEventListener("click", function (event) {
      var button = event.target.closest("[data-del]");
      if (!button) return;
      delete comments[button.dataset.del];
      writeLocal(comments);
      scheduleSave();
      markComments();
      renderList();
      $("cMd").value = buildMd();
    });
    $("cCopy").addEventListener("click", function () {
      var md = buildMd();
      var btn = $("cCopy");
      var done = function () {
        btn.textContent = "Copied";
        setTimeout(function () { btn.textContent = "Copy markdown"; }, 1400);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(md).then(done).catch(function () {
        $("cMd").select();
        document.execCommand("copy");
        done();
      });
      else {
        $("cMd").select();
        document.execCommand("copy");
        done();
      }
    });
    $("cDownload").addEventListener("click", function () {
      var blob = new Blob([buildMd()], { type: "text/markdown" });
      var a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = (location.pathname.split("/").pop() || "report.html").replace(/\.html?$/i, "") + ".comments.md";
      document.body.appendChild(a);
      a.click();
      a.remove();
    });
    $("cClear").addEventListener("click", function () {
      if (!commentCount()) return;
      if (!confirm("Clear all comments? This cannot be undone.")) return;
      comments = {};
      writeLocal(comments);
      scheduleSave();
      markComments();
      renderList();
      $("cMd").value = buildMd();
    });
    $("asConnect").addEventListener("click", function () {
      if (fileHandle && fsState !== "on") fsWrite();
      else connectFile();
    });
  }

  // Document-level listeners: attached once and never re-bound. They live on
  // `document`, so they survive a host framework replacing <body>.
  var globalEventsBound = false;
  function bindGlobalEvents() {
    if (globalEventsBound) return;
    globalEventsBound = true;
    document.addEventListener("contextmenu", function (event) {
      var el = findReviewTarget(event.target);
      if (!el) return;
      event.preventDefault();
      // The host may have wiped our UI since last render; rebuild before use.
      ensureScaffold();
      openPop(el, event.pageX, event.pageY);
    });
    document.addEventListener("click", function (event) {
      var pop = $("cPop");
      if (pop && pop.classList.contains("open") && !pop.contains(event.target)) closePop();
    });
    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape") {
        closePop();
        closeModal();
      }
    });
  }

  // Self-heal: SPA/SSR frameworks routinely replace <body> on hydration or
  // client navigation, which removes our scaffold and strips the data-review-*
  // anchors we add. Watch the document and, debounced, re-mount the UI when our
  // root goes missing and re-apply anchors/markers. Anchoring also happens
  // lazily on right-click (findReviewTarget), so commenting works even between
  // re-renders.
  function observeScaffold() {
    if (typeof MutationObserver === "undefined" || !document.body) return;
    var scheduled = false;
    var observer = new MutationObserver(function () {
      if (scheduled) return;
      scheduled = true;
      setTimeout(function () {
        scheduled = false;
        ensureScaffold();
        markComments();
      }, 300);
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  function init() {
    ensureScaffold();
    bindGlobalEvents();
    autoInstrument(document);
    comments = readLocal();
    if (window.__REVIEW_SERVER__) {
      adapter = httpAdapter(window.__REVIEW_SERVER__);
      adapter.load().then(function (serverMap) {
        var serverCount = Object.keys(serverMap).length;
        comments = normalizeMap(Object.assign({}, comments, serverMap));
        writeLocal(comments);
        markComments();
        updateAdapterUI();
        if (Object.keys(comments).length > serverCount) scheduleSave();
      }).catch(function () {
        setStatus("err", "Autosave: server unavailable", false, "", false);
      });
    }
    markComments();
    initFileHandle();
    observeScaffold();
  }

  // Init once the DOM exists. A host that renders its own DOM later (SSR
  // hydration, SPA mount) is handled by observeScaffold(), which re-mounts the
  // overlay whenever it gets removed.
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
