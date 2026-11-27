# demo/Makefile - OpenChoreo for VS Code marketing footage: record → collect → shorts/reel/gifs/posters → check.
# Run from demo/.  See README.md for the whole flow (cluster bring-up, seeding, Linux vs. Mac takes).
#
#   make record-<area>   record one feature area into out/raw/<area>/ (real desktop VS Code + packaged .vsix)
#   make collect         flatten out/raw/<area>/* into out/raw/ (clips + marks) and out/shots/ (2x stills)
#   make render          shorts + reel + gifs + posters (one Remotion bundle, one browser)
#   make check           frames + contact sheets + black/freeze report; then LOOK at out/frames/
#
# SCENES="a b" limits recording (within an area) and rendering; ASPECTS="9x16" limits the shorts.

SCENES ?=
ASPECTS ?= 16x9 9x16 1x1
GIF_MB ?= 4
REMOTION_BROWSER ?=

EXT := ../packages/extension
# Final takes always use the packaged build (no "Extension Development Host" in the title bar).
VSIX ?= $(firstword $(wildcard $(EXT)/openchoreo-unofficial-*.vsix))
DEMO_WS_ROOT ?= $(HOME)/demo-ws
# occ for the extension and for scene setups: the demo copy, else occ on PATH, else ~/.local/bin/occ.
DEMO_OCC ?= $(firstword $(wildcard $(DEMO_WS_ROOT)/.bin/occ) $(shell command -v occ 2>/dev/null) $(HOME)/.local/bin/occ)
# The demo login (never your own ~/.openchoreo/config): a copy of the cluster's demo client config.
DEMO_OCC_CONFIG ?= $(DEMO_WS_ROOT)/.occ/default.config
# Record wide so the editor's zooms stay sharp (the shorts render at 1080p).
DEMO_VIDEO_WIDTH ?= 2880
NO_AI := "chat.disableAIFeatures":true
# Every group: the extension uses DEMO_OCC (no download prompt on camera) and the bundled language server.
BASE := "openchoreo.cliPath":"$(DEMO_OCC)","openchoreo.languageServer":"bundled"
# Inner loop: occ terminals and tunnels get the login only from a <home>/.openchoreo/config path.
INNER_OCC := $(DEMO_WS_ROOT)/innerloop/occ-home/.openchoreo/config
INNER := $(NO_AI),"git.autofetch":false,"git.openRepositoryInParentFolders":"always","git.defaultCloneDirectory":"/tmp/src","openchoreo.localDev.keepTunnelsOpen":true
# Language: a bigger editor font, autosave on focus change (no "Save?" dialogs between scenes), no word-based suggestions.
LANG_SETTINGS := $(NO_AI),"editor.fontSize":18,"files.autoSave":"onFocusChange","editor.lightbulb.enabled":"off","editor.wordBasedSuggestions":"off","editor.occurrencesHighlight":"off","editor.selectionHighlight":false

comma := ,
empty :=
space := $(empty) $(empty)
csv = $(subst $(space),$(comma),$(strip $(1)))
# Scenes of an area, narrowed by SCENES when given: $(call pick,<area scenes>)
pick = $(call csv,$(if $(SCENES),$(filter $(SCENES),$(1)),$(1)))

# Record scenes with the in-repo harness: $(call capture,<area>,<workspace>,<DEMO_WITH>,<OCC_CONFIG or empty>,<settings json body>,<scenes>)
define capture
@test -n "$(6)" || { echo "  ($(1): no scene selected)"; exit 0; }; \
	test -f "$(VSIX)" || { echo "no .vsix - run 'make vsix' (or VSIX=path/to.vsix)"; exit 1; }; \
	echo "== $(1): $(6)  [$(2)]"; \
	scripts/tools/refresh_login.sh "$(if $(4),$(4),$(DEMO_OCC_CONFIG))" "$(DEMO_OCC)"; \
	cd $(EXT) && DEMO_VSIX="$(abspath $(VSIX))" DEMO_OUT_DIR="$(CURDIR)/out/raw/$(1)" DEMO_WORKSPACE="$(2)" \
	  DEMO_WITH="$(3),workspace" OCC_CONFIG="$(if $(4),$(4),$(DEMO_OCC_CONFIG))" DEMO_OCC="$(DEMO_OCC)" \
	  DEMO_VIDEO_WIDTH=$(DEMO_VIDEO_WIDTH) DEMO_SETTINGS='{$(BASE)$(if $(5),$(comma)$(5),)}' \
	  DEMO_SCENES="$(6)" pnpm -s demo:capture
endef

RENDER = cd video && node render.mjs $(1) $(if $(SCENES),--scenes $(call csv,$(SCENES)),) --aspects $(call csv,$(ASPECTS)) \
	$(if $(REMOTION_BROWSER),--browser $(REMOTION_BROWSER),) --gif-mb $(GIF_MB)

