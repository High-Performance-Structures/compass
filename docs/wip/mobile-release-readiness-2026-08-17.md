# Mobile release readiness — 2026-08-17

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
- An APNs authentication key has been created for the HPS Apple team with sandbox and production access; its encrypted Worker-secret installation is pending explicit transmission approval.
- Play App Signing is active. `assetlinks.json` includes both the upload certificate and the Play App Signing certificate (`99:FE:73:BD:...:BC:6C`).

## P0 release blockers

1. Deploy the corrected association files. The live domain still serves the previous package ID and placeholders, so Universal Links and Android App Links cannot verify until the web deployment includes the updated files.
2. Configure push credentials. Add Firebase to the existing `compass-hps` Google Cloud project, register `com.hpscolorado.compass`, add `google-services.json`, and store `FIREBASE_SERVICE_ACCOUNT_JSON` in Cloudflare. Store the newly created Apple key as `APNS_KEY_ID`, `APNS_TEAM_ID`, and `APNS_PRIVATE_KEY` in Cloudflare.
3. Complete Apple signing. Confirm the App Store provisioning profile for team `78SM7S793Z`, the Push Notifications entitlement, and the Associated Domains entitlement, then produce a signed archive and upload it to TestFlight.
4. Select the Play internal-test audience, upload the signed AAB, and roll out the first internal release.
5. Run the physical-device field matrix below. Simulators validate packaging and basic UI, but not camera capture, gallery persistence, biometrics, push delivery, background upload, or low-connectivity behavior.

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
