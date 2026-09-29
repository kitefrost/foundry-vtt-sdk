#!/bin/bash
# Load nvm if present (needed when Node is not on PATH globally)
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"

cd "$(dirname "$0")/.."
node tests/test-sdk.mjs
