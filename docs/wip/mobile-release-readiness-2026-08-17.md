# Mobile release readiness — 2026-08-17

> Status updated August 28, 2026. Distribution is public App Store and public
> Google Play, with Compass organization access remaining account-controlled.

This is the shortest path from the current Capacitor apps to field-test and store-ready iOS and Android releases.

## Current state

- The bundled offline Field Mode builds and syncs into both native projects.
- Android lint completes with zero errors. Debug APK, signed release APK, and signed release AAB builds succeed.
- The iOS simulator target builds with all 14 native plugins and launches successfully.
- Fresh-launch smoke tests pass on an iPhone simulator and a Pixel emulator with no app crash or fatal log entry.
- Bundle/application ID is `com.hpscolorado.compass` on both platforms.
- iOS Universal Links and Android App Links are configured in the native projects.
- Dashboard Universal/App Links are routed from both cold and warm Field Mode launches into the matching live Compass page.
- Cached Field Mode data now honors the same biometric opt-in as the live app on cold start and after 30 seconds in the background.
- Full Compass keeps a dedicated Field control that returns native users to the bundled offline shell. CHERISH remains a separate field action and never replaces that control.
- Android disables cleartext traffic and excludes cached project data from cloud backup and device transfer.
- Android declares the Android 13+ notification permission required by the runtime push prompt.
- The server now uses Firebase service-account OAuth for Android FCM delivery and direct APNs provider-token delivery for iOS.
- Production Worker secrets include the APNs key/team credentials and Firebase
  service-account credentials required by the native push providers.
- Firebase project `compass-hps` contains the Android app
  `com.hpscolorado.compass`; the release build includes its local,
  source-controlled-excluded `google-services.json` configuration.
- Play App Signing is active. `assetlinks.json` includes both the upload certificate and the Play App Signing certificate (`99:FE:73:BD:...:BC:6C`).
- The corrected Apple and Android association files are deployed and return
  `200 application/json` from the production domain.
- The production privacy policy and account-deletion information URLs are
  public. Signed-in users can initiate and cancel a reviewed account-deletion
  request from Account Settings.
- Android compiles and targets API 36. Xcode 26 is required for the iOS upload.
- The iOS app target contains the required-reason privacy manifest entries for
  Capacitor Preferences (`CA92.1`) and Filesystem (`C617.1`).
- Signed store candidates build successfully: iOS `1.0` build `38` archives
  with the HPS App Store profile, and Android `1.0.0` version code `18`
  produces signed APK and AAB artifacts targeting API 36.
- A durable WorkOS reviewer identity has access only to the Open Range
  Construction demonstration organization and Apple Review Sample Project.
- Production D1 migration `0139_account_deletion_requests.sql` is applied and
  the reviewed web release is deployed. The public privacy, account-deletion,
  and community-guidelines URLs return `200`; signed-out Account Settings
  redirects to login as expected.
- iOS `1.0` build `38` uploaded successfully and is processing in App Store
  Connect/TestFlight.
- The reviewed web release is deployed as Worker version
  `bc5f2b76-d18e-4fb8-97be-f66e65fbf918`; the final account-deletion
  cancellation uses a pending-state compare-and-set, and native iOS login
  reliably suppresses Google SSO without changing iPhone Safari.
- Google Play has six of 11 initial setup tasks saved. Listing copy, icon,
  feature graphic, and two non-production phone screenshots are staged pending
  the final AI-asset declaration and store-listing save.

## P0 release blockers

1. Complete App Store Connect processing, metadata, privacy, and compliance
   checks for iOS `1.0` build `38`.
2. Select the Play internal-test audience, upload Android `1.0.0` version code
   `18`, and roll out the first internal release.
3. Run the physical-device field matrix below. Simulators validate packaging and basic UI, but not camera capture, gallery persistence, biometrics, push delivery, background upload, or low-connectivity behavior.
4. Complete the public store metadata, privacy disclosures, reviewer access,
   screenshots, and manual-release settings in
   `docs/wip/mobile-store-submission-2026-08-28.md`.

## Physical-device field matrix

Run on at least one supported iPhone and one Android device:

- Fresh install, password sign-in, sign-out, and session restoration.
- Download an assigned project, force offline mode, kill and relaunch the app, and confirm the cached project opens.
- Create a daily log with photos/files offline; restore connectivity and confirm exactly-once sync and attachment cleanup.
- Open a saved construction document offline.
- Send project and direct messages offline; restore service and confirm ordering and no duplicates.
- Enable biometrics; verify cold-start lock, 30-second background lock, retry, and password fallback.
- Accept and deny camera, photo-library, notification, and biometric permissions.
- Receive and tap push notifications from foreground, background, and terminated states.
- Open `/dashboard/*` links from Messages/email into the installed app.
- Validate safe areas, keyboard behavior, rotation, dark mode, large text, and screen-reader labels.

## Release order

1. Merge and deploy the web/mobile contract and association-file corrections.
2. Configure and verify push credentials and delivery on real devices.
3. Complete the physical-device matrix and fix P0/P1 defects.
4. Upload Android to Play internal testing and iOS to TestFlight.
5. Run a small field pilot before production store rollout.
