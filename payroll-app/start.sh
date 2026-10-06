#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"
[ -d node_modules ] || npm install
[ -f .next/BUILD_ID ] || npm run build
( sleep 3; (xdg-open http://localhost:3000 || open http://localhost:3000) >/dev/null 2>&1 ) &
npm start
