# Review instrumentation brief

## Objective

Make the runbook easy to review with Fidibaku and easy for an agent to act on after comments are exported.

## Current state

The example HTML uses explicit `data-review-id`, `data-review-group`, and `data-review-label` attributes on important sections, rows, recommendations, cards, and notes. Fidibaku also auto-instruments ordinary HTML elements at runtime, so unmarked content can still receive comments.

## Acceptance criteria

- Important generated rows have stable `data-review-id` values.
- Labels describe what a reviewer sees on screen.
- Groups map to useful Markdown headings in the exported comments file.
- The page remains useful if the SDK falls back to auto-generated anchors.
- Comment sidecars are ignored by git unless a project deliberately chooses to commit review transcripts.

## Test plan

- Run `npx fidibaku review examples/runbook.html`.
- Right-click one build-plan row, one scorecard, one matrix row, and one gap-ledger row.
- Confirm `examples/runbook.comments.json` contains stable IDs for explicit anchors.
- Confirm `examples/runbook.comments.md` groups comments by review area.

## Review prompts

- Are any important rows missing stable anchors?
- Are the exported Markdown headings useful for an implementer?
- Would regenerated HTML keep the same IDs for unchanged items?
