(function () {
  "use strict";

  // Which part a right-click is on, and what to call it: client/anchor.js, loaded just before this file.
  var A = window.fidibakuAnchor;
  var VERSION = 1;
  var SELECTOR = "[data-review-id], [data-cid]";
  var AUTO_SELECTOR = A.AUTO_SELECTOR;
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

  // ---- Views -------------------------------------------------------------
  // A "view" is what the reviewer is looking at when they comment. Single-file
  // decks and SPAs re-render the same elements (#caption, main, header) for
  // every route, so a comment is scoped to the view it was made on and only
  // marked there. Default: pathname + search + hash, with Fidibaku's own
  // session token removed. Pages can name their views instead (first match):
  //   window.fidibakuView = "slide-3"   (or a function returning the name)
  //   <html data-fidibaku-view="slide-3">
  //   <meta name="fidibaku-view" content="slide-3">

  function reviewToken() {
    return (window.__REVIEW_SERVER__ && window.__REVIEW_SERVER__.token) || "";
  }

  function cleanSearch(search) {
    var raw = String(search || "").replace(/^\?/, "");
    if (!raw) return "";
    var token = reviewToken();
    var kept = raw.split("&").filter(function (part) {
      if (!part) return false;
      if (!token || part.split("=")[0] !== "t") return true;
      var value = part.slice(2);
      try { value = decodeURIComponent(value.replace(/\+/g, " ")); } catch (err) {}
      return value !== token;
    });
    return kept.length ? "?" + kept.join("&") : "";
  }

  function currentUrl() {
    return location.pathname + cleanSearch(location.search) + location.hash;
  }

  function viewOverride() {
    var value = window.fidibakuView;
    if (typeof value === "function") {
      try { value = value(); } catch (err) { value = null; }
    }
    if (value !== null && value !== undefined && String(value).trim()) return String(value).trim();
    var root = document.documentElement;
    var attr = root && root.getAttribute("data-fidibaku-view");
    if (attr && attr.trim()) return attr.trim();
    var meta = document.querySelector('meta[name="fidibaku-view"]');
    var content = meta && meta.getAttribute("content");
    if (content && content.trim()) return content.trim();
    return "";
  }

  function currentView() {
    return viewOverride() || currentUrl();
  }

  function commentView(c) {
    return c && typeof c.view === "string" && c.view ? c.view : "";
  }

  function commentAnchor(c) {
    return (c && c.anchor) || (c && c.id) || "";
  }

  // Comments saved before views existed have no view and show on every view.
  function visibleIn(c, view) {
    var v = commentView(c);
    return !v || v === view;
  }

  function viewKey(anchor, view) {
    return anchor + "@" + hashString(view);
  }

  function compareViews(a, b) {
    a = String(a);
    b = String(b);
    return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }) || (a < b ? -1 : a > b ? 1 : 0);
  }

  var hashString = A.hash;

  function ownTitle(value) {
    value = String(value || "");
    return value.indexOf("Comment: ") === 0 || value.indexOf("Resolved comment: ") === 0;
  }

  function isAutoCandidate(el, alreadyAuto) {
    if (!el || el.nodeType !== 1) return false;
    if (el.closest(REVIEW_UI_SELECTOR)) return false;
    if (!alreadyAuto && el.matches(SELECTOR)) return false;
    return A.isCandidate(el);
  }

  var autoId = A.autoId;

  function clearMarker(el) {
    el.classList.remove("has-review-comment", "has-comment");
    delete el.dataset.reviewStatus;
    if (ownTitle(el.title)) el.removeAttribute("title");
  }

  function ensureAutoAnchor(el) {
    if (!el || !isAutoCandidate(el)) return null;
    if (itemId(el)) return el;
    el.dataset.reviewId = autoId(el);
    el.dataset.reviewGroup = A.group(el);
    el.dataset.reviewLabel = A.label(el, 80);
    el.dataset.reviewAuto = "true";
    return el;
  }

  // Auto IDs are derived from tag, DOM path and text. When a page re-renders an
  // element in place (a deck swapping #caption text per slide), re-derive the
  // ID so it matches what a fresh load of that view would compute. Otherwise a
  // comment made after navigating would carry the previous view's ID and be
  // orphaned on reload.
  function refreshAutoAnchor(el) {
    if (!el || el.dataset.reviewAuto !== "true") return el;
    if (!isAutoCandidate(el, true)) {
      clearMarker(el);
      delete el.dataset.reviewId;
      delete el.dataset.reviewGroup;
      delete el.dataset.reviewLabel;
      delete el.dataset.reviewAuto;
      return null;
    }
    var next = autoId(el);
    if (next !== el.dataset.reviewId) {
      el.dataset.reviewId = next;
      el.dataset.reviewGroup = A.group(el);
      el.dataset.reviewLabel = A.label(el, 80);
    }
    return el;
  }

  function autoInstrument(root) {
    var scope = root && root.querySelectorAll ? root : document;
    scope.querySelectorAll("[data-review-auto='true']").forEach(refreshAutoAnchor);
    scope.querySelectorAll(AUTO_SELECTOR).forEach(ensureAutoAnchor);
  }

  // The page's own mark wins; otherwise the part anchor.js picks (a cell, a picture's figure, the paragraph a link
  // sits in), given an auto ID now if it has none yet.
  function findReviewTarget(target) {
    var el = A.target(target, { skip: function (node) { return !!node.closest(REVIEW_UI_SELECTOR); } });
    if (!el) return null;
    if (el.dataset.reviewAuto === "true") return refreshAutoAnchor(el);
    if (itemId(el)) return el;
    return ensureAutoAnchor(el);
  }

  function commentIds() {
    return Object.keys(comments).filter(function (id) { return comments[id] && comments[id].text; });
  }

  function commentCount() {
    return commentIds().length;
  }

  function viewCount(view) {
    return commentIds().filter(function (id) { return visibleIn(comments[id], view); }).length;
  }

  function optionalString(value) {
    return typeof value === "string" && value ? value : null;
  }

  function normalizeMap(map) {
    var normalized = {};
    Object.keys(map || {}).forEach(function (id) {
      var c = map[id] || {};
      var text = String(c.text || "").trim();
      if (!id || !text) return;
      var item = {
        id: id,
        group: c.group || "Ungrouped",
        label: c.label || id,
        text: text,
        status: c.status || "open",
        createdAt: c.createdAt || nowIso(),
        updatedAt: c.updatedAt || nowIso(),
        reply: c.reply || null
      };
      ["anchor", "view", "url"].forEach(function (key) {
        var value = optionalString(c[key]);
        if (value) item[key] = value;
      });
      normalized[id] = item;
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

    function renderGroups(list, level) {
      var groups = {};
      var order = [];
      list.forEach(function (c) {
        if (!groups[c.group]) {
          groups[c.group] = [];
          order.push(c.group);
        }
        groups[c.group].push(c);
      });
      order.forEach(function (group) {
        out += "\n" + level + " " + group + "\n";
        groups[group].forEach(function (c) {
          out += "- [" + c.status + "] **" + c.label + "** (" + c.id + "):\n";
          out += markdownFence(c.text, "  ");
          if (c.reply && c.reply.text) {
            out += "  - Reply:\n";
            out += markdownFence(c.reply.text, "    ");
          }
        });
      });
    }

    if (!items.some(commentView)) {
      renderGroups(items, "##");
      return out;
    }
    groupByView(items).forEach(function (bucket) {
      out += "\n## " + viewHeading(bucket.view, bucket.items.length) + "\n";
      renderGroups(bucket.items, "###");
    });
    return out;
  }

  // Comments grouped by view: "all views" (pre-view comments) first, then views
  // in natural order so a deck reads #1.1, #1.2, #2.1, ... #10.1.
  function groupByView(items) {
    var buckets = {};
    items.forEach(function (c) {
      var view = commentView(c);
      buckets[view] = buckets[view] || [];
      buckets[view].push(c);
    });
    return Object.keys(buckets).sort(function (a, b) {
      if (!a) return -1;
      if (!b) return 1;
      return compareViews(a, b);
    }).map(function (view) { return { view: view, items: buckets[view] }; });
  }

  function viewHeading(view, count) {
    var noun = count === 1 ? " comment" : " comments";
    return (view ? "View: `" + view.replace(/`/g, "'") + "`" : "All views") + " (" + count + noun + ")";
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
      '<div class="cmbody"><p>Right-click any marked element to add or edit a comment. Each comment belongs to the view it was made on; click one to jump to it. Comments autosave when a file or server adapter is connected.</p><div id="cList"></div><details class="cmd-details"><summary>Show markdown</summary><textarea id="cMd" readonly></textarea></details></div>',
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

  // Which comment a right-click on `el` edits. A pre-view comment on the same
  // anchor keeps today's behaviour (edited in place, shown on every view);
  // otherwise the comment belongs to the current view.
  function commentTarget(el) {
    var anchor = itemId(el);
    var legacy = comments[anchor];
    var base = { anchor: anchor, group: itemGroup(el), label: itemLabel(el) };
    if (legacy && legacy.text && !commentView(legacy)) {
      base.key = anchor;
      return base;
    }
    var view = currentView();
    base.key = viewKey(anchor, view);
    base.view = view;
    base.url = currentUrl();
    return base;
  }

  function setC(target, text) {
    var id = target.key;
    var previous = comments[id] || {};
    var trimmed = String(text || "").trim();
    if (trimmed) {
      var next = {
        id: id,
        group: target.group || previous.group || "Ungrouped",
        label: target.label || previous.label || id,
        text: trimmed,
        status: previous.status || "open",
        createdAt: previous.createdAt || nowIso(),
        updatedAt: nowIso(),
        reply: previous.reply || null
      };
      var view = target.view || previous.view;
      if (view) {
        next.anchor = target.anchor || previous.anchor || id;
        next.view = view;
        next.url = target.url || previous.url || null;
        if (!next.url) delete next.url;
      }
      comments[id] = next;
    } else {
      delete comments[id];
    }
    writeLocal(comments);
    scheduleSave();
  }

  function updateFab() {
    if (!$("cCount")) return;
    var total = commentCount();
    var here = viewCount(currentView());
    var label = here === total ? String(total) : here + "/" + total;
    if ($("cCount").textContent !== label) $("cCount").textContent = label;
    $("cFab").classList.toggle("empty", here === 0);
    var hint = here + " on this view, " + total + " in total";
    if ($("cFab").title !== hint) $("cFab").title = hint;
  }

  function markComments() {
    autoInstrument(document);
    var view = currentView();
    var byAnchor = {};
    commentIds().forEach(function (id) {
      var c = comments[id];
      if (!visibleIn(c, view)) return;
      var anchor = commentAnchor(c);
      (byAnchor[anchor] = byAnchor[anchor] || []).push(c);
    });
    document.querySelectorAll(SELECTOR).forEach(function (el) {
      if (el.closest(REVIEW_UI_SELECTOR)) return;
      var list = byAnchor[itemId(el)];
      if (!list || !list.length) {
        clearMarker(el);
        return;
      }
      // View-scoped comments first, then any pre-view comment on the anchor.
      list.sort(function (a, b) { return (commentView(a) ? 0 : 1) - (commentView(b) ? 0 : 1); });
      var primary = list.filter(function (c) { return (c.status || "open") === "open"; })[0] || list[0];
      el.classList.add("has-review-comment", "has-comment");
      el.dataset.reviewStatus = primary.status || "open";
      el.title = (primary.status === "resolved" ? "Resolved comment: " : "Comment: ") + list.map(function (c) { return c.text; }).join("\n\n");
    });
    updateFab();
  }

  function renderList() {
    var ids = commentIds().sort();
    if (!ids.length) {
      $("cList").innerHTML = '<p>No comments yet. Right-click a marked element to add one.</p>';
      return;
    }

    autoInstrument(document);
    var anchored = {};
    document.querySelectorAll(SELECTOR).forEach(function (el) { anchored[itemId(el)] = true; });
    var view = currentView();

    $("cList").innerHTML = groupByView(ids.map(function (id) { return comments[id]; })).map(function (bucket) {
      var here = bucket.view === view;
      var heading = (bucket.view ? escHtml(bucket.view) : "All views") +
        ' <span class="cl-count">' + bucket.items.length + '</span>' +
        (here ? ' <span class="cl-here">this view</span>' : "");
      return '<div class="cl-view' + (here ? " current" : "") + '" data-view="' + escHtml(bucket.view) + '">' + heading + '</div>' +
        bucket.items.map(function (c) {
          // Orphaned only makes sense where the comment should be visible.
          var orphan = visibleIn(c, view) && !anchored[commentAnchor(c)] ? " / orphaned" : "";
          var reply = c.reply && c.reply.text ? '<div class="cl-reply">Reply: ' + escHtml(c.reply.text) + '</div>' : "";
          return '<div class="cl-item" data-open="' + escHtml(c.id) + '"><div class="cl-main"><div class="cl-loc">' +
            escHtml(c.group) + ' / ' + escHtml(c.label) +
            '<span class="cl-status">[' + escHtml(c.status || "open") + orphan + ']</span></div><div class="cl-txt">' +
            escHtml(c.text) + '</div>' + reply + '</div><button class="cl-del" data-del="' + escHtml(c.id) + '">remove</button></div>';
        }).join("");
    }).join("");
  }

  function anchorElement(anchor) {
    if (!anchor) return null;
    autoInstrument(document);
    var found = null;
    document.querySelectorAll(SELECTOR).forEach(function (el) {
      if (!found && itemId(el) === anchor && !el.closest(REVIEW_UI_SELECTOR)) found = el;
    });
    return found;
  }

  function flash(el) {
    if (el.scrollIntoView) el.scrollIntoView({ block: "center", behavior: "smooth" });
    el.classList.add("review-flash");
    setTimeout(function () { el.classList.remove("review-flash"); }, 1800);
  }

  // Wait for the page to render the view, then scroll to and flash the anchor.
  function highlightAnchor(anchor, timeoutMs) {
    return new Promise(function (resolve) {
      var deadline = Date.now() + (timeoutMs || 0);
      (function attempt() {
        markComments();
        var el = anchorElement(anchor);
        if (el) {
          flash(el);
          resolve(true);
        } else if (Date.now() < deadline) {
          setTimeout(attempt, 100);
        } else {
          resolve(false);
        }
      })();
    });
  }

  function pendingFocusKey() {
    return "fidibaku:focus:" + storageKey();
  }

  // Navigate to a comment's view. Hash views set the hash; path views use
  // history.pushState plus a popstate event so client-side routers render it.
  // If nothing renders the anchor (a multi-page site), fall back to a full
  // load and finish the highlight after it.
  function navigateTo(url, anchor) {
    var target = new URL(url, location.href);
    var token = reviewToken();
    var here = new URL(location.href);
    if (token && here.searchParams.get("t") === token && !target.searchParams.has("t")) target.searchParams.set("t", token);
    var samePage = target.pathname === here.pathname && cleanSearch(target.search) === cleanSearch(here.search);
    if (samePage) {
      if (target.hash !== here.hash) location.hash = target.hash;
      return highlightAnchor(anchor, 3000);
    }
    var next = target.pathname + target.search + target.hash;
    history.pushState(history.state, "", next);
    try {
      window.dispatchEvent(new PopStateEvent("popstate", { state: history.state }));
    } catch (err) {}
    return highlightAnchor(anchor, 1500).then(function (found) {
      if (found) return true;
      try { sessionStorage.setItem(pendingFocusKey(), anchor); } catch (err) {}
      location.assign(target.toString());
      return false;
    });
  }

  function focusComment(id) {
    var c = comments[id];
    if (!c) return Promise.resolve(false);
    closeModal();
    var anchor = commentAnchor(c);
    if (visibleIn(c, currentView())) return highlightAnchor(anchor, 1000);
    var url = c.url || (commentView(c).charAt(0) === "/" ? commentView(c) : "");
    if (!url) return highlightAnchor(anchor, 1000);
    return navigateTo(url, anchor);
  }

  function resumePendingFocus() {
    var anchor = null;
    try {
      anchor = sessionStorage.getItem(pendingFocusKey());
      if (anchor) sessionStorage.removeItem(pendingFocusKey());
    } catch (err) {}
    if (anchor) highlightAnchor(anchor, 3000);
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
  var popTarget = null;
  function openPop(el, x, y) {
    if (!$("cPop")) return;
    popEl = el;
    // Capture the anchor and view now: the page may re-render while typing.
    popTarget = commentTarget(el);
    $("cpopLabel").textContent = (itemGroup(el) ? itemGroup(el) + " · " : "") + itemLabel(el);
    $("cpopTa").value = getC(popTarget.key);
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
    popTarget = null;
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
      if (!popTarget) return;
      setC(popTarget, $("cpopTa").value);
      markComments();
    });
    $("cpopTa").addEventListener("keydown", function (event) {
      if (event.key !== "Enter" || event.shiftKey) return;
      event.preventDefault();
      if (popTarget) {
        setC(popTarget, $("cpopTa").value);
        markComments();
      }
      closePop();
    });
    $("cpopDone").addEventListener("click", closePop);
    $("cpopDel").addEventListener("click", function () {
      if (!popTarget) return;
      setC(popTarget, "");
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
      if (!button) {
        var item = event.target.closest("[data-open]");
        var selection = window.getSelection && String(window.getSelection() || "");
        if (item && !selection) focusComment(item.dataset.open);
        return;
      }
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
  function remark() {
    ensureScaffold();
    markComments();
    var modal = $("cModal");
    if (modal && modal.classList.contains("open")) renderList();
  }

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
    // `data-fidibaku-view` and `content` catch view overrides changing in place.
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["data-fidibaku-view", "content"]
    });
  }

  // Re-evaluate which comments to mark whenever the view can change: hash and
  // history navigation (including client-side routers calling pushState or
  // replaceState) and an explicit `fidibaku:viewchange` event from the page.
  // DOM re-renders are covered by observeScaffold().
  function watchLocation() {
    var onChange = function () {
      // Run after the page's own listeners have re-rendered the view.
      setTimeout(remark, 0);
      setTimeout(remark, 80);
    };
    if (!window.__fidibakuHistoryPatched && window.history) {
      window.__fidibakuHistoryPatched = true;
      ["pushState", "replaceState"].forEach(function (name) {
        var original = history[name];
        if (typeof original !== "function") return;
        history[name] = function () {
          var result = original.apply(this, arguments);
          try { window.dispatchEvent(new Event("fidibaku:locationchange")); } catch (err) {}
          return result;
        };
      });
    }
    window.addEventListener("hashchange", onChange);
    window.addEventListener("popstate", onChange);
    window.addEventListener("fidibaku:locationchange", onChange);
    window.addEventListener("fidibaku:viewchange", onChange);
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
        resumePendingFocus();
      }).catch(function () {
        setStatus("err", "Autosave: server unavailable", false, "", false);
      });
    } else {
      resumePendingFocus();
    }
    markComments();
    initFileHandle();
    observeScaffold();
    watchLocation();
  }

  // Init once the DOM exists. A host that renders its own DOM later (SSR
  // hydration, SPA mount) is handled by observeScaffold(), which re-mounts the
  // overlay whenever it gets removed.
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
