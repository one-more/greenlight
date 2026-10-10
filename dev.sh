#!/bin/bash
set -euo pipefail

cd "$(dirname "$0")"

corepack enable
export YARN_IGNORE_PATH=1
yarn

electron_app="node_modules/electron/dist/Electron.app"
local_network_reason="Greenlight streams video and controller input from your Xbox on the local network."

set_plist_string() {
  local plist="$1"
  local key="$2"
  local value="$3"
  if plutil -extract "$key" raw "$plist" >/dev/null 2>&1; then
    plutil -replace "$key" -string "$value" "$plist"
  else
    plutil -insert "$key" -string "$value" "$plist"
  fi
}

if [[ -d "$electron_app" ]]; then
  while IFS= read -r plist; do
    set_plist_string "$plist" CFBundleName Greenlight
    set_plist_string "$plist" CFBundleDisplayName Greenlight
    set_plist_string "$plist" NSLocalNetworkUsageDescription "$local_network_reason"
    set_plist_string "$plist" LSApplicationCategoryType public.app-category.games
    if plutil -extract NSBonjourServices raw "$plist" >/dev/null 2>&1; then
      plutil -replace NSBonjourServices -json '["_greenlight._tcp"]' "$plist"
    else
      plutil -insert NSBonjourServices -json '["_greenlight._tcp"]' "$plist"
    fi
  done < <(find "$electron_app" -name Info.plist)

  find "$electron_app" -name '*.app' -print | awk '{ print length($0) "\t" $0 }' | sort -nr | cut -f2- | while IFS= read -r nested_app; do
    codesign --force --sign - "$nested_app"
  done
fi

# Next's dev server misses pages whose filenames contain brackets until
# those files change. Touching them after the server is up registers
# /stream/[serverid] and the other dynamic routes.
(
  for _ in $(seq 1 60); do
    if curl -sf -o /dev/null "http://127.0.0.1:8888/home"; then
      touch \
        packages/desktop/renderer/pages/stream/\[serverid\].tsx \
        packages/desktop/renderer/pages/profile/\[xuid\].tsx \
        packages/desktop/renderer/pages/xcloud/info/\[titleid\].tsx \
        packages/desktop/renderer/pages/achievements/\[titleid\].tsx
      break
    fi
    sleep 0.5
  done
) &

yarn desktop dev
