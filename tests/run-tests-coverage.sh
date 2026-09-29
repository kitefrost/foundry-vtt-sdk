#!/bin/bash
# Run Foundry VTT SDK tests with coverage via c8
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"

cd "$(dirname "$0")/.."
npx c8 --include='scripts/**' --reporter=text node tests/test-sdk.mjs
