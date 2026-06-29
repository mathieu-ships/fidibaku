# Public runbook example

This example demonstrates the kind of HTML artifact Fidibaku is designed to review: a single-page workstream runbook with the dense runbook design system, sticky tabs, dependency batches, readiness scorecards, reviewable matrix rows, a gap ledger, supporting implementation briefs, and explicit review anchors. The content is fictional and public-safe; the layout is intentionally production-grade rather than a toy sample.

Important for agents: this runbook is not the comment implementation. Do not copy or recreate a comment layer from the example HTML. Use `npx -y fidibaku review`, `attach`, or `runbook` so Fidibaku injects the real comment mechanism and writes the sidecar files.

## Try it with `npx`

From any project folder:

```sh
npx -y fidibaku runbook
```

The command creates a copy of the packaged example and opens a tokenized localhost URL:

```text
fidibaku-runbook.html
fidibaku-runbook/briefs/
```

Right-click any build-plan row, scorecard, matrix row, recommendation, or gap and leave a comment. Fidibaku writes:

```text
fidibaku-runbook.comments.json
fidibaku-runbook.comments.md
```

Those sidecars are ignored by git by default and are the files an agent or teammate should read to implement feedback.

To scaffold without opening a browser, for example when an agent is preparing a first draft from a plan doc:

```sh
npx -y fidibaku runbook --copy-only -o plan-review.html
```

## Existing localhost app

If your runbook page is already served by a dev server:

```sh
npx fidibaku attach http://localhost:3000/runbook
```

Then add the printed script tag to your app layout, or use the Vite adapter:

```js
import { fidibaku } from "fidibaku/vite";

export default {
  plugins: [fidibaku()]
};
```

The browser stays on your original localhost URL while Fidibaku writes sidecars in the current working directory.

## What the example covers

- Explicit `data-review-id`, `data-review-group`, and `data-review-label` anchors.
- Reviewable scorecards, dependency lanes, recommendations, and table rows.
- A tabbed HTML runbook rendered from public-safe data arrays.
- A filterable gap ledger.
- Supporting brief docs under `examples/runbook/briefs/`, linked from the HTML.
- Plain HTML and CSS with no framework dependency and no external font or asset downloads.

The example covers content structure, layout, and durable anchors. The right-click UI, persistence, export, and resolve flow are provided by the Fidibaku CLI/runtime.

All content is fictional and public-safe.
