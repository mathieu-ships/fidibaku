# Launch communications brief

## Objective

Give prospective users a clear first-run path for trying Fidibaku through `npx`.

## Current state

The package exposes a `fidibaku` binary, a static-file review flow, an attach flow for existing localhost apps, and a proxy flow for zero-code injection. The public runbook example is included in the npm package allowlist.

## Acceptance criteria

- README includes the exact command for the runbook example.
- The example explains which files are generated after comments are posted.
- The package dry run includes the runbook HTML and supporting briefs.
- Publishing is blocked until npm auth, package ownership, and any 2FA step are confirmed.

## Test plan

- Run `npm run check`.
- Run `npm run smoke`.
- Run `npm pack --dry-run`.
- Confirm the pack list includes `examples/runbook.html` and `examples/runbook/briefs/*.md`.

## Review prompts

- Is the first command obvious enough for a user who only has `npx`?
- Are package-auth requirements stated separately from code readiness?
- Is the example free of private names, organization data, and credentials?
