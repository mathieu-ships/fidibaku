"use strict";

const fs = require("fs");
const http = require("http");
const https = require("https");
const path = require("path");
const { spawn } = require("child_process");
const { createToken, requireToken, safeJoin } = require("./security");
const { mapToDocument, readCommentMap, sidecarPaths, writeSidecars } = require("./writer");

const ROOT = path.resolve(__dirname, "..");
const CLIENT_JS = path.join(ROOT, "client", "review.js");
const CLIENT_CSS = path.join(ROOT, "client", "review.css");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8"
};

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", chunk => {
      body += chunk;
      if (body.length > 2_000_000) {
        reject(new Error("Request body too large."));
        req.destroy();
      }
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

function sendJson(res, status, value) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(`${JSON.stringify(value, null, 2)}\n`);
}

function sendText(res, status, text) {
  res.writeHead(status, {
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(text);
}

function applyCors(req, res, allowedOrigin) {
  if (!allowedOrigin) return true;
  const origin = req.headers.origin;
  if (origin && origin !== allowedOrigin) return false;
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Origin", allowedOrigin);
  res.setHeader("Access-Control-Allow-Methods", "GET, PUT, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Review-Token");
  res.setHeader("Access-Control-Max-Age", "600");
  return true;
}

function stripReviewToken(url, token) {
  const next = new URL(url.toString());
  if (token && next.searchParams.get("t") === token) next.searchParams.delete("t");
  return next;
}

function injectHtml(html, options) {
  if (html.includes("fidibaku:injected")) return html;

  const cssHref = `/__review/client/review.css?t=${encodeURIComponent(options.token)}`;
  const bootstrapSrc = `/__review/client/bootstrap.js?t=${encodeURIComponent(options.token)}`;
  const jsSrc = `/__review/client/review.js?t=${encodeURIComponent(options.token)}`;
  const bootstrap = [
    "<!-- fidibaku:injected -->",
    `<link rel="stylesheet" href="${cssHref}">`,
    `<script defer src="${bootstrapSrc}"></script>`,
    `<script defer src="${jsSrc}"></script>`
  ].join("\n");

  if (/<\/head>/i.test(html)) return html.replace(/<\/head>/i, `${bootstrap}\n</head>`);
  return `${bootstrap}\n${html}`;
}

function openBrowser(url) {
  const platform = process.platform;
  const command = platform === "darwin" ? "open" : platform === "win32" ? "cmd" : "xdg-open";
  const args = platform === "win32" ? ["/c", "start", "", url] : [url];
  const child = spawn(command, args, { detached: true, stdio: "ignore" });
  child.unref();
}

function isLoopbackHost(hostname) {
  const host = String(hostname || "").toLowerCase();
  return host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]";
}

function assertLoopbackUrl(value, mode) {
  const parsed = new URL(value);
  if (!/^https?:$/.test(parsed.protocol)) throw new Error(`${mode} expects an http(s) URL.`);
  if (!isLoopbackHost(parsed.hostname)) throw new Error(`${mode} only supports localhost or loopback URLs.`);
  return parsed;
}

function urlSidecarTarget(upstreamUrl, cwd) {
  const parsed = new URL(upstreamUrl);
  const host = parsed.host.replace(/[^a-zA-Z0-9._-]+/g, "-");
  const pathPart = parsed.pathname.replace(/\/+$/g, "").replace(/^\/+/g, "") || "index";
  const slug = `${host}-${pathPart}`.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/-+/g, "-").slice(0, 80);
  return path.join(cwd || process.cwd(), `${slug || "localhost"}.html`);
}

function attachStatePath(cwd) {
  return path.join(cwd || process.cwd(), ".fidibaku", "attach.json");
}

function writeAttachState(cwd, state) {
  const file = attachStatePath(cwd);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(state, null, 2)}\n`);
  return file;
}

function scriptTag(src) {
  return `<script defer src="${String(src).replace(/&/g, "&amp;").replace(/"/g, "&quot;")}"></script>`;
}

function bookmarklet(src) {
  return "javascript:(()=>{var s=document.createElement('script');s.src=" +
    JSON.stringify(src) +
    ";s.defer=true;document.head.appendChild(s)})()";
}

