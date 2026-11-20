# Fidibaku architecture

Fidibaku is a local review layer for websites, product UI, and HTML artifacts. It lets a reviewer right-click page elements, leave anchored comments, and persist those comments as sidecar files an agent or teammate can read.

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

Fallback anchors are re-derived whenever the page re-renders an element in place, so an element that shows different text on different views gets the same ID a fresh load of that view would give it.

## Views

Single-file decks and single-page apps re-render the same elements (a caption, `main`, a header) for every route. So each comment belongs to the view it was made on, and its marker and highlight show only on that view.

By default the view is `location.pathname + location.search + location.hash`, without Fidibaku's own `t` session token. A page can name its views instead. Fidibaku reads the first one set, at the moment a comment is made and whenever it re-checks:

1. `window.fidibakuView = "slide-3"`, or a function that returns the name.
2. `document.documentElement.dataset.fidibakuView = "slide-3"` (the `data-fidibaku-view` attribute on `<html>`).
3. `<meta name="fidibaku-view" content="slide-3">`.

A constant override, such as `<meta name="fidibaku-view" content="report">`, puts every comment on a page in one view. Use it for long pages where `#section` links are scroll anchors rather than routes.

Fidibaku re-checks the view on `hashchange`, `popstate`, `history.pushState`/`replaceState`, DOM changes, and a `fidibaku:viewchange` event on `window`. Dispatch that event if a page changes `window.fidibakuView` without changing the DOM.

The Comments panel lists every comment, grouped by view with a count per view. Clicking a comment from another view takes you there. A hash view sets the hash; a path view uses `history.pushState` plus a `popstate` event so client-side routers render it, and falls back to a full page load on multi-page sites. Then the element is scrolled to and highlighted.

Comments saved before views existed have no `view`. They keep the old behaviour: they show wherever their anchor exists, and are listed under "All views".

## Sidecars

The JSON sidecar is authoritative:

```json
{
  "version": 1,
  "target": "deck.html",
  "updatedAt": "2026-11-20T12:00:00.000Z",
  "comments": [
    {
      "id": "auto:h1:1x2y3z@k9m2p",
      "anchor": "auto:h1:1x2y3z",
      "view": "/#2.2",
      "url": "/#2.2",
      "group": "Auto",
      "label": "The brain is the number one blocker",
      "text": "Make this the title",
      "status": "open",
      "createdAt": "2026-11-20T12:00:00.000Z",
      "updatedAt": "2026-11-20T12:00:00.000Z",
      "reply": null
    }
  ]
}
```

- `anchor` is the element the comment is attached to (`data-review-id` or a fallback anchor).
- `view` is where the comment shows.
- `url` is where it was made, used to navigate back to it.
- `id` is the anchor scoped by view, so the same element can carry a different comment on each view. Older comments have no `anchor`, `view` or `url`, and their `id` is the anchor.

The Markdown sidecar is generated for humans and agents. Once a file has view-scoped comments, it groups them under one heading per view (`` ## View: `/#2.2` (2 comments) ``, with "All views" first), then by group. Comment bodies are fenced text blocks so paragraphs survive round-trips.

## Security model

- Servers bind to loopback only.
- Review APIs require a per-session token unless `--no-token` is explicitly provided.
- `proxy` and `attach` only accept localhost/loopback targets by default.
- `attach` restricts browser API calls to the configured origin with CORS.
- `proxy` strips the Fidibaku token before forwarding requests upstream.
- Standalone browser-only mode cannot silently write to disk. Browser security requires a user-selected file handle first.
