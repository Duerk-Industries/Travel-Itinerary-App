#!/usr/bin/env bash
set -euo pipefail

require_github_actor() {
  local dry_run="${1:-0}"
  if [[ "$dry_run" == "1" || "$dry_run" == "true" ]]; then
    return 0
  fi
  local actor="${GITHUB_ACTOR:-}"
  if [[ -z "$actor" ]]; then
    echo "ERROR: GITHUB_ACTOR is required; run production-affecting scripts through workflow_dispatch." >&2
    exit 1
  fi
  case "$actor" in
    Bryan|bryan|Tristan|tristan|duerk-industries|bduerk)
      return 0
      ;;
    *)
      echo "ERROR: GitHub actor '$actor' is not authorized for production deploy operations." >&2
      exit 1
      ;;
  esac
}
