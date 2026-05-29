#!/bin/bash
# Load nvm and switch to the Node version defined in .nvmrc.
# In CI (e.g. actions/setup-node), Node may already be on PATH without nvm.
set -e

REQUIRED_MAJOR=22

ensure_node_version() {
  if ! command -v node >/dev/null 2>&1; then
    echo "❌ Node.js not found."
    return 1
  fi

  CURRENT_MAJOR=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)

  if [ "$CURRENT_MAJOR" -lt "$REQUIRED_MAJOR" ]; then
    echo "❌ Node.js ${REQUIRED_MAJOR}+ required. Current version: $(node -v)"
    return 1
  fi
}

export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"

if [ -s "$NVM_DIR/nvm.sh" ]; then
  # shellcheck source=/dev/null
  . "$NVM_DIR/nvm.sh"

  if [ -f .nvmrc ]; then
    nvm install
    nvm use
  else
    nvm use 22
  fi

  ensure_node_version
elif command -v node >/dev/null 2>&1; then
  # CI runners often provide Node via actions/setup-node without nvm.
  ensure_node_version
else
  echo "❌ nvm not found. Install nvm: https://github.com/nvm-sh/nvm"
  exit 1
fi
