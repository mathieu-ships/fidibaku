# Contributing

Thanks for improving Fidibaku.

## Local setup

```sh
npm install
npm run check
npm run smoke
```

To try the package exactly as a user would:

```sh
npm pack
tmp="$(mktemp -d)"
version="$(node -p "require('./package.json').version")"
npm install -g "./fidibaku-${version}.tgz" --prefix "$tmp"
"$tmp/bin/fidibaku" review examples/report.html
```

Generated `*.comments.json`, `*.comments.md`, `.fidibaku/`, and `fidibaku-*.tgz` files are local artifacts and should not be committed.

## Pull requests

Keep changes focused and include:

- What changed and why.
- Checks run locally.
- Any manual browser verification, especially right-click/comment flows.
- Notes for behavior that affects local files, browser storage, or localhost security.

## Releases

Releases are cut from `main` with the `Tag Release` GitHub Action. See [docs/releasing.md](docs/releasing.md).