.PHONY: publish tour all install vsix up seed seed-workspaces record record-explore record-language record-delivery \
        record-innerloop record-gitops record-ai collect timeline reel shorts gifs posters render check frames clean

all: record collect render check

install: ## node deps for post-production (recording deps come with the repo's pnpm install)
	npm install --no-audit --no-fund
	npm --prefix video install --no-audit --no-fund

vsix: ## build + package the extension from this checkout (unreleased features included)
	cd .. && pnpm install && pnpm build
	cd $(EXT) && pnpm package

# --- bring up + seed -----------------------------------------------------------
up: ## the cluster runs on a k3d host (see README "Bring up"); this only checks the API answers
	@curl -fsS -o /dev/null -w 'OpenChoreo API: HTTP %{http_code}\n' http://api.openchoreo.localhost:8080/health \
	  || echo "API not reachable - start/port-forward the cluster (README, Bring up)"

seed: ## cluster demo data - run ON the k3d host (needs kubectl)
	seed/seed.sh

seed-workspaces: ## the folders the scenes open, under $(DEMO_WS_ROOT) (idempotent, resets them)
	@set -e; for s in seed/workspaces-*.sh; do echo "== $$s"; DEMO_WS_ROOT="$(DEMO_WS_ROOT)" "$$s"; done

# --- record (no AI) - one target per feature area ----------------------------------
# One capture per workspace; scenes reset what they need in their off-camera setup. Run
# `make seed-workspaces` first (it also resets the workspaces between takes).
record: record-explore record-language record-delivery record-innerloop record-gitops record-ai

record-explore: ## sidebar: tour, namespaces, edit/save, create/delete; scaffold opens a source-only folder
	$(call capture,explore,$(DEMO_WS_ROOT)/explore/url-shortener,cluster,$(DEMO_WS_ROOT)/explore/occ-config,$(NO_AI),$(call pick,explorer-tour switch-namespace edit-and-save create-resource delete-resource))
	$(call capture,explore,$(DEMO_WS_ROOT)/explore/reading-list-service,cluster,$(DEMO_WS_ROOT)/explore/occ-config,$(NO_AI),$(call pick,scaffold-from-source))

record-language: ## OpenChoreo YAML authoring: cluster-aware completions, parameters, hover + outline, validation; CEL and snippets
	$(call capture,language,$(DEMO_WS_ROOT)/language/url-shortener,cluster,,$(LANG_SETTINGS),$(call pick,smart-completions parameter-completions hover-and-outline live-validation))
	$(call capture,language,$(DEMO_WS_ROOT)/language/platform-config,cluster,,$(LANG_SETTINGS),$(call pick,cel-completions bootstrap-snippets))

record-delivery: ## builds, releases, promotion, rollback (sidebar-driven; neutral "services" folder). trigger-build must run right before build-logs.
	$(call capture,delivery,$(DEMO_WS_ROOT)/services,cluster,,$(NO_AI)$(comma)"diffEditor.hideUnchangedRegions.enabled":true,$(call pick,trigger-build build-logs generate-release deploy-release promote deployed-resources compare-releases roll-back run-now failed-build))

record-innerloop: ## linked repo, build this commit, push → build, clone, debug/run against an environment, shell, runtime logs
	$(call capture,innerloop,$(DEMO_WS_ROOT)/innerloop/snip-digest,cluster,$(INNER_OCC),$(INNER),$(call pick,debug-against-env run-locally open-shell runtime-logs))
	$(call capture,innerloop,$(DEMO_WS_ROOT)/innerloop/sample-workloads,cluster,$(INNER_OCC),$(INNER),$(call pick,linked-component))
	$(call capture,innerloop,$(DEMO_WS_ROOT)/innerloop/sample-workloads/service-go-greeter,cluster,$(INNER_OCC),$(INNER),$(call pick,build-this-commit))
	$(call capture,innerloop,$(DEMO_WS_ROOT)/innerloop/sample-workloads/service-go-greeter,cluster,$(INNER_OCC),$(INNER),$(call pick,follow-after-push))
	$(call capture,innerloop,$(DEMO_WS_ROOT)/innerloop/url-shortener.code-workspace,cluster,$(INNER_OCC),$(INNER),$(call pick,clone-source))

record-gitops: ## Flux-managed repo: sync view, save guard, compare both ways, go to definition, releases and promotion in Git
	$(call capture,gitops,$(DEMO_WS_ROOT)/shop-gitops,cluster$(comma)gitops-workspace,$(DEMO_WS_ROOT)/.occ/gitops-demo.config,$(NO_AI),$(call pick,gitops-sync-view gitops-guard compare-with-cluster compare-with-repository go-to-definition gitops-generate-releases gitops-promote))

