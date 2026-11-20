# Fidibaku for coding agents

Use Fidibaku when a user wants to review a local website, UI, static HTML artifact, or larger visual plan and return feedback that stays anchored to the relevant element.

## Start the right review mode

Run commands from the project whose UI is being reviewed so URL reviews write their sidecars into that project.

For a running local website, use `review`. It wraps the site in a temporary Fidibaku URL and requires no app changes:

```sh
npx -y fidibaku review http://localhost:3000
```

For a static HTML artifact, pass its path:

```sh
npx -y fidibaku review path/to/report.html
```

Use `attach` when the page should remain on its original localhost URL. Follow the printed integration instructions, or use the `fidibaku/vite` plugin so it reads the generated attach state:

```sh
npx -y fidibaku attach http://localhost:3000
```

Do not build comment popovers, right-click handlers, persistence, or sidecar writing into the reviewed UI. These are provided by the Fidibaku CLI and runtime.

## Use the runbook for larger artifacts

The packaged runbook is an optional visual scaffold for plans, audits, roadmaps, and implementation reviews. It is not the comment mechanism.

Create and open a fresh copy:

```sh
npx -y fidibaku runbook
```

When preparing the artifact without starting a browser or server:

```sh
npx -y fidibaku runbook --copy-only -o plan-review.html
```

When adapting the scaffold:

- Preserve its HTML/CSS visual system, tabs, layout, spacing, tables, scorecards, and linked brief structure unless the user asks for a redesign.
- Replace the fictional content with project-specific material instead of rebuilding the scaffold.
- Keep the generated support directory beside the HTML file and update its briefs as needed.
- Do not copy or recreate a comment layer from the runbook HTML. Start the review through Fidibaku.

The detailed example guide is in [`docs/runbook-example.md`](../docs/runbook-example.md).

## Add durable review anchors

Fidibaku can generate fallback anchors, but generated or frequently edited pages should use explicit, stable attributes on important reviewable elements:

```html
<section
  data-review-id="pricing:primary-cta"
  data-review-group="Pricing"
  data-review-label="Primary call to action">
  ...
</section>
```

- Keep `data-review-id` unique and stable across content changes and regeneration.
- Use `data-review-group` to identify the page or section.
- Use `data-review-label` to give the reviewer and agent a human-readable target.

## Decks and single-page apps

Each comment belongs to the view it was made on: by default `pathname + search + hash`, so `#2.2` and `#3.1` of a hash-routed deck are separate views even though they share elements. Markers show only on their own view; the Comments panel lists every view and jumps to a comment's view when clicked.

When the URL doesn't identify the view (slides switched without a URL change, or a long page whose `#section` links are only scroll anchors), let the page name it, first match wins:

```js
window.fidibakuView = () => `slide-${currentSlide}`; // or a plain string
document.documentElement.dataset.fidibakuView = "slide-3";
```

```html
<meta name="fidibaku-view" content="report">
```

Dispatch `window.dispatchEvent(new Event("fidibaku:viewchange"))` if the view changes without a DOM change or navigation.

## Act on feedback and close the loop

Fidibaku writes `<target>.comments.md` and `<target>.comments.json`. Markdown is the convenient agent handoff; JSON is the authoritative structured sidecar.

1. Read the open comments and use their IDs, labels, groups, views, and element context to find the relevant source. The Markdown groups comments under one heading per view (`` ## View: `/#2.2` ``); JSON has a `view` field. Comments under "All views" predate views.
2. Implement the requested changes in the real project and run the relevant checks.
3. Resolve each completed comment with a useful reply:

```sh
npx -y fidibaku resolve <file.html|localhost-url> \
  --id <comment-id> \
  --reply "Implemented and verified"
```

4. Leave unclear or unimplemented comments open. Use `--status wontfix` only when that outcome is intentional.
5. Refresh the reviewed page so the user can inspect the result and continue the review loop.

