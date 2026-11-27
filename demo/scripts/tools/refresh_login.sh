#!/usr/bin/env bash
# Refresh the access token stored in an occ config file, so VS Code starts a capture with a valid
# login (client-credentials tokens last an hour; an expired one can leave the extension showing
# "Session expired" at startup).
#
#   refresh_login.sh <occ-config> [occ-binary]
set -euo pipefail
cfg=$1
occ=${2:-occ}
[ -f "$cfg" ] || { echo "no occ config at $cfg" >&2; exit 1; }
home=$(mktemp -d)
mkdir "$home/.openchoreo"
cp "$cfg" "$home/.openchoreo/config"
# Any authenticated call makes occ mint a new token and write it back to its config.
if HOME="$home" "$occ" namespace list >/dev/null 2>&1; then
  cp "$home/.openchoreo/config" "$cfg"
else
  echo "warn: occ could not refresh the login in $cfg" >&2
fi
rm -f "$home/.openchoreo/config"
rmdir "$home/.openchoreo" "$home"
