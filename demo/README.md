# Demo footage

Marketing videos and stills for OpenChoreo for VS Code, made from code with the
[product-demo skill](https://github.com/kaviththiranga/product-demo-skill). Nothing is recorded by
hand: scene scripts drive the real desktop VS Code with the packaged extension, and Remotion turns
each clip into a short.

Every feature scene becomes:

| Output | Where |
|---|---|
| a 10-20 s short (hook card → the feature, auto-zoomed → install CTA) in 16:9, 9:16 and 1:1 | `out/final/shorts/<id>-16x9.mp4`, `-9x16.mp4`, `-1x1.mp4` |
| a looping README GIF (≤ 5 MB) | `out/final/gifs/<id>.gif` |
| a key-moment poster (1920x1080) | `out/final/posters/<id>.png` |
| 2x screenshots taken during the scene (blog, READMEs) | `out/shots/<id>-NN-<label>.png` |

plus a ~95 s highlight reel of the `highlight: true` scenes (`out/final/demo-16x9.mp4`,
`demo-9x16.mp4`) and a ~6 min tour of every feature (each one's whole action, sped up around the moments that matter) with an animated chapter card per area
(`make tour` → `out/final/tour-16x9.mp4`, `tour-9x16.mp4`). Music: "Getting it Done" by Kevin
MacLeod (incompetech.com), CC BY 4.0, normalized in `assets/music.mp3`; the credit is on every end
card (`outro.credit`) - keep it when you post the videos, or swap `style.music` for another track
you have the rights to. Everything under `out/` is git-ignored; `make publish` copies what the
repository keeps into [`../docs/media/`](../docs/media/README.md): the 16:9 shorts (re-encoded), one
still per scene, the README GIFs (`gif: true`), the reel, and a catalog page.

## The flow

```
cluster (k3d) ─ seed ─ seed-workspaces ─ record-<area> ─ collect ─ render ─ check ─ publish
                                         (no AI: replayed scene scripts)   (look at the frames)
```

```bash
cd demo
make install                      # once: post-production deps (Remotion); recording uses the repo's pnpm deps
make vsix                         # build + package the extension from this checkout
make seed-workspaces              # the folders the scenes open, under ~/demo-ws (resets them)
make record                       # every area (or record-explore, record-language, ...)
make collect                      # out/raw/<area>/ → out/raw/ + out/shots/
make render                       # shorts + reel + tour + GIFs + posters
make check                        # contact sheets in out/frames/ - look at every one
make publish                      # → ../docs/media (what the READMEs and the blog use)
```

Narrow any step: `make record-delivery SCENES="promote"` (SCENES applies to every target in
the same `make` call - run areas in separate calls when you narrow),
`make shorts SCENES="gitops-guard" ASPECTS="9x16"`.

## Bring up

The scenes run against an OpenChoreo **1.4.0-m.1** single-cluster k3d install with the
observability plane (runtime logs). The API must answer at
`http://api.openchoreo.localhost:8080` from the machine that records (`make up` checks it).

Recording on another machine than the k3d host (a Mac against a VPS): macOS resolves every
`*.localhost` name to loopback whatever `/etc/hosts` says, so forward the cluster's ports to
localhost: `ssh -N -L 8080:<host>:8080 -L 11080:<host>:11080 -L 30443:<host>:30443 <host>`
(8080 the control plane and its identity provider, 11080 the observer for runtime logs and the
observer MCP server, 30443 the data plane's remote-agent router that `occ remote` dials for Run
Locally and Debug Against Environment). Scenes reach the cluster only through its API and occ
(`packages/extension/src/test/demo/cluster.ts`), never kubectl, so they run from anywhere. Put a
macOS occ at `~/demo-ws/.bin/occ` (the Makefile prefers it) and the demo login at
`~/demo-ws/.occ/default.config`.

- **Cluster seed** (on the k3d host, needs `kubectl`): `make seed` runs `seed/seed.sh`, which
  loads the advanced OpenChoreo samples (url-shortener across development → staging → production,
  release history, a scheduled task, Online Boutique, source builds including one that fails on
  purpose, live traffic for logs). Idempotent; `seed/seed.sh status` shows what is deployed. See
  `seed/README.md`.
- **Demo login**: the occ quick-start client with the platform-engineer role
  (`seed/demo-access.yaml`). The workspace scripts copy the login next to the folders that need it
  (`~/demo-ws/<area>/occ-config`, `~/demo-ws/.occ/gitops-demo.config`, ...), so scenes that switch
  namespaces never touch your own `~/.openchoreo/config`.
- **Workspaces**: `make seed-workspaces` runs every `seed/workspaces-<area>.sh`
  (`DEMO_WS_ROOT`, default `~/demo-ws`). Folder names show in the title bar and Explorer, so they
  are believable project names (`url-shortener`, `shop-gitops`, `services`, ...).

## Recording

`make record-<area>` runs the in-repo harness (`packages/extension`: `pnpm demo:capture`, scenes
in `src/test/demo/scenes/<area>/`) with the packaged `.vsix` and the env each scene group needs
(workspace, `DEMO_WITH`, `OCC_CONFIG`, settings - see the Makefile). Output per scene:
`out/raw/<area>/<id>.mp4`, `<id>.json` (key moment + marks with element boxes, which drive the
camera) and 2x PNGs.

What the harness guarantees: real desktop VS Code (downloaded by `@vscode/test-electron`), a
throwaway profile **and** a throwaway HOME (no personal skills, prompts or git identity on
screen: the terminal shows `➜ folder`, commits are by `Demo Developer <dev@example.com>`),
1440x810 at 2x, Dark Modern, editor font 16, custom menus/dialogs so they are captured, and
`chat.disableAIFeatures` for non-AI scenes (no Sign In button or Copilot icon).

**Linux box (iterate, headless)** - e.g. the VPS that hosts the cluster: no display needed (headless
Ozone). Several captures can run side by side (unique `DEMO_OUT_DIR`); pull the clips back with
`rsync -a <host>:<repo>/demo/out/raw/ out/raw/`.

**Mac (final takes)** - the same scenes, one area at a time, against the same cluster: Mac fonts
and the ⌘ keycasts look like what most viewers use. The window opens on screen; leave it alone
and uncovered while it records. Scenes use `Mod+…` shortcuts, so they run unchanged on both.
The harness launches with `--use-inmemory-secretstorage`: with the throwaway HOME there is no
login keychain, and VS Code otherwise blocks at startup on an invisible keychain dialog (the
window never appears, the capture waits forever).

AI scenes keep AI features on. Signed out, the chat hand-offs (prompts and attachments filled in
by the extension) still record; the scenes where the agent answers (`agent-troubleshoots-build`,
`agent-fixes-yaml`, `requires: ['copilot']`) need a signed-in Copilot. Use a dedicated profile,
never your everyday one:

```bash
seed/workspaces-ai.sh
cd ../packages/extension
# once: sign in to GitHub Copilot in the window, then delete that manual recording (it shows the account)
DEMO_PROFILE_DIR=~/demo-ws/.vscode-copilot DEMO_WITH=manual DEMO_MANUAL_SECONDS=120 DEMO_SCENES=manual pnpm demo:capture
# each take (re-run seed/workspaces-ai.sh first: agent-fixes-yaml edits the workspace)
DEMO_PROFILE_DIR=~/demo-ws/.vscode-copilot DEMO_WITH=cluster,copilot \
DEMO_VSIX=$PWD/openchoreo-unofficial-0.3.0.vsix DEMO_WORKSPACE=$HOME/demo-ws/ai/snip-api-service \
OCC_CONFIG=$HOME/demo-ws/.occ/default.config DEMO_OCC=$HOME/demo-ws/.bin/occ \
DEMO_SETTINGS='{"chat.titleBar.signIn.enabled":false,"chat.viewSessions.enabled":false,"chat.tools.global.autoApprove":true}' \
DEMO_SCENES=agent-troubleshoots-build,agent-fixes-yaml,chat-add-yaml,troubleshoot-build,fix-with-copilot \
DEMO_OUT_DIR=../../demo/out/raw/ai pnpm demo:capture
```

A kept profile runs with your real HOME (the sign-in lives in the keychain), so your own
`~/.claude` / `~/.copilot` customizations load in those takes too. The two answering scenes are
written but were not recorded yet (no Copilot sign-in where they were built): expect to adjust
waits on the first take.

Every scene must pass 3 runs in a row before its final take; look at its key frame afterwards.

## Post-production

`storyboard.yaml` holds the product name, tagline, OpenChoreo brand colors, the install CTA and,
per scene, the `hook` (≤ 5 words, the short's title card), the one-line `caption`, and
`highlight` (in the reel). Optional per scene: `trim`, `speed`, `zoom`, `key_moment_at_s` (see the
skill's `templates/storyboard.yaml`).

`make timeline` prints each short's planned length. The camera follows the clip's marks (clicks
and the `key` mark) and lands on the key element; idle stretches play at 4x. When a short looks
wrong, fix the storyboard (trim, speed, zoom) or the scene's marks, not the video.

Render times on an M4 Pro: 3-11 s per short (about half its length), a GIF ~6 s, a poster ~1 s;
all ~31 scenes in three ratios plus GIFs, posters and the reel take about 15 minutes.

Check the recorder clock: each `out/raw/<id>.json` `duration_s` should match the MP4's length
within ~1% (the harness writes frames to catch up with wall time and reports frames / fps, so it
holds even on a loaded box; `make timeline` warns otherwise).

Remotion is free for individuals and companies of up to 3 people; larger companies need a
[company license](https://www.remotion.dev/license).

## Files

| Path | What |
|---|---|
| `storyboard.yaml` | brand, CTA, per-scene hooks/captions/highlight - edit this first |
| `Makefile` | the whole flow; per-area recording env |
| `seed/` | cluster seed (`seed.sh`, `manifests/`) and scene workspaces (`workspaces-*.sh`) |
| `assets/logo.svg` | white OpenChoreo mark for the cards |
| `scripts/tools/` | timeline planner (`build_timeline.mjs` + `timeline_lib.mjs`), frames, GIFs, checks, `publish_media.mjs` (from the skill) |
| `video/` | Remotion project; `render.mjs` renders everything with one bundle |
| `../packages/extension/src/test/demo/` | the recording harness and scenes |
