#!/bin/zsh
# Drives the editor with real mouse/keyboard events on a copy of a recording and checks
# the saved edits after each step. Needs Accessibility permission for the terminal.
# Don't touch the mouse while it runs; it stops if Umi isn't the frontmost app.
#
#   scripts/ui-test-editor.sh [/path/to/Recording.umi]   (default: the synthetic fixture)
set -uo pipefail
here=$(cd $(dirname $0) && pwd)
src=${1:-/tmp/umi-fixtures/Fixture.umi}
work=/tmp/umi-uitest/Test.umi
tool=/tmp/umi-uitool
app=${UMI_APP:-$HOME/Library/Developer/Xcode/DerivedData/Umi-cli/Build/Products/Debug/Umi.app}
swiftc -O "$here/uitool/main.swift" -o $tool || exit 1

rm -rf /tmp/umi-uitest && mkdir -p /tmp/umi-uitest && cp -R "$src" $work
python3 -c "import json; p='$work/project.json'; d=json.load(open(p)); d.pop('edit',None); json.dump(d,open(p,'w'))"
duration=$(python3 -c "import json; print(json.load(open('$work/project.json'))['duration'])")

pkill -x Umi; sleep 1
UMI_OPEN_EDITOR=$work "$app/Contents/MacOS/Umi" >/tmp/umi-uitest/app.log 2>&1 &
sleep 4
osascript -e 'tell application "System Events" to tell (first process whose name is "Umi") to set frontmost to true' -e 'delay 0.4' \
  -e 'tell application "System Events" to tell (first process whose name is "Umi") to set position of window "Test" to {100, 60}' \
  -e 'tell application "System Events" to tell (first process whose name is "Umi") to set size of window "Test" to {1400, 900}' >/dev/null

# Layout of a 1400×900 editor at (100,60): timeline tracks start at x=204 and are 928 pt wide.
x0=204; scale=$(python3 -c "print(928/$duration)")
at() { python3 -c "print(int($x0 + $1 * $scale))"; }   # x for an output time
row_clips=590; row_zoom=634; row_scenes=671; row_masks=708; row_text=745
fails=0
edit() { python3 -c "import json; e=json.load(open('$work/project.json')).get('edit',{}); print($1)"; }
check() { if [[ "$2" == "$3" ]]; then echo "PASS $1"; else echo "FAIL $1: got '$2', want '$3'"; fails=$((fails+1)); fi; }
front() { [[ "$($tool frontmost)" == "Umi" ]] || { echo "ABORT: Umi is not frontmost"; exit 2; }; }

front
# Click an empty track to seek, then S splits there.
mid=$(python3 -c "print($duration/2)")
$tool click $(at $mid) $row_scenes; sleep 0.8; $tool key 1; sleep 1.5
check "S splits at the playhead" "$(edit "len(e.get('clips',[]))")" "2"

front
# Select the second clip, set 2× from the picker.
$tool click $(at $(python3 -c "print($duration*0.75)")) $row_clips; sleep 1
$tool click 1241 165; sleep 0.8; $tool key 19; sleep 0.3; $tool key 36; sleep 1.5
check "speed picker sets 2×" "$(edit "e['clips'][1]['speed']")" "2"

front
# Undo the speed change.
$tool cmdkey 6; sleep 1.5
check "⌘Z undoes" "$(edit "e['clips'][1].get('speed', 1)")" "1"

front
# Add a mask at the playhead, drag it, delete it with Backspace.
$tool key 53; sleep 0.3; $tool click 190 $row_masks; sleep 1.5
check "+ adds a mask" "$(edit "len(e.get('masks',[]))")" "1"
before=$(edit "round(e['masks'][0]['rect'][0][0],2)")
cx=$(python3 -c "print(366 + 0.5*507)"); cy=$(python3 -c "print(142 + 0.45*329)")
$tool drag $cx $cy $((cx+100)) $cy; sleep 1.2
after=$(edit "round(e['masks'][0]['rect'][0][0],2)")
check "dragging the mask box moves it right" "$(python3 -c "print($after > $before)")" "True"
$tool key 51; sleep 1.2
check "Backspace deletes the selected mask" "$(edit "len(e.get('masks',[]))")" "0"

front
# Text from the track menu.
$tool click 185 $row_text; sleep 0.8; $tool key 125; sleep 0.2; $tool key 125; sleep 0.2; $tool key 36; sleep 1.5
check "Text menu adds a lower third" "$(edit "e['texts'][0]['style']")" "lowerThird"

front
# Z adds a zoom; Z again inside it selects instead of stacking.
$tool key 53; sleep 0.3; zooms=$(edit "len(e.get('zoom',{}).get('segments',[]))")
$tool key 6; sleep 1.2; $tool key 6; sleep 1.2
check "Z twice doesn't stack zooms" "$(python3 -c "print($(edit "len(e['zoom']['segments'])") <= $zooms + 1)")" "True"

pkill -x Umi
echo; [[ $fails == 0 ]] && echo "ALL PASSED" || { echo "$fails FAILED"; exit 1; }