function attachScript(base, token, targetName) {
  return [
    "(function(){",
    "if(window.__FIDIBAKU_ATTACHED__)return;",
    "window.__FIDIBAKU_ATTACHED__=true;",
    "var base=" + JSON.stringify(base) + ";",
    "var token=" + JSON.stringify(token) + ";",
    "window.__REVIEW_SERVER__={base:base,token:token,target:" + JSON.stringify(targetName) + "};",
    "var css=document.createElement('link');",
    "css.rel='stylesheet';",
    "css.href=base+'/__review/client/review.css?t='+encodeURIComponent(token);",
    "document.head.appendChild(css);",
    "var js=document.createElement('script');",
    "js.defer=true;",
    "js.src=base+'/__review/client/review.js?t='+encodeURIComponent(token);",
    "document.head.appendChild(js);",
    "})();",
    ""
  ].join("\n");
}

function createReviewServer(options) {
  const targetFile = path.resolve(options.targetFile);
  const targetDir = options.targetDir ? path.resolve(options.targetDir) : path.dirname(targetFile);
  const targetName = options.targetName || path.basename(targetFile);
  const token = options.noToken ? "" : (options.token || createToken());

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://127.0.0.1");

      if (url.pathname.startsWith("/__review/")) {
        if (!applyCors(req, res, options.allowedOrigin)) {
          sendJson(res, 403, { ok: false, error: "Origin is not allowed for this review server." });
          return;
        }

        if (req.method === "OPTIONS") {
          res.writeHead(204, { "Cache-Control": "no-store" });
          res.end();
          return;
        }

        if (!requireToken(req, url, token, options.noToken)) {
          sendJson(res, 403, { ok: false, error: "Invalid review token." });
          return;
        }

        if (url.pathname === "/__review/health") {
          sendJson(res, 200, { ok: true, target: targetName, dir: targetDir });
          return;
        }

        if (url.pathname === "/__review/attach.js") {
          const host = req.headers.host || "127.0.0.1";
          const base = `http://${host}`;
          res.writeHead(200, { "Content-Type": MIME[".js"], "Cache-Control": "no-store" });
          res.end(attachScript(base, token, targetName));
          return;
        }

        if (url.pathname === "/__review/client/bootstrap.js") {
          res.writeHead(200, { "Content-Type": MIME[".js"], "Cache-Control": "no-store" });
          res.end(`window.__REVIEW_SERVER__ = ${JSON.stringify({ base: "", token, target: targetName })};\n`);
          return;
        }

        if (url.pathname === "/__review/client/review.js") {
          res.writeHead(200, { "Content-Type": MIME[".js"], "Cache-Control": "no-store" });
          res.end(fs.readFileSync(CLIENT_JS));
          return;
        }

        if (url.pathname === "/__review/client/review.css") {
          res.writeHead(200, { "Content-Type": MIME[".css"], "Cache-Control": "no-store" });
          res.end(fs.readFileSync(CLIENT_CSS));
          return;
        }

        if (url.pathname === "/__review/comments" && req.method === "GET") {
          sendJson(res, 200, mapToDocument(targetFile, readCommentMap(targetFile)));
          return;
        }

        if (url.pathname === "/__review/comments" && req.method === "PUT") {
          const payload = JSON.parse(await readBody(req) || "{}");
          const map = Array.isArray(payload.comments) ? payload.comments : payload;
          const doc = writeSidecars(targetFile, map);
          sendJson(res, 200, { ok: true, ...doc });
          return;
        }

        sendJson(res, 404, { ok: false, error: "Unknown review endpoint." });
        return;
      }

      await options.handlePage(req, res, url, { targetFile, targetDir, targetName, token });
    } catch (err) {
      sendJson(res, 500, { ok: false, error: err.message });
    }
  });

  server.fidibaku = {
    targetFile,
    targetDir,
    targetName,
    token,
    sidecars: sidecarPaths(targetFile)
  };

  return server;
}

