#!/usr/bin/env bash
# Puts a build on the public update channel the apps check for a new version
# (kjubix2201-netizen/meddl-updates, release "latest"): the file under a fixed
# name plus <platform>.json with the build number and the download address.
# The file goes up first, so the description never points to a missing file.
# Needs GH_TOKEN = the MEDDL_UPDATES_TOKEN secret (contents: write on that
# repository only); without it nothing is published.
#
# Usage: publish-updates.sh android|windows|ios <file>
set -euo pipefail
platform="$1"
file="$2"
repo=kjubix2201-netizen/meddl-updates
tag=latest
if [ -z "${GH_TOKEN:-}" ]; then
    echo "MEDDL_UPDATES_TOKEN is not set – the update channel is left as it is."
    exit 0
fi
case "$platform" in
    android) name=meddl-tv.apk ;;
    windows) name=meddl-windows-setup.exe ;;
    ios) name=meddl-ios.ipa ;;
    *) echo "Unknown platform $platform" >&2; exit 1 ;;
esac
[ -f "$file" ] || { echo "Missing $file" >&2; exit 1; }

# A release needs a first commit in the (new, empty) repository.
if ! gh api "repos/$repo/commits?per_page=1" >/dev/null 2>&1; then
    readme=$(printf '# meddl – Updates\n\nNeueste Versionen der meddl-Apps (Android TV / Fire TV, Windows, iPhone). Die Apps prüfen hier, ob es eine neue Version gibt.\n' | base64 -w0)
    echo "Empty update repository: adding a README as its first commit."
    gh api -X PUT "repos/$repo/contents/README.md" -f message="Update-Kanal" -f content="$readme" >/dev/null || true
    sleep 3
fi
if ! gh release view "$tag" -R "$repo" >/dev/null 2>&1; then
    # Several jobs may get here at once; a lost race is fine.
    gh release create "$tag" -R "$repo" --title "meddl – neueste Version" \
        --notes "Wird bei jedem Update automatisch ersetzt. Android TV / Fire TV: meddl-tv.apk · Windows: meddl-windows-setup.exe · iPhone: meddl-ios.ipa (unsigniert, mit Sideloadly installieren)." \
        >/dev/null || true
    sleep 3
fi

work=$(mktemp -d)
cp "$file" "$work/$name"
cat >"$work/$platform.json" <<JSON
{
  "build": ${MEDDL_BUILD:-0},
  "commit": "${GITHUB_SHA:-}",
  "date": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "file": "$name",
  "url": "https://github.com/$repo/releases/download/$tag/$name",
  "size": $(stat -c %s "$file")
}
JSON
gh release upload "$tag" -R "$repo" "$work/$name" --clobber
gh release upload "$tag" -R "$repo" "$work/$platform.json" --clobber
echo "Update channel: build ${MEDDL_BUILD:-0} for $platform → https://github.com/$repo/releases/tag/$tag"
