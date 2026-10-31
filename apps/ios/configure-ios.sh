#!/usr/bin/env bash
# Adjusts the Xcode project Capacitor generated (npx cap add ios) for meddl:
# plain-http streams and pictures (IPTV providers), any orientation, app icon,
# version. Run from apps/ios after "npx cap add ios" on macOS.
set -euo pipefail
plist=ios/App/App/Info.plist
pb=/usr/libexec/PlistBuddy
set_key() { "$pb" -c "Delete :$1" "$plist" >/dev/null 2>&1 || true; "$pb" -c "Add :$1 $2 $3" "$plist"; }

set_key CFBundleDisplayName string meddl
# IPTV providers serve lists, logos and streams over plain http.
"$pb" -c "Delete :NSAppTransportSecurity" "$plist" >/dev/null 2>&1 || true
"$pb" -c "Add :NSAppTransportSecurity dict" "$plist"
# Only this key: with ...InWebContent / ...ForMedia present, iOS ignores it,
# and the native HTTP layer (provider lists over http) would be blocked.
"$pb" -c "Add :NSAppTransportSecurity:NSAllowsArbitraryLoads bool true" "$plist"
# Sound keeps playing when the screen locks.
"$pb" -c "Delete :UIBackgroundModes" "$plist" >/dev/null 2>&1 || true
"$pb" -c "Add :UIBackgroundModes array" "$plist"
"$pb" -c "Add :UIBackgroundModes:0 string audio" "$plist"
# Portrait and landscape on iPhone and iPad.
for key in UISupportedInterfaceOrientations UISupportedInterfaceOrientations~ipad; do
    "$pb" -c "Delete :$key" "$plist" >/dev/null 2>&1 || true
    "$pb" -c "Add :$key array" "$plist"
    i=0
    for o in UIInterfaceOrientationPortrait UIInterfaceOrientationLandscapeLeft UIInterfaceOrientationLandscapeRight UIInterfaceOrientationPortraitUpsideDown; do
        "$pb" -c "Add :$key:$i string $o" "$plist"
        i=$((i + 1))
    done
done
set_key UIStatusBarStyle string UIStatusBarStyleLightContent
set_key UIViewControllerBasedStatusBarAppearance bool false
set_key UIFileSharingEnabled bool false

# App icon: one 1024 px picture, Xcode makes the rest.
icons=ios/App/App/Assets.xcassets/AppIcon.appiconset
rm -f "$icons"/*.png
cp resources/AppIcon-1024.png "$icons/AppIcon-512@2x.png"
cat > "$icons/Contents.json" <<'JSON'
{
  "images" : [
    { "filename" : "AppIcon-512@2x.png", "idiom" : "universal", "platform" : "ios", "size" : "1024x1024" }
  ],
  "info" : { "author" : "xcode", "version" : 1 }
}
JSON
echo "Configured $(/usr/libexec/PlistBuddy -c 'Print :CFBundleDisplayName' "$plist")."
