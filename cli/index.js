#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { CLIENT_JS, CLIENT_CSS, attach, proxy, serve, urlSidecarTarget } = require("../server/serve");
const {
  mapToDocument,
  readCommentMap,
  renderMarkdownFromDocument,
  resolveComment,
  sidecarPaths
} = require("../server/writer");

function usage(exitCode) {
  const out = exitCode ? process.stderr : process.stdout;
  out.write(`fidibaku

Drop-in right-click commenting for websites, landing pages, slides, runbooks,
local HTML reports, and localhost apps.
Comments autosave to sidecar files so an AI agent or teammate can read and
act on review feedback without losing where each comment was anchored.

Quick start:
  fidibaku review report.html
  fidibaku runbook
  fidibaku attach http://localhost:3000

What happens:
  1. Fidibaku opens a localhost review URL or attaches to your local app.
  2. Right-click the page to add comments. Enter posts, Shift+Enter adds a paragraph.
  3. Comments write to <target>.comments.json and <target>.comments.md.
  4. Agents can read the Markdown/JSON and resolve items with fidibaku resolve.

Important:
  Use Fidibaku for the comment mechanism. Do not rebuild comment popovers,
  sidecar writing, or browser persistence from example HTML. The runbook
  command is a content/layout example for larger review artifacts.

Common workflows:
  Static HTML file      fidibaku review report.html
  Website or slides     fidibaku review deck.html
  Runbook template      fidibaku runbook
  Existing localhost   fidibaku attach http://localhost:3000
  No app changes       fidibaku proxy http://localhost:3000
  Export comments      fidibaku export report.html
  Resolve feedback     fidibaku resolve report.html --id <id> --reply "Done"

Usage:
  fidibaku attach <localhost-url> [--port <port>] [--open] [--no-open] [--no-token] [--comments <sidecar-base.html>]
  fidibaku runbook [output.html] [-o <output.html>] [--copy-only] [--force] [--port <port>] [--no-open] [--no-token]
  fidibaku example runbook [output.html] [-o <output.html>] [--copy-only] [--force] [--port <port>] [--no-open] [--no-token]
  fidibaku review <file.html|localhost-url> [--port <port>] [--no-open] [--no-token] [--comments <sidecar-base.html>]
  fidibaku serve <file.html> [--port <port>] [--open] [--no-open] [--no-token]
  fidibaku proxy <localhost-url> [--port <port>] [--open] [--no-open] [--no-token] [--comments <sidecar-base.html>]
  fidibaku bundle <file.html> [-o <out.html>]
  fidibaku export <file.html|localhost-url> [--json] [--comments <sidecar-base.html>]
  fidibaku resolve <file.html|localhost-url> --id <id> --reply <text> [--status open|resolved|wontfix] [--comments <sidecar-base.html>]

Docs:
  https://github.com/mathieu-ships/fidibaku
  https://www.npmjs.com/package/fidibaku

`);
  process.exit(exitCode);
}

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--port") args.port = argv[++i];
    else if (arg === "--open") args.open = true;
    else if (arg === "--no-open") args.open = false;
    else if (arg === "--no-token") args.noToken = true;
    else if (arg === "--comments") args.comments = argv[++i];
    else if (arg === "-o" || arg === "--output") args.output = argv[++i];
    else if (arg === "--copy-only") args.copyOnly = true;
    else if (arg === "--force") args.force = true;
    else if (arg === "--json") args.json = true;
    else if (arg === "--id") args.id = argv[++i];
    else if (arg === "--reply") args.reply = argv[++i];
    else if (arg === "--status") args.status = argv[++i];
    else if (arg === "-h" || arg === "--help") usage(0);
    else args._.push(arg);
  }
  return args;
}

function isHttpUrl(value) {
  if (!/^https?:\/\//i.test(String(value || ""))) return false;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function requireFile(file) {
  if (!file) usage(1);
  const resolved = path.resolve(file);
  if (!fs.existsSync(resolved)) throw new Error(`File not found: ${resolved}`);
  if (!/\.html?$/i.test(resolved)) throw new Error("Expected an .html file.");
  return resolved;
}

function requireCommentTarget(value, commentsPath) {
  if (isHttpUrl(value)) return path.resolve(commentsPath || urlSidecarTarget(value, process.cwd()));
  return requireFile(value);
}

function inlineBundle(file, output) {
  const html = fs.readFileSync(file, "utf8");
  const css = fs.readFileSync(CLIENT_CSS, "utf8");
  const js = fs.readFileSync(CLIENT_JS, "utf8");
  if (html.includes("fidibaku:bundled")) {
    throw new Error("This file already appears to contain a fidibaku bundle.");
  }
  const block = [
    "<!-- fidibaku:bundled -->",
    "<style>",
    css,
    "</style>",
    "<script>",
    js,
    "</script>"
  ].join("\n");
  const bundled = /<\/body>/i.test(html) ? html.replace(/<\/body>/i, `${block}\n</body>`) : `${html}\n${block}\n`;
  fs.writeFileSync(output, bundled);
  process.stdout.write(`${output}\n`);
}

function ensureHtmlOutput(value) {
  const output = path.resolve(value || "fidibaku-runbook.html");
  if (!/\.html?$/i.test(output)) throw new Error("Expected an .html output path.");
  return output;
}

function copyDirectory(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDirectory(from, to);
    else if (entry.isFile()) fs.copyFileSync(from, to);
  }
}

