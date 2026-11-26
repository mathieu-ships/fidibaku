"use strict";

// Drives the injected review client in headless Chromium against a fixture
// deck served by `fidibaku serve`. Needs a Chromium build for playwright-core:
//   npx playwright-core install chromium-headless-shell

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { after, before, test } = require("node:test");
const { createFileServer } = require("../server/serve");

const ROOT = path.resolve(__dirname, "..");
const FIXTURE = path.join(__dirname, "fixtures", "deck.html");
fs.mkdirSync(path.join(ROOT, ".tmp"), { recursive: true });
const TMP = fs.mkdtempSync(path.join(ROOT, ".tmp", "client-"));

let browser;

before(async () => {
  const { chromium } = require("playwright-core");
  try {
    browser = await chromium.launch({ headless: true, args: ["--use-mock-keychain", "--password-store=basic"] });
  } catch (err) {
    throw new Error(`Could not launch Chromium (${err.message.split("\n")[0]}). Run: npx playwright-core install chromium-headless-shell`);
  }
});

after(async () => {
  if (browser) await browser.close();
  fs.rmSync(TMP, { recursive: true, force: true });
});

// Each test gets its own copy of the deck, its own sidecars and a fresh
// browser context (so no localStorage leaks between tests).
async function setup(t, seed, fixture) {
  const dir = fs.mkdtempSync(path.join(TMP, "case-"));
  const name = path.basename(fixture || FIXTURE);
  const file = path.join(dir, name);
  fs.copyFileSync(fixture || FIXTURE, file);
  const json = path.join(dir, name.replace(/\.html$/, ".comments.json"));
  if (seed) {
    fs.writeFileSync(json, JSON.stringify({ version: 1, target: name, updatedAt: new Date().toISOString(), comments: seed }, null, 2));
  }
  const server = createFileServer({ file });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}/?t=${encodeURIComponent(server.fidibaku.token)}`;
  const context = await browser.newContext({ viewport: { width: 1100, height: 800 } });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", err => errors.push(err.message));
  t.after(async () => {
    await context.close();
    await new Promise(resolve => server.close(resolve));
    assert.deepEqual(errors, [], "no page errors");
  });

  async function open(hash) {
    await page.goto(base + (hash || ""));
    await page.waitForSelector("#cFab");
    // The server load is async; wait until the client has merged it.
    await page.waitForFunction(() => /Autosave -> file|server unavailable/.test(document.getElementById("asStatus").textContent));
  }

  async function go(hash) {
    await page.evaluate(h => { location.hash = h; }, hash);
    await page.waitForFunction(h => location.hash === h, hash);
    await page.waitForTimeout(150);
  }

  async function comment(selector, text) {
    await page.click(selector, { button: "right" });
    await page.waitForSelector("#cPop.open");
    await page.fill("#cpopTa", text);
    await page.press("#cpopTa", "Enter");
  }

  function stored() {
    if (!fs.existsSync(json)) return [];
    return JSON.parse(fs.readFileSync(json, "utf8")).comments;
  }

  async function waitStored(count) {
    const deadline = Date.now() + 4000;
    while (Date.now() < deadline) {
      if (stored().length === count) return stored();
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert.fail(`expected ${count} stored comments, found ${stored().length}`);
  }

  function marked(selector) {
    return page.$eval(selector, el => el.classList.contains("has-review-comment"));
  }

  return { page, dir, json, open, go, comment, stored, waitStored, marked };
}

test("records the view, anchor and url with a new comment, without the session token", async t => {
  const s = await setup(t);
  await s.open("#2.2");
  await s.comment("#caption", "Caption on 2.2");
  const [c] = await s.waitStored(1);
  assert.equal(c.view, "/#2.2");
  assert.equal(c.url, "/#2.2");
  assert.match(c.anchor, /^auto:h1:/);
  assert.ok(c.id.startsWith(`${c.anchor}@`), "id is the anchor scoped by view");
  const md = fs.readFileSync(path.join(s.dir, "deck.comments.md"), "utf8");
  assert.match(md, /## View: `\/#2\.2` \(1 comment\)/);
});

