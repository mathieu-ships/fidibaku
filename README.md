# fidibaku

Drop-in, right-click commenting for websites, landing pages, slides, runbooks, and static HTML reports. Comments autosave to files on disk next to the reviewed artifact so an AI agent can read them, act on them, and mark them resolved.

## Why

Static HTML is a great medium for an AI agent to hand work to a human (audits, dashboards, design reviews, generated docs). But the review loop back to the agent is broken: the human reviews in a browser, then retypes feedback into a chat, losing the anchor (which row? which recommendation?). `fidibaku` closes that loop: **right-click an element → comment → it autosaves to `<report>.comments.{json,md}` next to the file → the agent reads it and implements (and can mark items resolved with a reply).**

The hard constraint that shapes everything: a `file://` page can read its own path but the browser sandbox never grants it silent write access. So write capability has to come from a launcher outside the browser. Hence the SDK = an injectable JS layer **+** a tiny local CLI/server that owns the directory it was launched in. See the spec.

## For agents

Use Fidibaku for the comment mechanism. Do not rebuild comment popovers, sidecar writing, browser storage, or right-click handlers from the example runbook. The runbook is only a larger example of a reviewable HTML artifact and a layout/content pattern for generated plans.

If a user wants comments on an artifact, run one of these:

```sh
npx -y fidibaku review path/to/artifact.html
```

```sh
npx -y fidibaku attach http://localhost:3000
```

If a user wants a starting point for a larger plan/runbook, scaffold the example:

```sh
npx -y fidibaku runbook --copy-only -o plan-review.html
```

## Quick start

See the CLI guide:

```sh
npx -y fidibaku help
```

```sh
npx -y fidibaku review examples/report.html
```

Open the printed localhost URL, right-click the report, and type a comment. Press Enter to post/close the comment popover; press Shift+Enter to insert a new paragraph. `examples/report.comments.json` and `examples/report.comments.md` are written next to the report.

For a fuller public example, use the template runbook:

```sh
npx -y fidibaku runbook
```

This creates `fidibaku-runbook.html` plus `fidibaku-runbook/briefs/`, then opens the runbook for review. The runbook is a fictional launch-readiness review artifact using the full dense runbook design system: engineering grid, sticky tabs, dependency batches, scorecards, matrix rows, gap ledgers, recommendations, and linked briefs. It is meant to show the kind of generated HTML report Fidibaku can make reviewable without a backend and to give agents a concrete pattern for turning a plan doc into a reviewable runbook. The runbook does not implement comments itself; comments come from the Fidibaku CLI/server injected at review time. The example uses explicit `data-review-*` anchors so comments stay attached to durable sections even when the page is regenerated. It has no external font or asset downloads; the visual system uses local/system font fallbacks. See [docs/runbook-example.md](docs/runbook-example.md) for the walkthrough.

If the report already lives behind a local dev server, wrap that URL instead:

```sh
npx fidibaku attach http://localhost:3000/report
```

Fidibaku opens the original URL by default and prints a script tag plus a bookmarklet. Add the script to your local app layout, or use the Vite adapter:

```js
// vite.config.js
import { fidibaku } from "fidibaku/vite";

export default {
  plugins: [fidibaku()]
};
```

The Vite adapter reads `.fidibaku/attach.json`, which is written by `fidibaku attach`, and injects the current local script automatically. The browser stays on `http://localhost:3000/report`; right-click comments write sidecars in the current working directory. For example, `http://localhost:3000/report` writes `localhost-3000-report.comments.json` and `localhost-3000-report.comments.md`. Use `--comments reviews/report.html` to choose a stable sidecar base path.

For zero app changes, use proxy mode:

```sh
npx fidibaku proxy http://localhost:3000/report
```

Proxy mode injects automatically, but it necessarily opens a Fidibaku wrapper URL.

Fidibaku auto-instruments ordinary HTML by default: headings, sections, cards, paragraphs, list items, table rows/cells, blockquotes, figures, and common `card` / `row` / `item` / `panel` blocks become reviewable at runtime. For more durable anchors, reports can opt in with explicit IDs:

```html
<tr
  data-review-id="gap:x-direct-messages"
  data-review-group="Gap ledger"
  data-review-label="X Direct Messages">
  ...
</tr>
```

The prototype's older `data-cid`, `data-cgroup`, and `data-clabel` attributes are still supported for compatibility.

Auto-generated IDs combine element type, DOM path, and a short text hash, for example `auto:p:1x2y3z`. They are good for arbitrary static reports; explicit `data-review-*` anchors are better when a report will be regenerated and comments must survive larger layout/text edits.

## CLI

