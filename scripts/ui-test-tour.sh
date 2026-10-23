#!/bin/zsh
# Drives the real app: opens the launcher, clicks Next through the whole first-run tour
# with real mouse events, and checks the launcher stays open and the tour completes.
# Needs Accessibility permission for the terminal running it. Don't touch the mouse.
set -euo pipefail
here=$(cd $(dirname $0) && pwd)
tool=/tmp/umi-uitool
swiftc -O "$here/uitool/main.swift" -o $tool
app=${UMI_APP:-$HOME/Library/Developer/Xcode/DerivedData/Umi-cli/Build/Products/Debug/Umi.app}

pkill -x Umi || true; sleep 1
defaults write cam.umi.app onboardingStep -int 0
open "$app"; sleep 3
$tool notify cam.umi.debug.toggleLauncher; sleep 1.5

for step in 1 2 3 4 5; do
  callout=$($tool windows | grep "layer=102" | head -1 || true)
  [[ -z $callout ]] && { echo "FAIL: no callout at step $step"; exit 1; }
  $tool windows | grep -q "layer=25" || { echo "FAIL: launcher closed at step $step"; exit 1; }
  x=$(echo $callout | sed -E 's/.* x=(-?[0-9]+).*/\1/'); y=$(echo $callout | sed -E 's/.* y=(-?[0-9]+).*/\1/'); h=$(echo $callout | sed -E 's/.* h=([0-9]+).*/\1/')
  # Next sits at the card's bottom-right; the card follows the arrow when it points left (step 3).
  if [[ $step == 3 ]]; then nx=$((x + 404)); else nx=$((x + 312)); fi
  $tool click $nx $((y + h - 70)); sleep 1.2
done

[[ $(defaults read cam.umi.app onboardingStep) == 99 ]] || { echo "FAIL: tour not finished"; exit 1; }
$tool windows | grep -q "layer=25" || { echo "FAIL: launcher closed after tour"; exit 1; }
echo "PASS: tour completes, launcher stays open"
