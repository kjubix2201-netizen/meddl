# Android signing

`meddl-test.keystore` is a **test key**, checked in on purpose so every CI
build of the Android TV app has the same signature and can be installed over
the previous version (sideloading via Downloader on Fire TV, ADB, ...).

Because it is public, it proves nothing about who built the APK. Before
publishing to Google Play or the Amazon Appstore:

1. Create a private release key (`keytool -genkeypair ...`) and keep it safe;
   losing it means you can never update the store app again.
2. Add these repository secrets: `MEDDL_ANDROID_KEYSTORE_BASE64` (the
   keystore, base64), `MEDDL_ANDROID_KEYSTORE_PASSWORD`,
   `MEDDL_ANDROID_KEY_ALIAS`, `MEDDL_ANDROID_KEY_PASSWORD`.
   The build workflow then signs with that key instead.

Apps signed with different keys cannot update each other: switching from the
test key to the release key requires uninstalling the test build once.
