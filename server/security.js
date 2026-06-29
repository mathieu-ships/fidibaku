"use strict";

const crypto = require("crypto");
const path = require("path");

function createToken() {
  return crypto.randomBytes(24).toString("base64url");
}

function timingSafeEqualString(a, b) {
  const left = Buffer.from(String(a || ""));
  const right = Buffer.from(String(b || ""));
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function requestToken(req, url) {
  return req.headers["x-review-token"] || url.searchParams.get("t");
}

function requireToken(req, url, expectedToken, noToken) {
  if (noToken) return true;
  return timingSafeEqualString(requestToken(req, url), expectedToken);
}

function safeJoin(rootDir, requestPath) {
  const decoded = decodeURIComponent(requestPath.split("?")[0]);
  const rel = decoded === "/" ? "" : decoded.replace(/^\/+/, "");
  const candidate = path.resolve(rootDir, rel);
  const root = path.resolve(rootDir);
  if (candidate !== root && !candidate.startsWith(`${root}${path.sep}`)) {
    throw new Error("Path traversal rejected.");
  }
  return candidate;
}

module.exports = {
  createToken,
  requireToken,
  safeJoin
};
