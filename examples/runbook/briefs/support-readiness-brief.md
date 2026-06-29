# Support readiness brief

## Objective

Prepare public-safe support guidance for users trying Fidibaku against local files or existing localhost apps.

## Current state

The README documents `review`, `attach`, `proxy`, `export`, and `resolve`. The runbook example shows the expected sidecar files and explains that comments are local review state.

## Acceptance criteria

- Troubleshooting copy explains where sidecar files are written.
- Users know when to choose `review`, `attach`, or `proxy`.
- The docs explain that browser write access needs the local Fidibaku server or a one-time File System Access grant for bundled files.
- The support path does not ask users to publish to npm during local verification.

## Test plan

- Run `npx fidibaku review examples/runbook.html`.
- Run `npx fidibaku export examples/runbook.html` after adding a comment.
- Run `npx fidibaku resolve examples/runbook.html --id <comment-id> --reply "Handled"` against a test comment.
- Verify the Markdown sidecar shows the reply/status.

## Review prompts

- Would a new user know which command to run?
- Does the copy distinguish comments sidecars from source files?
- Are failure modes described without exposing private project details?