function createFileServer(options) {
  const targetFile = path.resolve(options.file);
  const targetDir = path.dirname(targetFile);
  const targetName = path.basename(targetFile);

  if (!fs.existsSync(targetFile)) throw new Error(`File not found: ${targetFile}`);
  if (!/\.html?$/i.test(targetFile)) throw new Error("serve expects an .html file.");

  return createReviewServer({
    ...options,
    targetFile,
    targetDir,
    targetName,
    handlePage: async (req, res, url, context) => {
      let filePath = url.pathname === "/" ? targetFile : safeJoin(targetDir, url.pathname);
      if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
        filePath = path.join(filePath, "index.html");
      }
      if (!fs.existsSync(filePath)) {
        sendText(res, 404, "Not found\n");
        return;
      }

      const stat = fs.statSync(filePath);
      if (!stat.isFile()) {
        sendText(res, 403, "Forbidden\n");
        return;
      }

      const ext = path.extname(filePath).toLowerCase();
      if (path.resolve(filePath) === targetFile && /\.html?$/i.test(filePath)) {
        const html = fs.readFileSync(filePath, "utf8");
        res.writeHead(200, { "Content-Type": MIME[ext], "Cache-Control": "no-store" });
        res.end(injectHtml(html, context));
        return;
      }

      res.writeHead(200, {
        "Content-Type": MIME[ext] || "application/octet-stream",
        "Cache-Control": "no-store"
      });
      fs.createReadStream(filePath).pipe(res);
    }
  });
}

function filterProxyResponseHeaders(headers, isHtml, upstreamUrl, wrapperOrigin) {
  const next = { ...headers };
  delete next["content-length"];
  delete next["content-security-policy"];
  delete next["content-security-policy-report-only"];
  delete next["x-frame-options"];
  next["cache-control"] = "no-store";
  if (isHtml) next["content-type"] = MIME[".html"];
  if (next.location && upstreamUrl && wrapperOrigin) {
    try {
      const locationUrl = new URL(next.location, upstreamUrl);
      if (locationUrl.origin === upstreamUrl.origin) {
        locationUrl.protocol = wrapperOrigin.protocol;
        locationUrl.host = wrapperOrigin.host;
        next.location = locationUrl.toString();
      }
    } catch {
      // Leave malformed Location headers untouched.
    }
  }
  return next;
}

function pipeProxyRequest(clientReq, clientRes, upstreamUrl, context) {
  return new Promise((resolve, reject) => {
    const targetUrl = stripReviewToken(new URL(clientReq.url, upstreamUrl), context.token);
    targetUrl.protocol = upstreamUrl.protocol;
    targetUrl.host = upstreamUrl.host;

    const transport = targetUrl.protocol === "https:" ? https : http;
    const headers = { ...clientReq.headers, host: targetUrl.host };
    delete headers.connection;
    delete headers["keep-alive"];
    delete headers["proxy-authenticate"];
    delete headers["proxy-authorization"];
    delete headers.te;
    delete headers.trailer;
    delete headers["transfer-encoding"];
    delete headers.upgrade;

    const upstreamReq = transport.request(targetUrl, { method: clientReq.method, headers }, upstreamRes => {
      const contentType = String(upstreamRes.headers["content-type"] || "");
      const isHtml = /\btext\/html\b/i.test(contentType);
      const status = upstreamRes.statusCode || 502;
      const wrapperOrigin = new URL(`http://${clientReq.headers.host || "127.0.0.1"}`);

      if (!isHtml || clientReq.method === "HEAD") {
        clientRes.writeHead(status, filterProxyResponseHeaders(upstreamRes.headers, false, upstreamUrl, wrapperOrigin));
        upstreamRes.pipe(clientRes);
        upstreamRes.on("end", resolve);
        upstreamRes.on("error", reject);
        return;
      }

      const chunks = [];
      let total = 0;
      upstreamRes.on("data", chunk => {
        total += chunk.length;
        if (total > 10_000_000) {
          upstreamReq.destroy(new Error("HTML response too large to inject."));
          return;
        }
        chunks.push(chunk);
      });
      upstreamRes.on("end", () => {
        const html = Buffer.concat(chunks).toString("utf8");
        clientRes.writeHead(status, filterProxyResponseHeaders(upstreamRes.headers, true, upstreamUrl, wrapperOrigin));
        clientRes.end(injectHtml(html, context));
        resolve();
      });
      upstreamRes.on("error", reject);
    });

    upstreamReq.on("error", reject);
    clientReq.pipe(upstreamReq);
  });
}

function createProxyServer(options) {
  const upstreamUrl = assertLoopbackUrl(options.url, "proxy");

  const sidecarTarget = path.resolve(options.comments || urlSidecarTarget(upstreamUrl, options.cwd));
  const targetName = path.basename(sidecarTarget);

  return createReviewServer({
    ...options,
    targetFile: sidecarTarget,
    targetDir: path.dirname(sidecarTarget),
    targetName,
    handlePage: async (req, res, url, context) => {
      await pipeProxyRequest(req, res, upstreamUrl, context);
    }
  });
}

