// fidibaku's targeting and anchoring: which part of a page a right-click (or a tap) is on, what to call it, and what
// to remember about it so it can be found again. It only reads the page, never writes on it.
// client/review.js uses it, and so does the comment layer on claws share pages (vendored there as
// tracker/src/share/fidibaku-anchor.js): change it here, then copy it across unchanged.
//
// A part is, from the node under the pointer upwards, the first of:
// - a page's own mark: [data-review-id] (not one fidibaku added itself) or [data-cid];
// - a heading, paragraph, list item, table cell or row, quote, code block or command, caption, summary, link or button
//   with text;
// - a picture, figure, SVG or canvas chart, video or audio, or a web component (model-viewer, a Lottie player), whatever
//   its text (a picture in a figure is the figure);
// - a section, card, panel, table or other block holding a little text (8 characters or more);
// - a shape drawn in CSS with no words (a bar of a chart, a swatch, an animated card): painted, and 16 x 16 px or more.
// A link, button, label or bit of code inside running text is the text it sits in; code inside a <pre> is the <pre>.
// Parts smaller than 12 x 10 px are skipped.
(function (root, factory) {
  if (typeof module === "object" && module && module.exports) module.exports = factory();
  else root.fidibakuAnchor = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var EXPLICIT = "[data-review-id]:not([data-review-auto]),[data-cid]";
  var MEDIA = ["img", "picture", "canvas", "svg", "video", "audio"];
  var TAGS = [
    "main", "article", "section", "aside", "header", "footer", "nav",
    "h1", "h2", "h3", "h4", "h5", "h6",
    "div", "p", "li", "blockquote", "pre", "figure", "figcaption",
    "img", "picture", "canvas", "svg", "video", "audio",
    "table", "caption", "thead", "tbody", "tfoot", "tr", "th", "td",
    "dl", "dt", "dd", "ul", "ol", "details", "summary", "a", "button", "label", "code"
  ];
  var STYLED = "[role='row'],[role='listitem'],[role='article'],[role='region'],[class*='card'],[class*='panel'],[class*='item'],[class*='row'],[class*='section']";
  var AUTO_SELECTOR = TAGS.join(",") + "," + STYLED;
  // A part with any text at all; the rest need a little text (8 characters) to be more than a wrapper.
  var WORDS = /^(h[1-6]|p|li|blockquote|pre|figcaption|caption|tr|th|td|dt|dd|summary|a|button|label|code)$/;
  // Running text a link or button can sit in.
  var FLOW = /^(p|li|td|th|dt|dd|h[1-6]|caption|figcaption|blockquote|summary)$/;
  var INLINE = /^(span|b|strong|em|i|u|s|small|mark|code|kbd|sup|sub|abbr|cite|q|time|var|samp|bdi|bdo|font)$/;
  // Elements that can be a shape drawn in CSS when they hold no words.
  var DRAWN = /^(div|span|i|b|a|li|section|article|aside|figure|button|label|em|strong|p)$/;
  // Blocks whose bold lead names them (a card's title).
  var NAMED = /^(div|section|article|aside|header|a|details|li)$/;
  var SKIP = /^(script|style|link|meta|template|br|hr|head|title|noscript|html|body)$/;

  function tagOf(el) { return String((el && el.tagName) || "").toLowerCase(); }
  function norm(value) { return String(value || "").replace(/\s+/g, " ").trim(); }
  function text(el) { return norm(el.innerText || el.textContent); }
  function clip(value, max) {
    value = norm(value);
    return value.length > max ? value.slice(0, max - 3) + "..." : value;
  }
  function summary(el, max, fallback) {
    var t = text(el);
    if (!t) return fallback;
    return clip(t, max || 80);
  }
  function attr(el, name) { return el.getAttribute ? norm(el.getAttribute(name)) : ""; }

  function hash(value) {
    var h = 2166136261;
    for (var i = 0; i < value.length; i += 1) {
      h ^= value.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0).toString(36);
  }

  function path(el) {
    var parts = [];
    var body = el.ownerDocument && el.ownerDocument.body;
    for (var cur = el; cur && cur.nodeType === 1 && cur !== body && parts.length < 8; cur = cur.parentElement) {
      var index = 1;
      for (var sib = cur; (sib = sib.previousElementSibling);) if (sib.tagName === cur.tagName) index += 1;
      parts.unshift(tagOf(cur) + ":nth-of-type(" + index + ")");
    }
    return parts.join(">");
  }

  /** fidibaku's id for a part with no mark of its own: its tag, place and words. */
  function autoId(el) {
    var tag = tagOf(el);
    return "auto:" + tag + ":" + hash(tag + "|" + path(el) + "|" + summary(el, 80, tag));
  }

  // A web component (its tag has a dash): model-viewer, a Lottie player, anything with its own shadow DOM.
  function custom(el) { return tagOf(el).indexOf("-") > 0; }
  // Painted: a background colour or picture, or a border, so it shows as a shape without any words.
  function painted(el) {
    var s = el.ownerDocument.defaultView.getComputedStyle(el);
    if (s.visibility === "hidden" || Number(s.opacity) === 0) return false;
    if (s.backgroundImage && s.backgroundImage !== "none") return true;
    if (!/^(transparent|rgba\(0, 0, 0, 0\))$/.test(s.backgroundColor)) return true;
    return ["Top", "Right", "Bottom", "Left"].some(function (side) {
      return parseFloat(s["border" + side + "Width"]) > 0 && s["border" + side + "Style"] !== "none" && !/rgba\(0, 0, 0, 0\)|transparent/.test(s["border" + side + "Color"]);
    });
  }

  function isCandidate(el) {
    if (!el || el.nodeType !== 1) return false;
    var tag = tagOf(el);
    if (SKIP.test(tag)) return false;
    var listed = TAGS.indexOf(tag) >= 0 || el.matches(STYLED);
    if (!listed && !custom(el) && !DRAWN.test(tag)) return false;
    var rect = el.getBoundingClientRect();
    if (rect.width < 12 || rect.height < 10) return false;
    if (MEDIA.indexOf(tag) >= 0 || tag === "figure") return true;
    if (custom(el)) return rect.width >= 24 && rect.height >= 24;
    var length = text(el).length;
    // A shape drawn in CSS: no words, but painted and big enough to point at.
    if (!length && DRAWN.test(tag)) return rect.width >= 16 && rect.height >= 16 && !el.querySelector("img,svg,canvas,video") && painted(el);
    if (!listed) return false;
    return WORDS.test(tag) ? length > 0 : length >= 8;
  }

  // The block a link or button sits in when it's part of running text, else null (a button alone in its paragraph
  // is a part of its own).
  function flowHost(el) {
    var up = el.parentElement;
    while (up && INLINE.test(tagOf(up))) up = up.parentElement;
    return up && FLOW.test(tagOf(up)) && isCandidate(up) && text(up).length > text(el).length ? up : null;
  }

  /** The part under `node` (an element or text node), or null. `options.skip(el)` stops at a host's own UI. */
  function target(node, options) {
    var el = node && node.nodeType === 1 ? node : node && node.parentElement;
    if (!el || !el.closest) return null;
    var skip = options && options.skip;
    if (skip && skip(el)) return null;
    var marked = el.closest(EXPLICIT);
    if (marked) return marked;
    var doc = el.ownerDocument;
    for (var cur = el; cur && cur !== doc.body && cur !== doc.documentElement; cur = cur.parentElement) {
      if (!isCandidate(cur)) continue;
      var tag = tagOf(cur);
      if ((tag === "a" || tag === "button" || tag === "label" || tag === "code") && flowHost(cur)) continue;
      if (tag === "code" && cur.parentElement && cur.parentElement.closest("pre")) continue;
      if (MEDIA.indexOf(tag) >= 0) {
        var figure = cur.parentElement && cur.parentElement.closest("figure");
        if (figure && isCandidate(figure)) return figure;
      }
      return cur;
    }
    return null;
  }

  /** The nearest heading (h1-h4) at or before `el`: the part itself when it is one. */
  function heading(el) {
    var doc = el.ownerDocument;
    var all = doc.querySelectorAll("h1,h2,h3,h4");
    var found = "";
    for (var i = 0; i < all.length; i += 1) {
      if (all[i] === el || all[i].contains(el)) return text(all[i]);
      if (all[i].compareDocumentPosition(el) & 4) found = text(all[i]);
      else break;
    }
    return found;
  }

  /** What a part is listed under: its page's own group, else the heading it sits under. */
  function group(el) {
    var marked = el.closest("[data-review-group]:not([data-review-auto]),[data-cgroup]");
    if (marked) return attr(marked, "data-review-group") || attr(marked, "data-cgroup");
    var near = heading(el);
    if (near && near !== text(el)) return clip(near, 80);
    var section = el.closest("section, article, main, aside, nav, header, footer");
    var h = section && section !== el && section.querySelector("h1,h2,h3,h4,h5,h6");
    if (h) return summary(h, 80, "Auto");
    var tag = tagOf(el);
    if (/^h[1-6]$/.test(tag)) return "Headings";
    if (/^(tr|td|th|table)$/.test(tag)) return "Tables";
    if (tag === "li") return "Lists";
    return "Auto";
  }

  // A cell's column, counting spans, and the header above it.
  function cell(el) {
    var row = el.parentElement;
    if (!row || tagOf(row) !== "tr") return null;
    var col = 0;
    for (var i = 0; i < row.cells.length && row.cells[i] !== el; i += 1) col += row.cells[i].colSpan || 1;
    var table = row.closest("table");
    var head = null;
    if (table) {
      if (table.tHead && table.tHead.rows.length) head = table.tHead.rows[table.tHead.rows.length - 1];
      else if (table.rows.length && table.rows[0] !== row && table.rows[0].querySelector("th")) head = table.rows[0];
    }
    var header = "";
    if (head && head !== row) {
      for (var j = 0, at = 0; j < head.cells.length; j += 1) {
        var span = head.cells[j].colSpan || 1;
        if (col >= at && col < at + span) { header = text(head.cells[j]); break; }
        at += span;
      }
    }
    // The row's name: its first cell with words in it (a rank column is only numbers).
    var name = "";
    for (var k = 0; k < row.cells.length && !name; k += 1) {
      var words = text(row.cells[k]);
      if (/[A-Za-z]/.test(words)) name = row.cells[k] === el ? "" : words;
      if (row.cells[k] === el) break;
    }
    var isHead = head === row || tagOf(row.parentElement) === "thead";
    return { col: col, row: text(row).slice(0, 200), rowName: isHead ? "" : name, header: isHead ? "" : header };
  }

  function fileOf(src) { return String(src || "").split(/[?#]/)[0].split("/").pop(); }
  function mediaSrc(el) {
    var source = el.querySelector && el.querySelector("source");
    return el.getAttribute("src") || el.getAttribute("data") || (source && source.getAttribute("src")) || "";
  }
  // Where a video or audio is (1:23), when it has been played or moved on.
  function moment(el) {
    var t = Number(el.currentTime) || 0;
    if (t < 0.5) return "";
    var m = Math.floor(t / 60), sec = Math.floor(t % 60);
    return m + ":" + (sec < 10 ? "0" : "") + sec;
  }

  /** What to call a part in a list of comments ("Tomato slicing · D: 1", a picture's alt, a card's title). */
  function label(el, max) {
    max = max || 80;
    var tag = tagOf(el);
    var own = !el.hasAttribute("data-review-auto") && (attr(el, "data-review-label") || attr(el, "data-clabel"));
    if (own) return clip(own, max);
    var named = attr(el, "aria-label");
    if (named) return clip(named, max);
    var title = attr(el, "title");
    if (title && !/^(Resolved comment|Comment): /.test(title)) return clip(title, max);
    if (tag === "td" || tag === "th") {
      var c = cell(el), value = text(el);
      if (c && (c.rowName || c.header)) return clip((c.rowName ? c.rowName + " · " : "") + (c.header ? c.header + ": " : "") + value, max);
    }
    if (tag === "img") return clip(attr(el, "alt") || fileOf(el.getAttribute("src")) || "Picture", max);
    if (tag === "picture" || tag === "figure") {
      var caption = tag === "figure" && el.querySelector("figcaption");
      if (caption && text(caption)) return clip(text(caption), max);
      var media = el.querySelector("img,svg,canvas,video");
      if (media) return label(media, max);
    }
    if (tag === "svg") {
      var svgTitle = el.querySelector("title");
      if (svgTitle && norm(svgTitle.textContent)) return clip(svgTitle.textContent, max);
      var words = text(el);
      return clip(words ? "Chart: " + words : "Chart", max);
    }
    if (tag === "canvas") return "Chart";
    if (tag === "video" || tag === "audio") {
      var at = moment(el);
      return clip((fileOf(mediaSrc(el)) || (tag === "video" ? "Video" : "Audio")) + (at ? " at " + at : ""), max);
    }
    if (custom(el)) return clip(attr(el, "alt") || tag.replace(/-/g, " "), max);
    if (!text(el)) return "Drawing";
    if (NAMED.test(tag) || el.matches(STYLED)) {
      var lead = el.firstElementChild;
      if (lead && /^(b|strong|h[1-6]|dt|summary)$/.test(tagOf(lead))) {
        var leadText = text(lead);
        if (leadText && leadText.length < text(el).length) return clip(leadText, max);
      }
    }
    return summary(el, max, tag);
  }

  /** Everything worth keeping about a part to find it again in a later version of the page. */
  function describe(el) {
    var tag = tagOf(el);
    var out = { tag: tag, label: label(el, 60), group: group(el), text: text(el).slice(0, 200), heading: heading(el), path: path(el), auto: autoId(el) };
    var id = (!el.hasAttribute("data-review-auto") && attr(el, "data-review-id")) || attr(el, "data-cid");
    if (id) out.id = id;
    var img = tag === "img" ? el : el.querySelector && el.querySelector("img");
    var src = img && fileOf(img.getAttribute("src"));
    if (src) out.src = src;
    // A video or audio: its file, and the moment he's at (seconds), so the note can take him back there.
    var media = tag === "video" || tag === "audio" ? el : el.querySelector && el.querySelector("video,audio");
    if (media) {
      if (!out.src && fileOf(mediaSrc(media))) out.src = fileOf(mediaSrc(media));
      if (Number(media.currentTime) >= 0.5) out.time = Math.round(media.currentTime * 10) / 10;
    }
    if (tag === "td" || tag === "th") {
      var c = cell(el);
      if (c) { out.row = c.row; out.col = c.col; }
    }
    return out;
  }

  return {
    AUTO_SELECTOR: AUTO_SELECTOR,
    EXPLICIT: EXPLICIT,
    autoId: autoId,
    cell: cell,
    describe: describe,
    group: group,
    hash: hash,
    heading: heading,
    isCandidate: isCandidate,
    label: label,
    path: path,
    summary: summary,
    target: target,
    text: text
  };
});
