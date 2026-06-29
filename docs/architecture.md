# Fidibaku architecture

Fidibaku is a local review layer for HTML reports and localhost apps. It lets a reviewer right-click page elements, leave anchored comments, and persist those comments as sidecar files an agent or teammate can read.

## Modes

### `serve`

```sh
npx fidibaku serve report.html
```

Serves one HTML file from `127.0.0.1`, injects the review client, and writes `report.comments.json` plus `report.comments.md` next to the source file.

### `attach`

```sh
npx fidibaku attach http://localhost:3000/report
```

Starts a local comments API and prints a script tag/bookmarklet. The page stays on its original localhost URL. App integrations, such as `fidibaku/vite`, read `.fidibaku/attach.json` and inject the current script URL during local development.

### `proxy`

```sh
npx fidibaku proxy http://localhost:3000/report
```

Wraps an existing localhost URL through a Fidibaku URL and injects the client automatically. This requires no app changes but necessarily changes the browser URL.

### `bundle`

```sh
npx fidibaku bundle report.html
```

Creates a standalone HTML file with the review client inlined. In Chromium browsers, users can connect a Markdown file with the File System Access API; otherwise comments remain in localStorage and can be copied/downloaded.

## Anchoring

Explicit anchors are preferred when a report is generated repeatedly:

```html
<section
  data-review-id="release:rollback"
  data-review-group="Release readiness"
  data-review-label="Rollback plan">
  ...
</section>
```

When explicit anchors are absent, Fidibaku creates fallback anchors at runtime for common content elements: sections, headings, paragraphs, cards, lists, tables, figures, and similar reviewable blocks. Fallback anchor IDs are based on element type, DOM path, and a short text summary.

## Sidecars

The JSON sidecar is authoritative:

```json
{
  "version": 1,
  "target": "report.html",
  "updatedAt": "2026-06-26T12:00:00.000Z",
  "comments": []
}
```

The Markdown sidecar is generated for humans and agents. Comment bodies are fenced text blocks so paragraphs survive round-trips.

## Security model

- Servers bind to loopback only.
- Review APIs require a per-session token unless `--no-token` is explicitly provided.
- `proxy` and `attach` only accept localhost/loopback targets by default.
- `attach` restricts browser API calls to the configured origin with CORS.
- `proxy` strips the Fidibaku token before forwarding requests upstream.
- Standalone browser-only mode cannot silently write to disk. Browser security requires a user-selected file handle first.