test("marks a comment only on its own view, across hash navigation", async t => {
  const s = await setup(t);
  await s.open("#2.2");
  await s.comment("#caption", "Caption on 2.2");
  await s.waitStored(1);
  assert.equal(await s.marked("#caption"), true);

  await s.go("#3.1");
  assert.equal(await s.marked("#caption"), false, "not shown on 3.1");
  assert.equal(await s.page.textContent("#cCount"), "0/1");

  await s.go("#2.2");
  assert.equal(await s.marked("#caption"), true, "shown again on 2.2");
  assert.equal(await s.page.textContent("#cCount"), "1");
});

test("same element on two views gets two comments, and both survive a reload", async t => {
  const s = await setup(t);
  await s.open("#0");
  await s.go("#2.2");
  await s.comment("#caption", "Caption on 2.2");
  await s.waitStored(1);
  // Comment straight after navigating: the auto ID must follow the new text.
  await s.go("#3.1");
  await s.comment("#caption", "Caption on 3.1");
  const items = await s.waitStored(2);
  assert.deepEqual(items.map(c => c.view).sort(), ["/#2.2", "/#3.1"]);
  assert.notEqual(items[0].anchor, items[1].anchor, "anchors follow the re-rendered text");

  // A fresh load straight onto each view finds its comment.
  await s.open("#3.1");
  assert.equal(await s.marked("#caption"), true);
  assert.match(await s.page.getAttribute("#caption", "title"), /Caption on 3\.1/);
  await s.open("#2.2");
  assert.equal(await s.marked("#caption"), true);
  assert.match(await s.page.getAttribute("#caption", "title"), /Caption on 2\.2/);
});

test("comments made before views show on every view, labelled all views, and stay editable", async t => {
  const s = await setup(t, [{
    id: "deck:footer",
    group: "Deck",
    label: "Footer",
    text: "Old comment without a view",
    status: "open",
    createdAt: "2026-11-20T01:00:00.000Z",
    updatedAt: "2026-11-20T01:00:00.000Z",
    reply: null
  }]);
  await s.open("#2.2");
  assert.equal(await s.marked("footer"), true);
  await s.go("#3.1");
  assert.equal(await s.marked("footer"), true);

  await s.page.click("#cFab");
  const headings = await s.page.$$eval(".cl-view", els => els.map(el => el.textContent.trim()));
  assert.deepEqual(headings, ["All views 1"]);
  await s.page.click("#cClose");

  await s.page.click("footer", { button: "right" });
  assert.equal(await s.page.inputValue("#cpopTa"), "Old comment without a view");
  await s.page.fill("#cpopTa", "Old comment, edited");
  await s.page.press("#cpopTa", "Enter");
  await s.page.waitForTimeout(700);
  const [c] = s.stored();
  assert.equal(c.id, "deck:footer");
  assert.equal(c.text, "Old comment, edited");
  assert.equal(c.view, undefined, "still shown on all views");
});

test("the list groups comments by view with counts, and clicking one navigates to its view", async t => {
  const s = await setup(t);
  await s.open("#2.2");
  await s.comment("#caption", "Caption on 2.2");
  await s.waitStored(1);
  await s.comment("#takeaway", "Takeaway on 2.2");
  await s.waitStored(2);
  await s.go("#3.1");
  await s.comment("#caption", "Caption on 3.1");
  await s.waitStored(3);

  await s.go("#4.1");
  await s.page.click("#cFab");
  const headings = await s.page.$$eval(".cl-view", els => els.map(el => el.textContent.trim()));
  assert.deepEqual(headings, ["/#2.2 2", "/#3.1 1"]);

  await s.page.click(".cl-item:has-text('Caption on 2.2') .cl-txt");
  await s.page.waitForFunction(() => location.hash === "#2.2");
  await s.page.waitForSelector("#caption.review-flash");
  assert.equal(await s.marked("#caption"), true);
  assert.equal(await s.page.isVisible("#cModal"), false, "panel closes to show the element");
});

