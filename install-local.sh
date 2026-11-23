#!/bin/sh
set -eu

usage() {
  cat <<'EOF'
Usage: ./obsidian-plugin/install-local.sh <production|demo|dev> <vault-path>

Examples:
  ./obsidian-plugin/install-local.sh dev "/"
  ./obsidian-plugin/install-local.sh production "/"
EOF
}

environment=${1:-}
vault_path=${2:-}

if [ -z "$environment" ] || [ -z "$vault_path" ] || [ "$#" -ne 2 ]; then
  usage >&2
  exit 64
fi

case "$environment" in
  production)
    api_base_url='https://api.chromenotepad.com/notes'
    ;;
  demo)
    api_base_url='https://api-demo.chromenotepad.com/notes'
    ;;
  dev)
    api_base_url='http://localhost:8080/notes'
    ;;
  *)
    printf 'Unknown environment: %s\n' "$environment" >&2
    usage >&2
    exit 64
    ;;
esac

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
plugin_dir="$vault_path/.obsidian/plugins/chrome-notepad-sync"

mkdir -p "$plugin_dir"
sed "s|^const API_BASE_URL = .*;|const API_BASE_URL = '$api_base_url';|" \
  "$script_dir/main.js" > "$plugin_dir/main.js"
cp "$script_dir/manifest.json" "$plugin_dir/manifest.json"

printf 'Installed Chrome Notepad Sync for %s at %s\n' "$environment" "$plugin_dir"
printf 'Rreload Obsidian or disable and re-enable Chrome Notepad Sync'
