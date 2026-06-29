# Security

Fidibaku is a local review tool. It starts loopback-only servers, injects a browser comment layer, and writes sidecar files next to the reviewed target or to the configured comments path.

## Supported versions

Security fixes target the latest npm release.

## Reporting a vulnerability

Please report security issues privately through GitHub's private vulnerability reporting for this repository if available. If it is not available, open a minimal public issue that asks for a private contact path without including exploit details.

## Local security model

- Review servers bind to loopback.
- Review API requests require a random session token unless `--no-token` is explicitly used.
- `attach` and `proxy` are restricted to localhost/loopback URLs.
- `proxy` strips the review token before forwarding requests upstream.
- `.fidibaku/` contains local attach state and must stay uncommitted.

Do not use Fidibaku as an internet-facing proxy or expose its review server outside the local machine.
