# meddl for iPhone / iPad

The same interface as the TV and Windows apps (`apps/tv`), packed into a
native iOS app with [Capacitor](https://capacitorjs.com). The app reaches IPTV
providers itself through Capacitor's native HTTP layer (`CapacitorHttp`), so
no meddl server or computer is needed.

## Build

CI builds it on macOS (`.github/workflows/build.yml`, job `ios`): the TV
client is built, copied to `www/`, `npx cap add ios` creates the Xcode project,
`configure-ios.sh` adjusts it (plain-http streams, orientations, icon) and
`xcodebuild` produces an **unsigned** `meddl-ios-<version>.ipa`
(artifact `meddl-ios`).

## Install without an Apple developer account

The unsigned IPA is signed on the viewer's own computer with their free
Apple ID, for example with [Sideloadly](https://sideloadly.io) (Windows/macOS)
or AltStore. Apple limits such apps to 7 days: re-sign (re-install) every week.
With a paid Apple developer account the same build can go to TestFlight.

## Limits

Playback uses iOS's own player: HLS (`.m3u8`, used for live channels) and
MP4 play; MKV films and DTS sound may not.
