#!/bin/bash
# usage: tools/shot.sh <name> <route> [height] [width]   -> writes $SHOTS/<name>.png (headless Chrome)
set -e
cd "$(dirname "$0")/.."
OUT="${SHOTS:-/tmp}"; H="${3:-820}"; W="${4:-1300}"
.venv/bin/python tools/preview.py "$OUT/$1.html" "$2" "$H" >/dev/null
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --disable-gpu --hide-scrollbars \
  --window-size=$W,$((H+20)) --virtual-time-budget=5000 --screenshot="$OUT/$1.png" "file://$OUT/$1.html" >/dev/null 2>&1
echo "$OUT/$1.png"