function createAttachServer(options) {
  const targetUrl = assertLoopbackUrl(options.url, "attach");
  const sidecarTarget = path.resolve(options.comments || urlSidecarTarget(targetUrl, options.cwd));
  const targetName = path.basename(sidecarTarget);

  return createReviewServer({
    ...options,
    targetFile: sidecarTarget,
    targetDir: path.dirname(sidecarTarget),
    targetName,
    allowedOrigin: targetUrl.origin,
    handlePage: async (req, res) => {
      sendText(res, 404, "Fidibaku attach server only serves /__review/* endpoints.\n");
    }
  });
}

function reviewUrl(server, options) {
  const address = server.address();
  const tokenPart = options.noToken ? "" : `t=${encodeURIComponent(server.fidibaku.token)}`;
  if (server.fidibaku.upstreamUrl) {
    const upstream = new URL(server.fidibaku.upstreamUrl);
    if (tokenPart) upstream.searchParams.set("t", server.fidibaku.token);
    const wrapperHost = upstream.hostname === "localhost" ? "localhost" : "127.0.0.1";
    upstream.protocol = "http:";
    upstream.host = `${wrapperHost}:${address.port}`;
    return upstream.toString();
  }
  return `http://127.0.0.1:${address.port}/${tokenPart ? `?${tokenPart}` : ""}`;
}

function serve(options) {
  const server = createFileServer(options);
  const port = Number(options.port || 0);
  server.listen(port, "127.0.0.1", () => {
    const url = reviewUrl(server, options);
    process.stdout.write(`fidibaku serving ${server.fidibaku.targetFile}\n`);
    process.stdout.write(`comments: ${server.fidibaku.sidecars.json}\n`);
    process.stdout.write(`${url}\n`);
    if (options.open) openBrowser(url);
  });
  return server;
}

function proxy(options) {
  const server = createProxyServer(options);
  server.fidibaku.upstreamUrl = new URL(options.url).toString();
  const port = Number(options.port || 0);
  server.listen(port, "127.0.0.1", () => {
    const url = reviewUrl(server, options);
    process.stdout.write(`fidibaku proxying ${server.fidibaku.upstreamUrl}\n`);
    process.stdout.write(`comments: ${server.fidibaku.sidecars.json}\n`);
    process.stdout.write(`${url}\n`);
    if (options.open) openBrowser(url);
  });
  return server;
}

function attach(options) {
  const targetUrl = assertLoopbackUrl(options.url, "attach");
  const server = createAttachServer(options);
  const port = Number(options.port || 0);
  server.listen(port, "127.0.0.1", () => {
    const address = server.address();
    const base = `http://127.0.0.1:${address.port}`;
    const src = `${base}/__review/attach.js${options.noToken ? "" : `?t=${encodeURIComponent(server.fidibaku.token)}`}`;
    const state = {
      version: 1,
      mode: "attach",
      targetUrl: targetUrl.toString(),
      allowedOrigin: targetUrl.origin,
      scriptUrl: src,
      scriptTag: scriptTag(src),
      bookmarklet: bookmarklet(src),
      token: server.fidibaku.token,
      sidecars: server.fidibaku.sidecars,
      updatedAt: new Date().toISOString()
    };
    const stateFile = writeAttachState(options.cwd, state);
    process.stdout.write(`fidibaku attached to ${targetUrl.toString()}\n`);
    process.stdout.write(`comments: ${server.fidibaku.sidecars.json}\n`);
    process.stdout.write(`state: ${stateFile}\n\n`);
    process.stdout.write("Add this script to the page/app layout:\n");
    process.stdout.write(`${state.scriptTag}\n\n`);
    process.stdout.write("Or use this bookmarklet for a one-off browser session:\n");
    process.stdout.write(`${state.bookmarklet}\n\n`);
    process.stdout.write("Vite adapter: import { fidibaku } from \"fidibaku/vite\" and add fidibaku() to plugins.\n");
    if (options.open) openBrowser(targetUrl.toString());
  });
  return server;
}

module.exports = {
  CLIENT_JS,
  CLIENT_CSS,
  injectHtml,
  createServer: createFileServer,
  createFileServer,
  createProxyServer,
  createAttachServer,
  serve,
  proxy,
  attach,
  urlSidecarTarget,
  attachStatePath
};
