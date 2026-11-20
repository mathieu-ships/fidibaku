"use strict";

const fs = require("fs");
const path = require("path");

const VERSION = 1;
const VALID_STATUSES = new Set(["open", "resolved", "wontfix"]);
const VIEW_FIELDS = ["anchor", "view", "url"];

function nowIso() {
  return new Date().toISOString();
}

function sidecarPaths(targetFile) {
  const resolved = path.resolve(targetFile);
  // Accept the sidecar itself (`page.comments.json` / `.md`) as well as the
  // page or a sidecar base name (`page.html`).
  const sidecar = resolved.match(/^(.*)\.comments\.(json|md)$/i);
  const parsed = path.parse(sidecar ? `${sidecar[1]}.html` : resolved);
  const base = path.join(parsed.dir, parsed.name);
  return {
    json: `${base}.comments.json`,
    md: `${base}.comments.md`,
    target: parsed.base,
    dir: parsed.dir
  };
}

function atomicWrite(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, content);
  fs.renameSync(tmp, filePath);
}

function normalizeComment(id, raw, previous) {
  raw = raw || {};
  if (!id || typeof id !== "string") {
    throw new Error("Comment id must be a non-empty string.");
  }

  const text = String(raw && raw.text ? raw.text : "").trim();
  if (!text) return null;

  const prev = previous || {};
  const status = VALID_STATUSES.has(raw.status) ? raw.status : (VALID_STATUSES.has(prev.status) ? prev.status : "open");
  const createdAt = raw.createdAt || prev.createdAt || nowIso();

  let reply = raw.reply === undefined ? prev.reply || null : raw.reply;
  if (reply && typeof reply === "string") reply = { text: reply, at: nowIso() };
  if (reply && typeof reply === "object") {
    reply = {
      text: String(reply.text || "").trim(),
      at: reply.at || nowIso()
    };
    if (!reply.text) reply = null;
  } else {
    reply = null;
  }

  const comment = {
    id,
    group: String(raw.group || prev.group || "Ungrouped"),
    label: String(raw.label || prev.label || id),
    text,
    status,
    createdAt,
    updatedAt: raw.updatedAt || nowIso(),
    reply
  };

  // View scoping (optional): `view` is where the comment shows, `anchor` the
  // element it is attached to, `url` where it was made. Comments without a
  // view predate views and show on every view.
  for (const key of VIEW_FIELDS) {
    const value = raw[key] === undefined ? prev[key] : raw[key];
    if (typeof value === "string" && value) comment[key] = value;
  }

  return comment;
}

function commentsArrayToMap(comments) {
  const map = {};
  for (const comment of comments || []) {
    if (comment && comment.id) map[comment.id] = comment;
  }
  return map;
}

function normalizeMap(input, previousMap) {
  const rawMap = Array.isArray(input) ? commentsArrayToMap(input) : (input || {});
  const normalized = {};

  for (const id of Object.keys(rawMap).sort()) {
    const comment = normalizeComment(id, rawMap[id], previousMap && previousMap[id]);
    if (comment) normalized[id] = comment;
  }

  return normalized;
}

function mapToDocument(targetFile, map) {
  const paths = sidecarPaths(targetFile);
  return {
    version: VERSION,
    target: paths.target,
    updatedAt: nowIso(),
    comments: Object.keys(map).sort().map(id => map[id])
  };
}

function documentToMap(doc) {
  return commentsArrayToMap(doc && doc.comments);
}

function readJsonIfExists(targetFile) {
  const paths = sidecarPaths(targetFile);
  if (!fs.existsSync(paths.json)) return null;
  return JSON.parse(fs.readFileSync(paths.json, "utf8"));
}

function readCommentMap(targetFile) {
  return documentToMap(readJsonIfExists(targetFile));
}