test("pushState routes are views too, and the list navigates back to them", async t => {
  const s = await setup(t);
  await s.open();
  await s.page.evaluate(() => window.goPath("/list/2"));
  await s.comment("#caption", "Caption on list two");
  const [c] = await s.waitStored(1);
  assert.equal(c.view, "/list/2");

  await s.page.evaluate(() => window.goPath("/list/3"));
  await s.page.waitForTimeout(150);
  assert.equal(await s.marked("#caption"), false, "pushState re-evaluates");

  await s.page.evaluate(() => history.replaceState(null, "", "/list/2" + location.search));
  await s.page.waitForTimeout(150);
  assert.equal(await s.page.textContent("#cCount"), "1", "replaceState re-evaluates");
  await s.page.evaluate(() => window.goPath("/list/3"));

  await s.page.click("#cFab");
  await s.page.click(".cl-item:has-text('Caption on list two') .cl-txt");
  await s.page.waitForFunction(() => location.pathname === "/list/2");
  await s.page.waitForSelector("#caption.review-flash");
  assert.match(await s.page.textContent("#caption"), /list route two/);
});

test("pages can name their views with window.fidibakuView, a data attribute or a meta tag", async t => {
  const s = await setup(t);
  await s.open("#2.2");

  await s.page.evaluate(() => {
    const meta = document.createElement("meta");
    meta.name = "fidibaku-view";
    meta.content = "meta-view";
    document.head.appendChild(meta);
  });
  await s.comment("#caption", "Under the meta view");
  assert.equal((await s.waitStored(1))[0].view, "meta-view");

  await s.page.evaluate(() => { document.documentElement.dataset.fidibakuView = "data-view"; });
  await s.page.waitForTimeout(400);
  assert.equal(await s.marked("#caption"), false, "data attribute beats meta, and is picked up in place");
  await s.comment("#takeaway", "Under the data view");
  assert.equal((await s.waitStored(2)).find(c => c.text === "Under the data view").view, "data-view");

  await s.page.evaluate(() => {
    window.fidibakuView = () => "fn-" + location.hash.slice(1);
    window.dispatchEvent(new Event("fidibaku:viewchange"));
  });
  await s.page.waitForTimeout(150);
  assert.equal(await s.marked("#takeaway"), false, "window.fidibakuView beats the data attribute");
  await s.comment("#caption", "Under the function view");
  const fnComment = (await s.waitStored(3)).find(c => c.text === "Under the function view");
  assert.equal(fnComment.view, "fn-2.2");
  assert.equal(fnComment.url, "/#2.2", "url still records where it was made");

  await s.page.evaluate(() => { window.fidibakuView = "string-view"; window.dispatchEvent(new Event("fidibaku:viewchange")); });
  await s.page.waitForTimeout(150);
  assert.equal(await s.marked("#caption"), false);
  await s.page.evaluate(() => { delete window.fidibakuView; delete document.documentElement.dataset.fidibakuView; });
  await s.page.waitForTimeout(400);
  assert.equal(await s.marked("#caption"), true, "back on the meta view");
});

