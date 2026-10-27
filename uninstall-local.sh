#!/usr/bin/env bash

set -euo pipefail

if ! command -v npm >/dev/null 2>&1; then
  printf 'npm is required but was not found in PATH.\n' >&2
  exit 1
fi

if command -v veymux >/dev/null 2>&1; then
  printf 'Stopping running Veymux service if present...\n'
  veymux --stop >/dev/null 2>&1 || true
fi

printf 'Removing global veymux installation...\n'
npm uninstall -g veymux

printf 'Cleaning local Veymux state...\n'
rm -rf "$HOME/.veymux"

printf '\nDone. veymux has been removed.\n'
