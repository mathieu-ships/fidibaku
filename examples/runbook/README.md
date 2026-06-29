# Fidibaku public runbook example

This folder is a public, anonymized example of how to structure a reviewable HTML runbook with supporting implementation briefs. It mirrors the useful shape of a single-page runbook template: one HTML artifact, tabbed sections, dependency batches, scorecards, matrix rows, a gap ledger, and one Markdown brief per implementation unit.

Important: this folder is an example of runbook content and layout, not the comment mechanism. Use the `fidibaku` CLI for comments. Do not rebuild comment popovers, persistence, or sidecar writing from this example.

## Files

```text
../runbook.html              # the reviewable HTML artifact
briefs/                      # public-safe example implementation briefs
```

## Try it

From the repository root:

```sh
npx fidibaku review examples/runbook.html
```

Right-click any section, table row, scorecard, recommendation, or gap. Fidibaku writes:

```text
examples/runbook.comments.json
examples/runbook.comments.md
```

From any other project, scaffold and open a fresh copy:

```sh
npx -y fidibaku runbook
```

That creates `fidibaku-runbook.html` plus `fidibaku-runbook/briefs/`. Use `npx -y fidibaku runbook --copy-only -o plan-review.html` when an agent should create the files without starting a browser/server.

## Adapt it

1. Scaffold a copy with `npx -y fidibaku runbook --copy-only -o plan-review.html`, or copy `examples/runbook.html` manually inside this repository.
2. Replace the fictional release-readiness content with your own report/runbook.
3. Keep or add stable `data-review-id`, `data-review-group`, and `data-review-label` attributes on important sections.
4. Put longer implementation context in `briefs/` and link to those briefs from your HTML.
5. Run `npx fidibaku review <your-file.html>` and hand the generated `*.comments.md` / `*.comments.json` to an agent or teammate.

All content in this example is fictional and safe for public repositories. The HTML uses local/system font fallbacks and does not download external fonts or assets.