test("every kind of part takes a comment: cells, pictures, figures, charts, code, cards, links and buttons", async t => {
  const s = await setup(t, null, path.join(__dirname, "fixtures", "parts.html"));
  await s.open();
  // Where each right-click lands, and the part it must open the box on (tag and label).
  const cases = [
    ["#para", "p", /^Six criteria/],
    ["#inline-link", "p", /^Six criteria/],
    ["#item", "li", /^A\. Outcome/],
    ["#cell-a1", "td", "Hand sawing · A: 2"],
    ["#cell-b2", "td", "Tomato slicing · B: 0"],
    ["#scores th:nth-child(2)", "th", "Task"],
    ["#bare-img", "img", /^data:image|^Picture$|svg/],
    ["#fig-img", "figure", "The bench from above"],
    ["#bar", "svg", "Cuts per hour"],
    ["#canvas", "canvas", "Chart"],
    ["#code-in-pre", "pre", "node --test test/*.test.js"],
    ["#command", "code", "compare_frames overhead.png left.png"],
    ["#inline-code", "p", /^Run npm test/],
    ["#card b", "div", "December kit"],
    ["#button", "button", "Open the review"],
    ["#lone-button", "button", "Open the bench picture"],
    ["#bar-a", "div", "Drawing"],
    ["#custom", "model-thing", "model thing"],
    ["#video", "video", "Video"]
  ];
  for (const [selector, tag, label] of cases) {
    await s.page.click(selector, { button: "right" });
    await s.page.waitForSelector("#cPop.open");
    const at = await s.page.textContent("#cpopLabel");
    const shown = at.split(" · ").slice(1).join(" · ") || at;
    if (label instanceof RegExp) assert.match(shown, label, `${selector}: label`);
    else assert.equal(shown, label, `${selector}: label`);
    await s.page.fill("#cpopTa", `on ${selector}`);
    await s.page.press("#cpopTa", "Enter");
    const marked = await s.page.$$eval(".has-review-comment", els => els.map(el => el.tagName.toLowerCase()));
    assert.ok(marked.includes(tag), `${selector}: a ${tag} is marked (${marked.join(", ")})`);
  }
  // The link sits in the paragraph, so its right-click edits the paragraph's comment: one fewer than the cases.
  const items = await s.waitStored(cases.length - 1);
  assert.ok(items.some(c => c.text === "on #inline-link" && /^auto:p:/.test(c.anchor)), "the link's comment is the paragraph's");
  assert.ok(items.some(c => c.text === "on #fig-img" && /^auto:figure:/.test(c.anchor)), "the picture's comment is its figure's");
  assert.ok(items.some(c => c.text === "on #cell-a1" && c.label === "Hand sawing · A: 2"), "a cell is named by its row and column");
});

test("on a multi-page site, clicking a comment from another page loads that page and highlights it", async t => {
  const http = require("node:http");
  const { createProxyServer } = require("../server/serve");
  const pages = {
    "/a": "<!doctype html><html><head><title>A</title></head><body><main><h1>Page A heading</h1><p>Some text on page A for reviewers</p></main></body></html>",
    "/b": "<!doctype html><html><head><title>B</title></head><body><main><h1>Page B heading</h1><p>Some text on page B for reviewers</p></main></body></html>"
  };
  const upstream = http.createServer((req, res) => {
    const body = pages[new URL(req.url, "http://x").pathname];
    res.writeHead(body ? 200 : 404, { "Content-Type": "text/html; charset=utf-8" });
    res.end(body || "not found");
  });
  await new Promise(resolve => upstream.listen(0, "127.0.0.1", resolve));
  const dir = fs.mkdtempSync(path.join(TMP, "mpa-"));
  const proxy = createProxyServer({ url: `http://127.0.0.1:${upstream.address().port}/a`, comments: path.join(dir, "site.html") });
  await new Promise(resolve => proxy.listen(0, "127.0.0.1", resolve));
  const context = await browser.newContext();
  const page = await context.newPage();
  t.after(async () => {
    await context.close();
    await new Promise(resolve => proxy.close(resolve));
    await new Promise(resolve => upstream.close(resolve));
  });
  const origin = `http://127.0.0.1:${proxy.address().port}`;
  const token = `?t=${encodeURIComponent(proxy.fidibaku.token)}`;
  const ready = () => page.waitForFunction(() => /Autosave -> file/.test(document.getElementById("asStatus").textContent));

  await page.goto(`${origin}/b${token}`);
  await ready();
  await page.click("h1", { button: "right" });
  await page.fill("#cpopTa", "Heading on page B");
  await page.press("#cpopTa", "Enter");
  await page.waitForTimeout(700);
  const [c] = JSON.parse(fs.readFileSync(path.join(dir, "site.comments.json"), "utf8")).comments;
  assert.equal(c.view, "/b", "token stripped from the view");

  await page.goto(`${origin}/a${token}`);
  await ready();
  assert.equal(await page.$eval("h1", el => el.classList.contains("has-review-comment")), false);
  await page.click("#cFab");
  await page.click(".cl-item:has-text('Heading on page B') .cl-txt");
  await page.waitForURL(url => new URL(url).pathname === "/b", { timeout: 5000 });
  await page.waitForSelector("h1.review-flash", { timeout: 5000 });
  assert.match(page.url(), /[?&]t=/, "keeps the session token");
});