function scaffoldRunbook(outputValue, options) {
  const output = ensureHtmlOutput(outputValue);
  const supportDir = output.replace(/\.html?$/i, "");
  const supportName = path.basename(supportDir);
  const sourceHtml = path.join(__dirname, "..", "examples", "runbook.html");
  const sourceSupportDir = path.join(__dirname, "..", "examples", "runbook");

  if (!fs.existsSync(sourceHtml) || !fs.existsSync(sourceSupportDir)) {
    throw new Error("Packaged runbook example is missing.");
  }
  if (!options.force && (fs.existsSync(output) || fs.existsSync(supportDir))) {
    throw new Error(`Refusing to overwrite ${output} or ${supportDir}. Pass --force or choose another output path.`);
  }
  if (options.force) {
    fs.rmSync(output, { force: true });
    fs.rmSync(supportDir, { recursive: true, force: true });
  }

  fs.mkdirSync(path.dirname(output), { recursive: true });
  let html = fs.readFileSync(sourceHtml, "utf8");
  html = html.replace(/href="runbook\/briefs\//g, `href="${supportName}/briefs/`);
  fs.writeFileSync(output, html);
  copyDirectory(sourceSupportDir, supportDir);
  const readmePath = path.join(supportDir, "README.md");
  if (fs.existsSync(readmePath)) {
    const outputName = path.basename(output);
    const sidecarBase = outputName.replace(/\.html?$/i, "");
    let readme = fs.readFileSync(readmePath, "utf8");
    readme = readme
      .replace(/\.\.\/runbook\.html/g, `../${outputName}`)
      .replace(/examples\/runbook\.comments/g, `${sidecarBase}.comments`);
    fs.writeFileSync(readmePath, readme);
  }
  process.stdout.write(`Created ${output}\nCreated ${supportDir}\n`);
  return output;
}

function exportComments(file, asJson) {
  const map = readCommentMap(file);
  const doc = mapToDocument(file, map);
  if (asJson) process.stdout.write(`${JSON.stringify(doc, null, 2)}\n`);
  else process.stdout.write(renderMarkdownFromDocument(doc));
}

function main() {
  const [command, ...rest] = process.argv.slice(2);
  if (!command) usage(0);
  if (command === "-h" || command === "--help" || command === "help") usage(0);
  const args = parseArgs(rest);

  if (command === "runbook" || command === "example") {
    if (command === "example" && args._[0] !== "runbook") usage(1);
    const outputArg = args.output || (command === "example" ? args._[1] : args._[0]);
    const file = scaffoldRunbook(outputArg, { force: !!args.force });
    if (!args.copyOnly) {
      serve({
        file,
        port: args.port,
        open: args.open === undefined ? true : args.open,
        noToken: !!args.noToken
      });
    }
    return;
  }

  if (command === "serve") {
    const file = requireFile(args._[0]);
    serve({
      file,
      port: args.port,
      open: args.open === undefined ? true : args.open,
      noToken: !!args.noToken
    });
    return;
  }

  if (command === "attach") {
    const url = args._[0];
    if (!isHttpUrl(url)) throw new Error("attach requires a localhost http(s) URL.");
    attach({
      url,
      comments: args.comments,
      cwd: process.cwd(),
      port: args.port,
      open: args.open === undefined ? true : args.open,
      noToken: !!args.noToken
    });
    return;
  }

  if (command === "proxy") {
    const url = args._[0];
    if (!isHttpUrl(url)) throw new Error("proxy requires a localhost http(s) URL.");
    proxy({
      url,
      comments: args.comments,
      cwd: process.cwd(),
      port: args.port,
      open: args.open === undefined ? true : args.open,
      noToken: !!args.noToken
    });
    return;
  }

  if (command === "review") {
    const target = args._[0];
    if (!target) usage(1);
    if (isHttpUrl(target)) {
      proxy({
        url: target,
        comments: args.comments,
        cwd: process.cwd(),
        port: args.port,
        open: args.open === undefined ? true : args.open,
        noToken: !!args.noToken
      });
      return;
    }
    serve({
      file: requireFile(target),
      port: args.port,
      open: args.open === undefined ? true : args.open,
      noToken: !!args.noToken
    });
    return;
  }

  if (command === "bundle") {
    const file = requireFile(args._[0]);
    const output = path.resolve(args.output || file.replace(/\.html?$/i, ".review.html"));
    inlineBundle(file, output);
    return;
  }

  if (command === "export") {
    const file = requireCommentTarget(args._[0], args.comments);
    exportComments(file, !!args.json);
    return;
  }

  if (command === "resolve") {
    const file = requireCommentTarget(args._[0], args.comments);
    if (!args.id || !args.reply) throw new Error("resolve requires --id and --reply.");
    const doc = resolveComment(file, args.id, args.reply, args.status || "resolved");
    const paths = sidecarPaths(file);
    process.stdout.write(`Resolved ${args.id}\n${paths.json}\n${paths.md}\n`);
    process.stdout.write(renderMarkdownFromDocument(doc));
    return;
  }

  usage(1);
}

try {
  main();
} catch (err) {
  process.stderr.write(`fidibaku: ${err.message}\n`);
  process.exit(1);
}
