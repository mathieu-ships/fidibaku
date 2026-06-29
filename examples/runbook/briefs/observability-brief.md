# Observability readiness brief

## Objective

Make sure reviewers can verify release health without searching across tools.

## Current state

The example runbook references dashboard, log query, and alert route checks in the launch checklist. A real runbook should link those resources directly and name the owner responsible for each signal.

## Acceptance criteria

- The runbook links to the primary dashboard.
- The runbook includes the exact log query or saved search name.
- Alert routing is verified before the release window.
- The rollback owner can identify a failing signal within five minutes.

## Review prompts

- Is the threshold clear enough for a reviewer to approve?
- Are the links stable and accessible to the intended team?
- Does the runbook say what to do when a signal is ambiguous?