```sh
fidibaku attach <localhost-url> [--port <port>] [--open] [--no-open] [--no-token] [--comments <sidecar-base.html>]
fidibaku runbook [output.html] [-o out.html] [--copy-only] [--force] [--port <port>] [--no-open] [--no-token]
fidibaku example runbook [output.html] [-o out.html] [--copy-only] [--force] [--port <port>] [--no-open] [--no-token]
fidibaku review <file.html|localhost-url> [--port <port>] [--no-open] [--no-token] [--comments <sidecar-base.html>]
fidibaku serve <file.html> [--port <port>] [--open] [--no-open] [--no-token]
fidibaku proxy <localhost-url> [--port <port>] [--open] [--no-open] [--no-token] [--comments <sidecar-base.html>]
fidibaku bundle <file.html> [-o out.html]
fidibaku export <file.html|localhost-url> [--json] [--comments <sidecar-base.html>]
fidibaku resolve <file.html|localhost-url> --id <id> --reply <text> [--status open|resolved|wontfix] [--comments <sidecar-base.html>]
```

- `attach` preserves the original localhost URL. It starts the local comments API, writes `.fidibaku/attach.json`, prints a script tag/bookmarklet, and lets adapters inject the client into the app.
- `runbook` scaffolds the packaged public runbook example into the current directory and opens it for review. Use `--copy-only` when an agent should create the files without starting a server, `-o plan-review.html` to choose the output name, and `--force` to overwrite an earlier scaffold.
- `review` is the simplest command. It serves an HTML file or proxies a localhost URL, opens the browser by default, injects the review client, and writes sidecars locally.
- `serve` is the primary review loop. It binds to `127.0.0.1`, injects the review client, auto-instruments the report in the browser, token-protects review endpoints, and writes `<report>.comments.json` plus `<report>.comments.md`.
- `proxy` wraps an existing `http://localhost`, `http://127.0.0.1`, or loopback `https://...` URL. It forwards non-review requests to the upstream app, strips the review token before forwarding, injects only HTML responses, and writes sidecars in the current working directory unless `--comments` is provided.
- `bundle` creates a standalone HTML file with inline client JS/CSS. Standalone files auto-instrument in the browser, always keep localStorage + Copy/Download, and add Chromium File System Access autosave after the user connects a Markdown file. Browsers do not allow a page to turn a filepath in the URL into a writable folder grant, so the first pick is manual; Chromium should remember the picker location/handle for that target after the first grant.
- `export` prints the current comments sidecar as Markdown or JSON.
- `resolve` is the agent-side helper for marking comments done with a reply.

## Data format

The JSON sidecar is authoritative:

```json
{
  "version": 1,
  "target": "report.html",
  "updatedAt": "2026-06-22T18:00:00.000Z",
  "comments": [
    {
      "id": "gap:x-direct-messages",
      "group": "Gap ledger",
      "label": "X Direct Messages",
      "text": "Bump priority and scope this sprint.",
      "status": "open",
      "createdAt": "2026-06-22T18:00:00.000Z",
      "updatedAt": "2026-06-22T18:00:00.000Z",
      "reply": null
    }
  ]
}
```

`schema/comments.schema.json` documents the full format. The Markdown sidecar is generated for human/agent reading.

## What's in here

| Path | What |
|---|---|
| `client/review.js` / `client/review.css` | Injectable vanilla comment layer. |
| `server/serve.js` | Localhost server, static serving, injection, token-protected API. |
| `server/writer.js` | Atomic sidecar writer and Markdown renderer. |
| `cli/index.js` | `serve`, `bundle`, `export`, and `resolve`. |
| `schema/comments.schema.json` | JSON sidecar schema. |
| `examples/report.html` | Minimal review-ready report. |
| `examples/runbook.html` | Public workstream-runbook example with review anchors and linked briefs. |
| `docs/architecture.md` | Public architecture and security notes. |
| `docs/releasing.md` | npm release and GitHub Actions publishing runbook. |
| `docs/runbook-example.md` | Public walkthrough for the runbook example. |
| `docs/implementation-note.md` | Implementation decisions and handoff notes. |

## The review UX

- **Mark** any element with `data-cid` / `data-cgroup` / `data-clabel` or rely on auto-instrumented anchors in the SDK client.
- **Right-click** a marked element → inline popover → type → Enter posts/closes, Shift+Enter adds a paragraph → autosaves (localStorage always; File System Access API to a real file on Chromium after a one-time "Connect file").
- A floating **Comments** button opens a collector: list every comment (location + text), remove, **Copy markdown**, **Download .md**, and the autosave status.
- Output groups into markdown an agent can read directly.

## Checks

For local development in this repo:

```sh
npm install
```

```sh
npm run check
```

For a CLI smoke pass:

```sh
npm run smoke
```
