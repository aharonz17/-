#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"
node -e "const [a,b]=process.versions.node.split('.').map(Number);process.exit(a>22||(a===22&&b>=13)?0:1)" || { echo "Node.js 22.13+ required: https://nodejs.org"; exit 1; }
node scripts/prepare.mjs
( sleep 3; (xdg-open http://localhost:3000 || open http://localhost:3000) >/dev/null 2>&1 ) &
npm start
