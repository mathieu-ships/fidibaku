# Fidibaku implementation note

This note summarizes the public implementation state for maintainers.

## Implemented surface

- `fidibaku review <file.html|localhost-url>`: convenience command. Files use served mode; localhost URLs use proxy mode.
- `fidibaku serve <file.html>`: serves one HTML report from loopback, injects the review client, and writes co-located sidecars.
- `fidibaku attach <localhost-url>`: preserves the original localhost URL, starts the local comment API, prints a script tag/bookmarklet, and writes `.fidibaku/attach.json` for adapters.
- `fidibaku proxy <localhost-url>`: wraps an existing localhost app through a Fidibaku URL and injects automatically.
- `fidibaku bundle <file.html>`: creates a standalone HTML file with inline client CSS/JS.
- `fidibaku export <file.html|localhost-url>`: prints Markdown or JSON comments.
- `fidibaku resolve <file.html|localhost-url>`: marks a comment open/resolved/wontfix and writes an agent reply.
- `fidibaku/vite`: Vite adapter that injects the active attach script from `.fidibaku/attach.json`.

## Anchoring

Explicit anchors use:

- `data-review-id`
- `data-review-group`
- `data-review-label`

The client also supports the older `data-cid`, `data-cgroup`, and `data-clabel` names for compatibility. When explicit anchors are absent, the client creates runtime fallback anchors for common reviewable HTML elements such as headings, paragraphs, sections, cards, lists, and table cells.

## Persistence

- JSON sidecar: authoritative source of truth.
- Markdown sidecar: generated for human/agent reading.
- Markdown comment bodies use fenced `text` blocks so multiline comments survive round-trips.
- Standalone File System Access mode uses a stable picker id and target-aware IndexedDB key. Browser security still requires a first user-selected file grant.

## Security notes

- Local servers bind to loopback.
- Review APIs require a random per-session token unless `--no-token` is explicitly used.
- `attach` and `proxy` accept only localhost/loopback URLs by default.
- `attach` restricts cross-origin API calls to the configured localhost origin.
- `proxy` strips the Fidibaku token before forwarding requests upstream.
- `.fidibaku/` is ignored because it contains local attach state and tokens.

## Verification

Current local verification:

- CLI syntax checks through `npm run check`.
- CLI smoke path through `npm run smoke`.
- Proxy integration: injected HTML, stripped content-security-policy response headers, stripped review token before upstream forwarding, proxied static assets, rewrote upstream redirects, wrote nested sidecars.
- Attach integration: allowed-origin CORS, blocked-origin rejection, preflight, attach script generation, sidecar write, and Vite adapter HTML injection.
- Package dry-run with `npm pack --dry-run`.
- npm publish verified through the GitHub Actions publish workflow for `fidibaku@0.1.0`.
