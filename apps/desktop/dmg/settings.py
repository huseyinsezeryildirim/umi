# dmgbuild settings for Umi's DMG: drag Umi onto Applications, over background.tiff
# (background.png + @2x, rendered from background.html: 660 × 400, the arrow between the icons).
# Run from the repository root:
#   dmgbuild -s apps/desktop/dmg/settings.py -D app=path/to/Umi.app Umi Umi.dmg
import os.path

app = defines["app"]  # noqa: F821 (dmgbuild provides `defines`)
here = "apps/desktop/dmg"  # dmgbuild runs this file without __file__

format = "UDZO"
files = [app]
symlinks = {"Applications": "/Applications"}
icon = os.path.join(app, "Contents/Resources/icon.icns")

background = os.path.join(here, "background.tiff")
window_rect = ((200, 120), (660, 400))
default_view = "icon-view"
show_status_bar = False
show_tab_view = False
show_toolbar = False
show_pathbar = False
show_sidebar = False
icon_size = 128
text_size = 13
icon_locations = {os.path.basename(app): (180, 200), "Applications": (480, 200)}
