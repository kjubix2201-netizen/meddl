# meddl for Android TV / Google TV / Fire TV

A thin Android shell around the meddl TV client (`apps/tv`). It shows the TV
client full screen in a WebView, starts from the Android TV / Fire TV home
screen (leanback banner) and maps the remote:

| Remote | TV client receives |
| --- | --- |
| D-pad, OK | arrow keys, Enter (WebView default) |
| Back | `BrowserBack` / 461, on the start screen the app closes |
| Play, Pause, Play/Pause | 415 / 19 (toggle decided from the video state) |
| Stop, Rewind, Fast-forward | 413 / 412 / 417 |

The page is served from `https://appassets.androidplatform.net`, so it has a
stable origin for its local data (IndexedDB) and for CORS against the meddl
backend.

## Backend

Like the LG build, the TV client talks to IPTV providers through a meddl
backend (`apps/web-backend`, also part of the Docker image). The backend must
list the app's origin in `CLIENT_URL`:

```
CLIENT_URL=...,https://appassets.androidplatform.net
```

`pnpm run serve:tv` / `nx serve web-backend` already include it. On the TV,
enter the backend as `http://<PC-or-NAS-IP>:3333` (never `localhost`, that is
the TV itself).

## Build

CI (`.github/workflows/build.yml`, job `android-tv`) builds the TV client,
copies `dist/apps/tv` to `app/src/main/assets/www` and runs
`./gradlew assembleRelease`. Locally (needs JDK 17 and the Android SDK):

```sh
pnpm nx build tv
rm -rf apps/android-tv/app/src/main/assets/www
cp -r dist/apps/tv apps/android-tv/app/src/main/assets/www
cd apps/android-tv && ./gradlew assembleRelease
```

Signing: see [signing/README.md](signing/README.md).

## Install on Fire TV (sideload)

1. Fire TV: Settings → My Fire TV → Developer options → enable
   "Install unknown apps" for the Downloader app (install Downloader first).
2. In Downloader, open the APK link (for example from the GitHub release).
3. Install, then start meddl from "Your apps".

On Android / Google TV: install via a file manager, `adb install`, or the
"Send files to TV" app.
