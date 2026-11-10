#!/usr/bin/env bash
# Rebuilds public/assets/stashbox.css, the StashDB look used by the scene result page, from a
# stash-box checkout (its frontend/node_modules must be installed). usage: scripts/build-stashbox-css.sh ~/stash-box
set -euo pipefail
box=${1:?path to a stash-box checkout}
out=$(dirname "$0")/../public/assets/stashbox.css
entry=$(mktemp --suffix=.scss)
trap 'rm -f "$entry"' EXIT
cat > "$entry" <<'EOF'
@import "styles/theme";
@import "components/fragments/styles";
@import "components/image/styles";
@import "pages/scenes/styles";
// page containers live in App.scss upstream, which also pulls in every other page
.MainContent { padding-top: 2rem; padding-bottom: 1rem; }
.NarrowPage { margin: auto; max-width: 1200px; }
EOF
{
  echo "/* StashDB's look for the scene page: stash-box $(git -C "$box" rev-parse --short HEAD), built by scripts/build-stashbox-css.sh */"
  # sass emits a byte-order mark in place of @charset, which would corrupt the first selector
  "$box/frontend/node_modules/.bin/sass" --no-source-map --style=compressed --quiet \
    --load-path="$box/frontend/node_modules" --load-path="$box/frontend/src" "$entry" | sed '1s/^\xEF\xBB\xBF//'
} > "$out"
echo "wrote $out ($(wc -c < "$out") bytes)"
