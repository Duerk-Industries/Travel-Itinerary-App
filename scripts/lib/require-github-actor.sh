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
  # Bryan|bryan|Tristan|tristan never matched anything workflow_dispatch actually sets
  # (github.actor is the real GitHub login — bryanduerk / tristanduerk here, not a bare first
  # name), so this check has been unconditionally rejecting every CI-driven production deploy
  # since it was written. Matched against the real usernames now; kept case-insensitive in case
  # GitHub ever normalizes casing differently than expected.
  case "${actor,,}" in
    bryanduerk|tristanduerk)
      return 0
      ;;
    *)
      echo "ERROR: GitHub actor '$actor' is not authorized for production deploy operations." >&2
      exit 1
      ;;
  esac
}
