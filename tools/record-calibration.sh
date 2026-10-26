#!/bin/sh
# Rewrites docs/venture-engine-calibration-latest.txt: every venture case, seeds 1-40 and then seeds 101-140, in the order players see them.
# Usage: sh tools/record-calibration.sh   (takes a few minutes)
cd "$(dirname "$0")/.." || exit 1
out=docs/venture-engine-calibration-latest.txt
{
  echo "Venture engine calibration (src/venture), the real engine reading scenarios/*.venture.json."
  echo "Reproduce: node src/calibrate.ts [--scenario scenarios/<case>.venture.json] [--seeds 40] [--from 101]"
  echo "The prototype record the spec was written from is docs/venture-calibration-latest.txt (the two product-manager cases only)."
  echo "The engine plays by the rules a player does: a bot may not drop an item that is already live, which the prototype let it do. That moved the evidence-led mean in The Leaky Funnel from 92.9 to 92.8."
  echo "The first two cases are the product-manager ones. The other six were written after the engine existed: their expected ranges were set before the first run, from those two cases, and any that was moved after seeing results is listed under \"Ranges revised\" for that case."
  echo "No human has played any of them. Scripted managers separating the way the rubric intends is a check on the rubric's arithmetic, not evidence that it measures good management."
  for f in the-leaky-funnel good-better-best eighteen-months both-sides debt-due one-platform seven-taps every-rider; do
    held="not used when the ranges were written or revised"
    case "$f" in the-leaky-funnel|good-better-best) held="seen under the first weights, so not fully held out for the reweighting";; esac
    echo
    echo "=== seeds 1-40 ==="
    node src/calibrate.ts --scenario "scenarios/$f.venture.json"
    echo
    echo "=== held-out seeds 101-140 ($held) ==="
    node src/calibrate.ts --scenario "scenarios/$f.venture.json" --from 101
  done
} > "$out.tmp" && mv "$out.tmp" "$out"
