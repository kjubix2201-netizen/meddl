#!/usr/bin/env bash
# Puts the given build files on the "latest-build" pre-release (master builds
# only), replacing files of the same name. Release files do not count against
# the Actions artifact storage quota, so downloads stay available even when
# that quota is full. Needs GH_TOKEN with contents: write.
set -euo pipefail
tag=latest-build
if [ "$#" -eq 0 ]; then
    echo "No files to publish." >&2
    exit 1
fi
if ! gh release view "$tag" >/dev/null 2>&1; then
    # Several jobs may get here at once; a lost race is fine.
    gh release create "$tag" --prerelease --target "${GITHUB_SHA}" \
        --title "Neueste Version (automatisch)" \
        --notes "Wird bei jedem Update automatisch ersetzt: Windows-Installer (.exe), Android-TV-/Fire-TV-App (.apk) und iPhone-App (.ipa, unsigniert – mit Sideloadly und eigener Apple-ID installieren)." \
        >/dev/null 2>&1 || true
    sleep 3
fi
gh release upload "$tag" "$@" --clobber
echo "Published to https://github.com/${GITHUB_REPOSITORY}/releases/tag/${tag}:"
printf '  %s\n' "$@"
