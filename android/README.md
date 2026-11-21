# Shoga Viewer Android module (v1)

This is an Android-specific, offline image viewer within the existing Shoga Viewer repository. The existing ChromeOS/web sources are unchanged. It is not a full feature-parity port of the ChromeOS app.

## Scope

- Open one or more local images using Android's system document picker.
- View supported image files offline and navigate between them.
- Pinch to zoom, drag while zoomed, double-tap to reset, and swipe between images at normal scale.
- No network permission, analytics, advertising SDK, in-app purchases, or broad storage permission.
- No sample filler app or separate Play Console application.

## Build prerequisites (free)

- JDK 17
- Android SDK platform 36 and build tools
- Gradle 8.13
- Android Gradle Plugin 8.13.2 (downloaded by Gradle)

Run the Android build from this android directory with an installed Gradle 8.13. Keep SDK, Gradle caches, builds, and all temporary files inside the approved project directory. Do not invoke GitHub Actions.

For Play internal testing, generate a signed release Android App Bundle (AAB) with a private upload key kept outside the repository and verify it on a physical Android device before uploading. Do not commit keys, signed bundles, or machine-specific paths.

## Packaging

The proposed package ID is com.hyonimix.shogaviewer and must be verified against the existing Play Console app record **before the first upload**, because package IDs are permanent. Version code is 1.

## Limitations

Jellyfin streaming, FFmpeg.wasm transcoding, bookmarks, folder recursion, and the advanced image shaders from the ChromeOS version are **not** provided in this Android v1 module. This release may only be published as an internal test after behavior and disclosure have been reviewed.

## Verification gate

1. Compile an API 36 release and inspect its package name, minSdk, targetSdk, permissions, and signature.
2. Install on the connected Android device; test image selection, next/previous, pinch zoom, panning, double tap, orientation change, and error handling.
3. Confirm local media remains on-device and no remote services are contacted.
4. Upload only a verified AAB to the existing Shoga Viewer app's internal-test track.
5. Recheck account inactivity policy status after Google processes the release.
