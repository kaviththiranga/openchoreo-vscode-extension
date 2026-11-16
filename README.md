# OpenChoreo VSCode Extension

Monorepo for Visual Studio Code tooling for the [OpenChoreo](https://openchoreo.dev) developer platform.

## Packages

| Package | Description |
|---|---|
| [`packages/extension`](packages/extension/) | Main VSCode extension — webview sidebar, resource editing, commands |
| [`packages/language-server`](packages/language-server/) | Language server — completions, validation, hover, symbols |
| [`packages/webview-ui`](packages/webview-ui/) | Preact-based sidebar webview — unified tree explorer with custom icons |
| [`schemas`](schemas/) | JSON Schema files for OpenChoreo CRD types |

See the [extension README](packages/extension/README.md) for full feature documentation.

## Development

```bash
# Install dependencies
pnpm install

# Build all packages
pnpm build

# Watch mode (extension)
cd packages/extension && pnpm dev

# Run tests
pnpm test

# End-to-end tests in a real VS Code (after pnpm build; Linux CI wraps this in xvfb-run)
cd packages/extension && pnpm test:e2e

# Type check
cd packages/extension && pnpm lint
cd packages/language-server && pnpm lint

# Package VSIX
cd packages/extension && pnpm package
```

### Regenerating CRD schemas

`schemas/*.json` are generated from the OpenChoreo CRDs at a release tag; resource
references are kept in `schemas/refs.json` and re-applied on every run:

```bash
cd packages/extension
node scripts/generate-schemas.mjs --openchoreo <path-to-openchoreo-checkout> --ref v1.3.3
```

### Running in Development

1. Open this repo in VSCode
2. Press F5 to launch the Extension Development Host
3. The extension activates automatically in the new window

## License

Apache-2.0

## Releasing

1. Bump `version` in `packages/extension/package.json` and add a `## <version> — <date>` section to `packages/extension/CHANGELOG.md`.
2. Push to `main`, then push a matching tag: `git tag v<version> && git push origin v<version>`.
3. The **Release** workflow builds, runs unit and end-to-end tests, creates the GitHub release with the `.vsix` and the changelog section as notes, and publishes to the VS Code Marketplace (`VSCE_PAT` secret) and Open VSX (`OVSX_PAT` secret) when those secrets are set.
