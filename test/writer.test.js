"use strict";

const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { after, test } = require("node:test");
const {
  normalizeMap,
  readCommentMap,
  renderMarkdownFromDocument,
  resolveComment,
  sidecarPaths,
  writeSidecars
} = require("../server/writer");

const ROOT = path.resolve(__dirname, "..");
const CLI = path.join(ROOT, "cli", "index.js");
fs.mkdirSync(path.join(ROOT, ".tmp"), { recursive: true });
const TMP = fs.mkdtempSync(path.join(ROOT, ".tmp", "writer-"));
after(() => fs.rmSync(TMP, { recursive: true, force: true }));

function page(name) {
  const file = path.join(TMP, name);
  fs.writeFileSync(file, "<!doctype html><title>t</title><p>Hello there reviewers</p>");
  return file;
}

const legacy = {
  id: "deck:footer",
  group: "Deck",
  label: "Footer",
  text: "Legacy comment with no view",
  status: "open",
  createdAt: "2026-11-20T01:00:00.000Z",
  updatedAt: "2026-11-20T01:00:00.000Z",
  reply: null
};

function scoped(anchor, view, text) {
  return {
    id: `${anchor}@${view}`,
    anchor,
    view,
    url: view,
    group: "Slides",
    label: `Caption ${view}`,
    text,
    status: "open",
    createdAt: "2026-11-20T01:00:00.000Z",
    updatedAt: "2026-11-20T01:00:00.000Z",
    reply: null
  };
}

test("normalize keeps view, anchor and url, and adds nothing to legacy comments", () => {
  const map = normalizeMap({
    "deck:footer": legacy,
    "auto:h1:x@a": scoped("auto:h1:x", "/#2.2", "Scoped")
  });
  assert.equal(map["deck:footer"].view, undefined);
  assert.equal(map["deck:footer"].anchor, undefined);
  assert.equal(map["deck:footer"].url, undefined);
  assert.equal(map["auto:h1:x@a"].view, "/#2.2");
  assert.equal(map["auto:h1:x@a"].anchor, "auto:h1:x");
  assert.equal(map["auto:h1:x@a"].url, "/#2.2");
});

test("an update without view fields keeps the stored view (older clients)", () => {
  const file = page("keep-view.html");
  writeSidecars(file, { "a@1": scoped("a", "/#2.2", "First") });
  writeSidecars(file, { "a@1": { text: "Edited by an older client", group: "Slides", label: "Caption" } });
  const stored = readCommentMap(file)["a@1"];
  assert.equal(stored.text, "Edited by an older client");
  assert.equal(stored.view, "/#2.2");
  assert.equal(stored.anchor, "a");
});

test("markdown without view-scoped comments keeps the original layout", () => {
  const md = renderMarkdownFromDocument({ target: "deck.html", updatedAt: "now", comments: [legacy] });
  assert.match(md, /\n## Deck\n- \[open\] \*\*Footer\*\* \(deck:footer\):\n/);
  assert.doesNotMatch(md, /View:|All views/);
});

test("markdown groups comments under a heading per view with counts, in natural order", () => {
  const md = renderMarkdownFromDocument({
    target: "deck.html",
    updatedAt: "now",
    comments: [
      scoped("auto:h1:x", "/#10.1", "Ten"),
      scoped("auto:h1:x", "/#2.2", "Two"),
      scoped("auto:p:y", "/#2.2", "Two again"),
      legacy
    ]
  });
  const headings = md.split("\n").filter(line => line.startsWith("## "));
  assert.deepEqual(headings, [
    "## All views (1 comment)",
    "## View: `/#2.2` (2 comments)",
    "## View: `/#10.1` (1 comment)"
  ]);
  assert.match(md, /## View: `\/#2\.2` \(2 comments\)\n\n### Slides\n- \[open\] \*\*Caption \/#2\.2\*\*/);
  assert.match(md, /## All views \(1 comment\)\n\n### Deck\n/);
});

test("resolve keeps the view and writes view headings", () => {
  const file = page("resolve.html");
  writeSidecars(file, { "a@1": scoped("a", "/#3.1", "Fix this") });
  const doc = resolveComment(file, "a@1", "Done", "resolved");
  assert.equal(doc.comments[0].status, "resolved");
  assert.equal(doc.comments[0].view, "/#3.1");
  assert.equal(doc.comments[0].anchor, "a");
  const md = fs.readFileSync(sidecarPaths(file).md, "utf8");
  assert.match(md, /## View: `\/#3\.1` \(1 comment\)/);
});

test("sidecarPaths accepts the sidecar file itself", () => {
  const base = path.join(TMP, "copy");
  for (const input of [`${base}.html`, `${base}.comments.json`, `${base}.comments.md`]) {
    const paths = sidecarPaths(input);
    assert.equal(paths.json, `${base}.comments.json`);
    assert.equal(paths.md, `${base}.comments.md`);
    assert.equal(paths.target, "copy.html");
  }
});

test("export and resolve CLI work on view-scoped comments via --comments", () => {
  const file = page("cli.html");
  const copy = path.join(TMP, "elsewhere", "copy.comments.json");
  writeSidecars(copy, { "a@1": scoped("a", "/#2.2", "Via the copy") });

  const md = execFileSync(process.execPath, [CLI, "export", file, "--comments", copy], { encoding: "utf8" });
  assert.match(md, /## View: `\/#2\.2` \(1 comment\)/);
  assert.match(md, /Via the copy/);

  const json = JSON.parse(execFileSync(process.execPath, [CLI, "export", file, "--json", "--comments", copy], { encoding: "utf8" }));
  assert.equal(json.comments[0].view, "/#2.2");

  execFileSync(process.execPath, [CLI, "resolve", file, "--comments", copy, "--id", "a@1", "--reply", "Done"], { encoding: "utf8" });
  const stored = JSON.parse(fs.readFileSync(copy, "utf8")).comments[0];
  assert.equal(stored.status, "resolved");
  assert.equal(stored.view, "/#2.2");
  assert.equal(fs.existsSync(sidecarPaths(file).json), false, "the page's own sidecar is untouched");
});
