# OpenChoreo VSCode Extension

Monorepo for Visual Studio Code tooling for the [OpenChoreo](https://openchoreo.dev) developer platform.

## Packages

| Package | Description |
|---|---|
| [`packages/extension`](packages/extension/) | Main VSCode extension — tree views, resource editing, commands |
| [`packages/language-server`](packages/language-server/) | Language server — completions, validation, hover, symbols |
| [`packages/webview-ui`](packages/webview-ui/) | Webview UI components (Phase 3 — planned) |
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

# Type check
cd packages/extension && pnpm lint
cd packages/language-server && pnpm lint

# Package VSIX
cd packages/extension && pnpm package
```

### Running in Development

1. Open this repo in VSCode
2. Press F5 to launch the Extension Development Host
3. The extension activates automatically in the new window

## License

Apache-2.0