record-ai: ## AI scenes keep AI features on. The answering scenes need a signed-in Copilot profile: see README
	$(call capture,ai,$(DEMO_WS_ROOT)/ai/snip-api-service,cluster,,"openchoreo.mcp.platformEngineerTools":true$(comma)"chat.titleBar.signIn.enabled":false$(comma)"chat.viewSessions.enabled":false,$(call pick,mcp-servers ai-customizations other-agents chat-add-yaml troubleshoot-build fix-with-copilot))

collect: ## out/raw/<area>/ → out/raw/<id>.{mp4,json} + out/shots/<id>-NN-<label>.png
	@mkdir -p out/raw out/shots; n=0; seen=" "; \
	for d in out/raw/*/; do [ -d "$$d" ] || continue; area=$$(basename "$$d"); \
	  for f in "$$d"*.mp4 "$$d"*.json; do [ -f "$$f" ] || continue; b=$$(basename "$$f"); \
	    case "$$seen" in *" $$b "*) echo "  WARN: $$b is in two areas - $$area/$$b wins" ;; esac; seen="$$seen$$b "; \
	    cp -p "$$f" "out/raw/$$b"; n=$$((n + 1)); \
	  done; \
	  for f in "$$d"*.png; do [ -f "$$f" ] || continue; case "$$f" in *failure*) continue ;; esac; cp -p "$$f" out/shots/; done; \
	done; echo "collected $$n files into out/raw/ (stills in out/shots/)"

# --- post-production -------------------------------------------------------------
timeline: ## clips + marks + motion → video/public/timeline.json (prints each short's length)
	node scripts/tools/build_timeline.mjs --allow-missing

reel: timeline ## highlight reel (scenes with highlight: true) → out/final/demo-16x9.mp4 + demo-9x16.mp4
	$(call RENDER,reel)

tour: timeline ## every feature in one video, a chapter card per storyboard area → out/final/tour-16x9.mp4 + tour-9x16.mp4
	$(call RENDER,tour)

shorts: timeline ## one short per scene → out/final/shorts/<id>-<16x9|9x16|1x1>.mp4
	$(call RENDER,shorts)

gifs: timeline ## README GIFs (clip only, looping, <= GIF_MB) → out/final/gifs/<id>.gif
	$(call RENDER,gifs)

posters: timeline ## key-moment stills → out/final/posters/<id>.png
	$(call RENDER,posters)

# What the repo keeps: 16:9 shorts (re-encoded), a still per scene, the README GIFs, the reel and a
# catalog page, in ../docs/media (the READMEs link there). 9:16/1:1 shorts stay in out/final/.
publish: ## out/final + out/shots → ../docs/media (videos/, screens/, gifs/, README.md)
	node scripts/tools/publish_media.mjs --out ../docs/media --crf 32

render: timeline ## all of the above with one bundle + one browser
	$(call RENDER,all)

# --- check -------------------------------------------------------------------------
frames: ## stills at every cut, camera target and key moment + a contact sheet per video
	@set -e; \
	for v in 16x9 9x16; do [ -f out/final/demo-$$v.mp4 ] && scripts/tools/extract_frames.sh out/final/demo-$$v.mp4 out/frames/reel-$$v out/final/timeline.json; done; \
	for t in out/final/shorts/*.timeline.json; do [ -f "$$t" ] || continue; id=$$(basename "$$t" .timeline.json); \
	  for a in $(ASPECTS); do v=out/final/shorts/$$id-$$a.mp4; [ -f "$$v" ] && scripts/tools/extract_frames.sh "$$v" out/frames/$$id-$$a "$$t"; done; \
	done; true

check: frames ## + black/freeze detection; then LOOK at out/frames/*/contact-sheet.png and the posters
	@mkdir -p out/frames; : > out/frames/issues.txt; \
	if [ -f out/final/demo-16x9.mp4 ]; then echo "# reel" >> out/frames/issues.txt; scripts/tools/detect_issues.sh out/final/demo-16x9.mp4 out/final/timeline.json >> out/frames/issues.txt; fi; \
	for t in out/final/shorts/*.timeline.json; do [ -f "$$t" ] || continue; id=$$(basename "$$t" .timeline.json); \
	  [ -f out/final/shorts/$$id-16x9.mp4 ] && { echo "# $$id"; scripts/tools/detect_issues.sh out/final/shorts/$$id-16x9.mp4 "$$t" 2.0; } >> out/frames/issues.txt; \
	done; cat out/frames/issues.txt

clean: ## generated media only (recordings in out/raw/<area>/ are kept)
	rm -rf out/final out/frames out/shots video/public
	find out/raw -maxdepth 1 -type f \( -name '*.mp4' -o -name '*.json' \) -delete 2>/dev/null || true
