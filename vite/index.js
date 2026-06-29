"use strict";

const fs = require("fs");
const path = require("path");

function readState(root, stateFile) {
  const file = stateFile ? path.resolve(root, stateFile) : path.join(root, ".fidibaku", "attach.json");
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function injectScript(html, scriptTag) {
  if (!scriptTag || html.includes("__review/attach.js") || html.includes("fidibaku:attached")) return html;
  const block = `<!-- fidibaku:attached -->\n${scriptTag}`;
  if (/<\/head>/i.test(html)) return html.replace(/<\/head>/i, `${block}\n</head>`);
  return `${block}\n${html}`;
}

function fidibaku(options) {
  options = options || {};
  let root = process.cwd();
  return {
    name: "fidibaku",
    enforce: "pre",
    configResolved(config) {
      root = config.root || root;
    },
    transformIndexHtml(html) {
      if (options.enabled === false) return html;
      const state = readState(root, options.stateFile);
      if (!state || state.mode !== "attach") return html;
      return injectScript(html, state.scriptTag);
    }
  };
}

module.exports = {
  fidibaku,
  default: fidibaku
};
