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

The screenshots in the extension README live in `docs/images/` (1600 px wide, outside the VSIX) and are linked by absolute `raw.githubusercontent.com` URLs so the Marketplace shows them too. They come from these scenes, recorded with `DEMO_VSIX`:

- `gitops-live` and `gitops-compare` need a cluster whose Flux syncs a sample-gitops clone, and an occ context on that namespace: `DEMO_WITH=cluster,gitops-workspace DEMO_WORKSPACE=<clone> OCC_CONFIG=<config> DEMO_SCENES=gitops-live`. Give the clone a local git `user.name` and `user.email`: the demo VS Code runs with an empty home, so commits fail otherwise.
- `linked-component` runs in a clone of a component's source repository.

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

## Language servers

The extension runs one of two language servers:

- **`occ lsp --stdio`** from the installed occ, when it has the `lsp` command. It adds Go to Definition across local and cluster resources (with underlines on resolvable references), CEL suggestions, reference suggestions and pre/post-render validation. No occ is bundled.
- **The bundled TypeScript server** (`packages/language-server`) otherwise: schema validation, completions, hover and outline. Released occ versions do not have `occ lsp` yet, so this is what most users get today.

`openchoreo.languageServer` picks the server: `auto` (default) probes `occ lsp --help` and falls back to the bundled server; `occ` always uses occ lsp and shows an error when it is missing; `bundled` never probes. **OpenChoreo: Restart Language Server** re-runs the choice, for example after pointing `openchoreo.cliPath` at a new occ build. **Output → OpenChoreo** logs why the bundled server was chosen.

Notes on the occ lsp client:

- Cluster names and schemas are sent only after initialization and cleared on logout; late results from an old context or client are dropped.
- The chat YAML validation tool opens temporary LSP documents and reads their diagnostics. With the bundled server it calls `openchoreo/validate`.
- The Go server rejects the standard LSP shutdown, so the extension waits for the child process to exit before starting another one.
- For remote VS Code sessions, install and log in to `occ` on the remote host. occ reads its default `~/.openchoreo/config`.

### Verification

`pnpm test` and `pnpm test:e2e` (in `packages/extension`) check the bundled server; set `OPENCHOREO_E2E_LANGUAGE_SERVER=auto` or `occ` to run the suite against your occ. `pnpm test:definitions` checks Go to Definition with occ lsp in an isolated VS Code; set `OPENCHOREO_OCC_BINARY` to an occ that has `lsp`. If navigation fails, enable `openchoreo.definitionDebug` and restart the language server to log the executable, request positions and returned locations.