function markdownFence(value, indent) {
  const text = String(value || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
  const ticks = text.match(/`+/g) || [];
  const longest = ticks.reduce((max, run) => Math.max(max, run.length), 0);
  const fence = "`".repeat(Math.max(3, longest + 1));
  const prefix = indent || "";
  const body = text.split("\n").map(line => `${prefix}${line}`).join("\n");
  return `${prefix}${fence}text\n${body}\n${prefix}${fence}\n`;
}

function renderMarkdownFromDocument(doc) {
  const comments = (doc && doc.comments ? doc.comments : []).filter(c => c && c.text);
  const openCount = comments.filter(c => c.status === "open").length;
  let out = `# ${doc.target} comments (${comments.length})\n\n`;
  out += `Updated: ${doc.updatedAt}\n\n`;
  out += `Open: ${openCount} / Resolved: ${comments.filter(c => c.status === "resolved").length} / Won't fix: ${comments.filter(c => c.status === "wontfix").length}\n`;

  if (!comments.length) return `${out}\nNo comments.\n`;

  const renderGroups = (items, level) => {
    const groups = new Map();
    for (const comment of items) {
      const group = comment.group || "Ungrouped";
      if (!groups.has(group)) groups.set(group, []);
      groups.get(group).push(comment);
    }
    for (const [group, list] of groups) {
      out += `\n${level} ${group}\n`;
      for (const c of list) {
        const status = c.status || "open";
        out += `- [${status}] **${c.label || c.id}** (${c.id}):\n`;
        out += markdownFence(c.text, "  ");
        if (c.reply && c.reply.text) {
          out += "  - Reply:\n";
          out += markdownFence(c.reply.text, "    ");
        }
      }
    }
  };

  // Files with no view-scoped comments keep the original layout.
  if (!comments.some(commentView)) {
    renderGroups(comments, "##");
    return out;
  }

  for (const bucket of groupByView(comments)) {
    out += `\n## ${viewHeading(bucket.view, bucket.items.length)}\n`;
    renderGroups(bucket.items, "###");
  }

  return out;
}

function commentView(comment) {
  return comment && typeof comment.view === "string" && comment.view ? comment.view : "";
}

function compareViews(a, b) {
  a = String(a);
  b = String(b);
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }) || (a < b ? -1 : a > b ? 1 : 0);
}

// "All views" (comments saved before views existed) first, then views in
// natural order so a deck reads #1.1, #1.2, #2.1, ... #10.1.
function groupByView(comments) {
  const buckets = new Map();
  for (const comment of comments) {
    const view = commentView(comment);
    if (!buckets.has(view)) buckets.set(view, []);
    buckets.get(view).push(comment);
  }
  return [...buckets.keys()]
    .sort((a, b) => (!a ? -1 : !b ? 1 : compareViews(a, b)))
    .map(view => ({ view, items: buckets.get(view) }));
}

function viewHeading(view, count) {
  const noun = count === 1 ? "comment" : "comments";
  return `${view ? `View: \`${view.replace(/`/g, "'")}\`` : "All views"} (${count} ${noun})`;
}

function writeSidecars(targetFile, inputMap) {
  const previousMap = readCommentMap(targetFile);
  const map = normalizeMap(inputMap, previousMap);
  const doc = mapToDocument(targetFile, map);
  const paths = sidecarPaths(targetFile);
  atomicWrite(paths.json, `${JSON.stringify(doc, null, 2)}\n`);
  atomicWrite(paths.md, renderMarkdownFromDocument(doc));
  return doc;
}

function resolveComment(targetFile, id, replyText, status) {
  const map = readCommentMap(targetFile);
  if (!map[id]) {
    throw new Error(`No comment found with id "${id}".`);
  }
  map[id] = {
    ...map[id],
    status: VALID_STATUSES.has(status) ? status : "resolved",
    updatedAt: nowIso(),
    reply: {
      text: String(replyText || "").trim(),
      at: nowIso()
    }
  };
  return writeSidecars(targetFile, map);
}

module.exports = {
  VERSION,
  VALID_STATUSES,
  VIEW_FIELDS,
  groupByView,
  sidecarPaths,
  normalizeMap,
  mapToDocument,
  readJsonIfExists,
  readCommentMap,
  renderMarkdownFromDocument,
  writeSidecars,
  resolveComment
};
