#!/usr/bin/env bash
# Runs every scripts/*-regression.mjs and reports which ones failed.
# Run through a login shell so the nvm-managed Node 24 (with node:sqlite) is
# on PATH:  bash -l scripts/direct-regression-sweep.sh [output.tsv]
# Compare the FAILED lines with "Known failing checks" in
# docs/DIRECT_DUAL_ENVIRONMENT_AGENTS_MASTER.md.
set -u
cd "$(dirname "$0")/.." || exit 1
out="${1:-/tmp/direct-regression-sweep.tsv}"
logdir="${out%.tsv}-logs"
mkdir -p "$logdir"
: > "$out"
for f in scripts/*-regression.mjs; do
  name=$(basename "$f" .mjs)
  start=$(date +%s)
  timeout 300 node "$f" > "$logdir/$name.log" 2>&1
  code=$?
  printf "%s\t%s\t%s\n" "$code" "$(( $(date +%s) - start ))" "$name" >> "$out"
done
total=$(wc -l < "$out")
failed=$(awk -F'\t' '$1 != 0' "$out" | wc -l)
echo "regressions: $((total - failed)) passed, $failed failed of $total (logs: $logdir)"
awk -F'\t' '$1 != 0 {print "FAILED " $3}' "$out"
