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

# Demo footage: an MP4 per scene plus 2x screenshots in packages/extension/demo-output/
cd packages/extension && pnpm demo:capture

# Type check
cd packages/extension && pnpm lint
cd packages/language-server && pnpm lint

# Package VSIX
cd packages/extension && pnpm package
```

### Demo footage

`pnpm demo:capture` drives a real VS Code through the scenes in `packages/extension/src/test/demo/scenes/` with Playwright and writes `demo-output/<timestamp>/`: one 1920×1080 MP4 per scene, 2x screenshots, and an `index.md` describing each capture. A scene that fails stops with a `failure` screenshot, so the scenes double as UI tests. CI uploads the footage as the `demo-footage` artifact.

- `DEMO_WITH=cluster` adds scenes that use your occ login; `DEMO_WITH=cluster,copilot` adds chat scenes, which need a signed-in VS Code profile (`DEMO_USER_DATA_DIR`, `DEMO_EXTENSIONS_DIR`; close that VS Code first).
- `DEMO_VSIX=<file>` records the packaged build, so the title bar doesn't read "Extension Development Host". Use it for final footage.
- `DEMO_SCENES=a,b` captures only those scenes; `DEMO_CAPTIONS=1` overlays captions, `DEMO_KEYCAST=0` hides the key overlay. See `scripts/capture-demo.mjs` for the rest.

Add a scene for every user-visible feature: write it in `scenes/`, then list it in `src/test/demo/index.ts`.

### Agent skills

`packages/extension/skills/` is not in git: `scripts/sync-skills.mjs` mirrors [openchoreo/skills](https://github.com/openchoreo/skills) there on every build, at the commit pinned by `openchoreoSkills.ref` in `packages/extension/package.json`. The build fails if upstream adds or removes a skill without a matching `contributes.chatSkills` entry. The weekly *Update OpenChoreo skills* workflow pins the latest upstream commit and opens a pull request; to do it by hand, run `node scripts/sync-skills.mjs --ref <sha>` in `packages/extension`.

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

One-time Open VSX setup (Cursor, Windsurf, VSCodium and other VS Code forks install from there): sign in at <https://open-vsx.org> with GitHub, link an Eclipse account and sign the publisher agreement, create an access token, claim the namespace with `npx ovsx@1.3.0 create-namespace KavithLokuhewage -p <token>`, then save the token with `gh secret set OVSX_PAT`.


## Unified CLI language server

This build starts the unified `occ lsp --stdio` through the VS Code Language Client. The original Node language-server source is retained, but it is not launched or packaged. No CLI or LSP executable is bundled.

Set `openchoreo.cliPath` to the unified executable and run `occ login` in the extension host environment. This development build temporarily defaults to:

```text
/Users/rukshanrwso2.com/WSO2_Projects/project_681/OpenChoreoLSP-MCPToolkit/occ_with_linter/openchoreo/bin/occ
```

An explicit setting takes priority. Clear the temporary machine-specific default before distributing the extension. With an empty setting, existing behavior is preserved: an available managed CLI is preferred over PATH. Older managed releases may support login without supporting `lsp`; configure a unified build explicitly in that case.

Use **OpenChoreo: Restart Language Server** after authentication or executable changes. Startup does not initiate login or download automatically, and failures do not trigger restart loops. Existing user-invoked Login and download actions remain available. Inspect **Output → OpenChoreo Language Server** for CLI stderr and startup details.

For remote VS Code sessions, install and authenticate `occ` remotely. The CLI uses its default `~/.openchoreo/config`; the extension's `openchoreo.configPath` override does not redirect CLI authentication.

Cluster names and schemas are sent only after initialization. Both snapshots are cleared before refresh and on logout; late results from an obsolete context or client are discarded. Slow cluster API requests cannot block shutdown. The chat YAML validation tool uses temporary LSP documents and consumes their diagnostics, rather than calling the original Node server's private validation request.

The current Go server rejects standard LSP shutdown. The extension attempts graceful shutdown, then awaits child-process termination before starting another server. Its Go implementation is unchanged by this integration.

### Verification

Run `pnpm --filter openchoreo-unofficial test`, `pnpm --filter openchoreo-unofficial lint`, and `pnpm build`. For an interactive check, start **Run Extension** with F5, open OpenChoreo YAML and an explorer resource, check completion/hover/diagnostics, switch namespace, then log out, log in, and restart the language server. Confirm chat YAML validation works and disabling the extension terminates the server.


### Resolved resource underlines

Resource references such as `name: deployment/service` are underlined when the current Go language server can resolve their definition. The full value is underlined, including both parts of `deployment/service`. This works for local YAML and Explorer resources. Unresolved references and ordinary names (metadata, containers, parameters, and templates) are left undecorated. Existing hover, diagnostics, and Cmd/Ctrl+Click or F12 navigation remain unchanged.

Underlines refresh after edits, scrolling, indexing diagnostics, cluster-feed changes, and language-server restart. Stale asynchronous results are discarded; checks are limited to visible references with bounded concurrency. This feature uses the existing definition request and requires no separate binary or additional cluster API calls.


For a code-oriented architecture walkthrough, Mermaid diagrams, and the new-file inventory, see [How the extension uses occ lsp](OCC_LSP_EXTENSION_GUIDE.md).
