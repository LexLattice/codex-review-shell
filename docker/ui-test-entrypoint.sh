#!/usr/bin/env bash
set -euo pipefail

mkdir -p \
  "${HOME}" \
  "${XDG_CONFIG_HOME}" \
  "${XDG_CACHE_HOME}" \
  "${CODEX_TEST_ARTIFACT_DIR}"

screen="${CODEX_TEST_SCREEN:-1600x1050x24}"
runner="${CODEX_TEST_RUNNER_SCRIPT:-/workspace/scripts/direct-container-ui-test-runner.mjs}"

case "${runner}" in
  /workspace/scripts/direct-container-ui-test-runner.mjs|\
  /workspace/scripts/direct-world-manager-sc11-electron-acceptance.mjs)
    ;;
  *)
    echo "Unsupported container UI test runner: ${runner}" >&2
    exit 64
    ;;
esac

exec dbus-run-session -- \
  xvfb-run \
    -a \
    -s "-screen 0 ${screen} -nolisten tcp" \
    node \
    "${runner}"
