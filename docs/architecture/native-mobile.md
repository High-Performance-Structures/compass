# Native Mobile App

Developer documentation for the Compass iOS and Android implementations.


## Why a WebView wrapper

Compass is deeply server-rendered. Server actions, middleware auth, D1 database access via `getCloudflareContext()` -- the entire data layer assumes it's running on Cloudflare Workers. Frameworks like NextNative require `output: "export"` (static HTML), which would mean rewriting every action, every database call, every auth check. That's not a refactor; it's a rewrite.

Capacitor takes a hybrid approach. The native app bundles a small offline Field Mode -- a WKWebView on iOS and an Android WebView on Android -- then navigates to the live deployment at `compass.openrangeconstruction.ltd` when the service is reachable. The bundled shell is not a static export of Next.js. It is a purpose-built recovery surface for active projects, tasks, schedule items, daily logs, construction documents, and project chat.

The live application remains the complete experience and receives normal Cloudflare deployments immediately. The bundled shell supplies a dependable cold start and durable offline outbox; it also hosts the native capabilities a browser cannot provide reliably, including push notifications, biometric auth, camera access with GPS metadata, offline files, and photo queuing.


## Architecture

The native layer follows one principle: **the web app must never break because of native code**. Every Capacitor plugin import is dynamic (`import()` inside a function or effect), every native API call is gated behind an `isNative()` check, and every component returns `null` on web. A developer who never touches the native code will never be affected by it.

```
┌─────────────────────────────────────────────────┐
│             Bundled Offline Field Shell           │
│  Active work + native outbox + saved documents   │
│  iOS: WKWebView    Android: Android WebView      │
├─────────────────────────────────────────────────┤
│              Bridge Layer (TypeScript)            │
│  platform.ts → isNative() / isIOS() / isAndroid() │
│  use-native.ts → React hook (useSyncExternalStore) │
│  detect-server.ts → server-side UA check          │
├─────────────────────────────────────────────────┤
│              Feature Hooks                        │
│  use-native-push.ts    use-biometric-auth.ts      │
│  use-native-camera.ts  use-photo-queue.ts         │
├─────────────────────────────────────────────────┤
│           Native UI Components                    │
│  BiometricGuard  OfflineBanner  NativeShell       │
│  UploadQueueIndicator  PushNotificationRegistrar  │
├─────────────────────────────────────────────────┤
│              Live Compass Web App                 │
│  Next.js 15 + Cloudflare Workers + D1             │
│  (completely unchanged)                           │
└─────────────────────────────────────────────────┘
```

### Platform detection

Capacitor injects a global `window.Capacitor` object into the WebView before the page loads. The bridge layer reads this to determine the runtime environment.

`src/lib/native/platform.ts` provides four functions:

- `isNative()` -- returns `true` inside Capacitor's WebView, `false` everywhere else
- `isIOS()` / `isAndroid()` -- platform-specific checks
- `getPlatform()` -- returns `"ios"`, `"android"`, or `"web"`

These are plain functions, safe to call anywhere including during SSR (they check for `window` first). The React hook `useNative()` wraps `isNative()` using `useSyncExternalStore` with a server snapshot of `false`, so it works correctly with server components and hydration.

For server-side detection, `src/lib/native/detect-server.ts` exports `isNativeApp(request)`, which checks the User-Agent for `CapacitorApp`. This is useful for suppressing "Add to Home Screen" prompts or adjusting server-rendered HTML for native contexts.

### Dynamic imports

This is the most important safety mechanism. Here's why it matters: Capacitor plugins reference native APIs (like `AVFoundation` on iOS or `android.hardware.camera2` on Android). If you statically import them at the top of a module, the import executes during module evaluation -- including on the web, where those APIs don't exist. The module fails to load, and the entire component tree that depends on it breaks.

Every Capacitor import in the codebase uses this pattern:

```typescript
useEffect(() => {
  if (!native) return

  async function setup() {
    const { PushNotifications } = await import(
      "@capacitor/push-notifications"
    )
    // now safe to use PushNotifications
  }

  setup()
}, [native])
```

The `await import()` only executes when `native` is `true`, meaning Capacitor's runtime is available and the native APIs will resolve. On web, the import never happens.

If you add a new Capacitor plugin, follow this pattern. A static `import { Camera } from "@capacitor/camera"` at the top of a file will work in Xcode and Android Studio, but will break the production web build.


## Capacitor configuration

`capacitor.config.ts` at the repo root controls the native shell behavior.

```typescript
server: {
  allowNavigation: [
    "compass.openrangeconstruction.ltd",
    "api.workos.com",
    "authkit.workos.com",
    "accounts.google.com",
    "login.microsoftonline.com",
  ],
}
```

The default release profile is the bundled offline Field Mode. Run `bun cap:sync` for normal TestFlight and Play builds. The Field Mode backend and native shell must be deployed and released as one compatible contract.

The default `webDir: "mobile-shell"` points Capacitor at the output of `bun run mobile:build`; `bun cap:sync` performs both steps. Omitting `server.url` is intentional: Capacitor opens the bundled `index.html` even when the device has no service. The shell checks `/api/mobile/health` and uses `/dashboard/field` when Compass is available. `COMPASS_MOBILE_MODE=live bun cap:sync` is a developer-only escape hatch for wrapping the full live deployment, not a field release profile.

The live and bundled surfaces share a versioned storage contract. Preferences stores active-project packets and queued daily logs/chat messages. Filesystem stores saved construction documents and photo payloads. Stored documents include source file IDs and MIME types; local copies are disposable and Google Drive remains the source of truth.

`allowNavigation` is the list of domains the WebView is permitted to navigate to after leaving the bundled shell. This matters because Compass and WorkOS SSO redirect through the listed domains. If a new SSO provider is added, add its domain here.


## iOS specifics

### Project structure

```
ios/
├── App/
│   ├── App.xcodeproj/        # Xcode project file
│   ├── App/
│   │   ├── AppDelegate.swift  # application lifecycle
│   │   ├── Info.plist          # permissions, capabilities
│   │   ├── Assets.xcassets/    # app icon, splash screen
│   │   └── Base.lproj/        # storyboards (launch + main)
│   └── CapApp-SPM/
│       └── Package.swift       # Swift Package Manager deps (auto-managed)
└── debug.xcconfig              # debug build settings
```

The `CapApp-SPM/Package.swift` file is managed by `cap sync`. Don't edit it manually -- it gets regenerated every time you sync. It lists all 12 Capacitor plugins as Swift Package Manager dependencies.

### Info.plist permissions

The required usage description keys are already present in `ios/App/App/Info.plist`:

```xml
<key>NSCameraUsageDescription</key>
<string>Compass uses the camera to capture site photos for your construction projects.</string>
<key>NSPhotoLibraryUsageDescription</key>
<string>Compass accesses your photo library to attach existing photos to projects.</string>
<key>NSFaceIDUsageDescription</key>
<string>Compass uses Face ID to keep your project data secure when you return to the app.</string>
```

Apple will reject the app if code accesses one of these protected capabilities without the matching description. Field Mode preserves GPS metadata that is already present in captured images, but it does not request live location and therefore does not declare a location usage key. The strings appear in system permission dialogs, so they must continue to explain *why* the permission is needed in terms the user understands.

### Push notifications (APNs)

iOS push notifications require an APNs key, not a certificate. The key is a `.p8` file generated in the Apple Developer portal under Certificates, Identifiers & Profiles > Keys. One key works for all your apps.

1. Create a key with Apple Push Notifications service (APNs) enabled
2. Download the `.p8` file (you can only download it once)
3. Store the private key as the `APNS_PRIVATE_KEY` Cloudflare secret
4. Store the Key ID and Apple Team ID as `APNS_KEY_ID` and `APNS_TEAM_ID`

Compass sends iOS device tokens directly to APNs. The Firebase project is used only for Android FCM delivery.

The `AppDelegate.swift` already handles Universal Links via `ApplicationDelegateProxy`. For push notification delegate methods, Capacitor's `@capacitor/push-notifications` plugin registers them automatically when the plugin is loaded.

### Building and running

```bash
bunx cap sync ios     # sync web assets + plugin config to Xcode project
bunx cap open ios     # open Xcode
```

In Xcode:
- Select a simulator or connected device
- Set the signing team in Signing & Capabilities
- Press Cmd+R to build and run

For TestFlight / App Store distribution:
- Product > Archive
- Distribute App > App Store Connect
- Upload (requires valid provisioning profile)

### Universal Links

`public/.well-known/apple-app-site-association` tells iOS to open `/dashboard/*` URLs directly in the native app instead of Safari. Replace `TEAM_ID` with your Apple Developer Team ID:

```json
{
  "applinks": {
    "details": [{
      "appID": "78SM7S793Z.com.hpscolorado.compass",
      "paths": ["/dashboard/*"]
    }]
  }
}
```

This file must be served from the web domain with `Content-Type: application/json` and no redirects. Cloudflare Workers handles this correctly by default for files in `public/`.

The bundled Field Mode shell listens for Capacitor `appUrlOpen` events and the cold-start launch URL. It accepts only HTTPS `/dashboard/*` URLs on the exact Compass origin, gates the destination behind the shared biometric lock when required, then navigates the webview to the matching live page while preserving the query and fragment. Native WorkOS password, email-code, and OAuth authentication exchange their sessions through Capacitor HTTP and immediately download `/api/field/native-bootstrap` from the bundled shell. The shell writes the signed-in user's profile, active-project list, and first project packet directly to Capacitor Preferences, avoiding any dependency on plugin access from a hosted page. The hosted mobile navigation uses `compass://field` to return from Full Compass. The native iOS and Android entry points handle that return before forwarding other deep links to Capacitor and reload the configured local start page; this is required because the hosted Full Compass page has replaced the shell and no longer has its JavaScript listener.


## Android specifics

### Project structure

```
android/
├── app/
│   ├── src/main/
│   │   ├── AndroidManifest.xml     # permissions, activity config
│   │   ├── java/.../MainActivity.java
│   │   ├── res/                     # icons, splash, layouts, strings
│   │   └── assets/                  # Capacitor config (auto-generated)
│   ├── build.gradle                 # app-level build config
│   └── capacitor.build.gradle       # Capacitor plugin registrations
├── build.gradle                     # project-level build config
├── capacitor.settings.gradle        # auto-managed plugin includes
├── variables.gradle                 # SDK versions, build tool versions
└── gradle/                          # Gradle wrapper
```

`capacitor.settings.gradle` and `capacitor.build.gradle` are managed by `cap sync`. Like `Package.swift` on iOS, don't edit them manually.

### Permissions

The app manifest declares network access plus the legacy storage permissions needed when `saveToGallery` runs on older Android releases:

```xml
<uses-permission android:name="android.permission.INTERNET" />
<uses-permission android:name="android.permission.POST_NOTIFICATIONS" />
<uses-permission android:name="android.permission.READ_EXTERNAL_STORAGE" android:maxSdkVersion="32" />
<uses-permission android:name="android.permission.WRITE_EXTERNAL_STORAGE" android:maxSdkVersion="29" />
```

The app declares `POST_NOTIFICATIONS` itself so Android 13 and newer can display the runtime notification prompt. Capacitor and the native plugins merge biometric, network-state, foreground-service, and related permissions into the final app manifest. The Camera plugin uses Android's system camera activity and does not require the app to request `CAMERA`. Field Mode preserves GPS metadata already present in the captured image; it does not request live device location.

### Firebase Cloud Messaging (FCM)

Android push notifications go through Firebase Cloud Messaging, even if they originate from APNs on the backend.

1. Create a Firebase project at console.firebase.google.com
2. Add an Android app with package name `com.hpscolorado.compass`
3. Download `google-services.json` and place it at `android/app/google-services.json`. The file is intentionally gitignored; Android release builds fail if it is missing so a notification-registration crash cannot be shipped.
4. The `classpath 'com.google.gms:google-services'` line needs to be added to `android/build.gradle`
5. Add `apply plugin: 'com.google.gms.google-services'` at the bottom of `android/app/build.gradle`

Firebase handles Android delivery only. Compass sends iOS notifications directly to APNs with its Apple provider key.

### Building and running

```bash
bunx cap sync android     # sync web assets + plugin config
bunx cap open android     # open Android Studio
```

In Android Studio:
- Wait for Gradle sync to complete (first time takes a while)
- Select a device or create an AVD (API 24+ required)
- Press the green play button

For Play Store distribution:
- Build > Generate Signed Bundle / APK
- Choose Android App Bundle (.aab) for Play Store uploads
- Sign with your upload keystore

### App Links

`public/.well-known/assetlinks.json` enables Android App Links. Its package name must match `applicationId`, and its SHA-256 fingerprint must match the Play App Signing certificate (or the upload certificate for direct/internal installs):

```bash
# get the fingerprint from your keystore
keytool -list -v -keystore your-keystore.jks \
  -alias your-alias | grep SHA256
```

The fingerprint is a colon-separated hex string like `AA:BB:CC:...`. Preserve the colons in `assetlinks.json`.

Android uses the same exact-origin Field Mode routing described above, so verified links work whether the app is already running or launched from a terminated state.


## Push notifications

### How the system works

The push notification system has three parts: token registration on the client, token storage on the server, and platform-specific notification delivery.

When the live native app starts, the `PushNotificationRegistrar` component (rendered in the dashboard layout) runs the `useNativePush` hook. This hook requests permission, gets a device token from APNs (iOS) or FCM (Android), and POSTs it to `/api/push/register`. The server stores the token in the `push_tokens` table, associated with the current user.

The server dispatches Android tokens through authenticated FCM HTTP v1 and iOS tokens directly through APNs. Android credentials come from a Firebase service-account JSON document. APNs uses an ES256 provider token generated from the Apple key ID, team ID, and private key. Provider credentials remain server-side Cloudflare secrets.

```
Device boots → useNativePush → request permission → get token
  → POST /api/push/register → push_tokens table

Server event → sendPushNotification(userId, title, body, data)
  → query push_tokens → FCM HTTP v1 (Android) or APNs (iOS) → device
```

### Token lifecycle

Tokens are upserted per user and platform. If a user re-installs the app, the old token becomes invalid and the new one replaces it. When FCM returns a 404 for a token (meaning the device unregistered), the send function automatically deletes that token from the database.

On sign-out, the client should call `DELETE /api/push/register` to remove the token, preventing notifications from being sent to a device the user has signed out of.

### Adding push triggers

Call `sendPushNotification` with the Cloudflare environment from a server-only action. Delivery should be scheduled with the request context's `waitUntil` when it does not need to block the response.

```typescript
ctx.waitUntil(
  sendPushNotification(env, {
    userId,
    title: "Project updated",
    body: "A new field update is ready.",
    data: { url: `/dashboard/projects/${projectId}` },
  }),
)
```

The `data.url` field is picked up by the client-side push handler. When the user taps the notification, the app navigates to that URL.


## Biometric auth

Biometric auth exists to protect the app when a user puts it in the background -- particularly relevant on shared devices or job sites where someone might pick up an unlocked phone.

The `BiometricGuard` component wraps the dashboard layout. It listens for `appStateChange` events from `@capacitor/app`. When the app moves to the background, it records the timestamp. When the app returns to the foreground, if more than 30 seconds have elapsed and biometric is enabled, it shows a full-screen blur overlay and triggers the biometric prompt.

Users opt in to biometric auth. On first login in the native app, `BiometricGuard` shows a prompt asking if they want to enable Face ID or fingerprint lock. This prompt only appears once. The preference is stored with Capacitor Preferences so both the bundled Field Mode shell and the live app enforce it; legacy `localStorage` values are migrated automatically. Users can also toggle biometric on or off in Settings > Notifications.

The "Use password" fallback redirects to `/login`, which goes through the normal WorkOS auth flow. This is important -- if biometric fails repeatedly (e.g., the sensor is dirty, the user changed their fingerprint), there must be a way back in.


## Camera and offline photo queue

### Why an offline queue

Construction crews take photos on job sites. Job sites frequently have poor or no cell service. A photo taken with no signal needs to persist on the device, survive the app being killed, and upload automatically when connectivity returns -- potentially hours later.

The system uses three Capacitor plugins to make this work:

- `@capacitor/camera` captures the photo
- `@capacitor/filesystem` saves it to the device's persistent data directory (survives app restarts)
- `@capacitor/preferences` stores the queue metadata (project ID, GPS coordinates, timestamp, upload status)
- `@capgo/capacitor-uploader` handles background uploads using `NSURLSession` on iOS and `WorkManager` on Android -- both continue uploading even if the app is backgrounded or killed
- `@capacitor/network` watches for connectivity changes to trigger upload processing

### Flow

1. User taps "Take Photo" on a project
2. `useNativeCamera` opens the rear camera at 2048px max width
3. Photo is captured with GPS EXIF data extracted
4. `savePhotoToDevice` copies the photo to `compass-photos/` in the app's data directory
5. Queue metadata is written to Preferences
6. When network becomes available, `processQueue` iterates pending items and uploads each one
7. On success, the local file is cleaned up and the queue entry removed
8. On failure, the retry count increments (max 3 before marking as permanently failed)

The `UploadQueueIndicator` component shows queue status: "3 photos pending" when offline, "Uploading 3..." during transfer, or "2 failed - tap to retry" if uploads failed.

### Adding the photo upload endpoint

The photo queue uploads to a URL you configure when calling `usePhotoQueue(uploadUrl)`. You'll need to create a server endpoint or configure an R2 bucket to receive these uploads. The uploader sends the file as a POST with metadata in headers:

- `X-Project-Id` -- which project the photo belongs to
- `X-Photo-Id` -- unique ID for deduplication
- `X-Captured-At` -- ISO timestamp
- `X-GPS-Lat` / `X-GPS-Lng` -- GPS coordinates (if available)


## Development workflow

### Daily development

Web development is unchanged. Run `bun dev` as normal. The native-specific code compiles but doesn't execute on web (every native path returns early).

### Testing native features

```bash
bunx cap sync ios && bunx cap open ios         # Xcode
bunx cap sync android && bunx cap open android # Android Studio
```

`cap sync` does two things: copies the contents of `webDir` (which we don't use since we load remote) and updates the native project's plugin configuration. Run it after installing or removing Capacitor plugins.

### When to run `cap sync`

You need to sync when:
- You add or remove a Capacitor plugin from `package.json`
- You change `capacitor.config.ts`
- You modify native project files that `cap sync` manages (like `Package.swift` or `capacitor.settings.gradle`)

You don't need to sync when:
- You change TypeScript/React code (the native app loads it from the remote URL)
- You deploy to Cloudflare (the native app gets the update automatically)

### When app store updates are required

Most changes don't require a store update. Anything that runs in the WebView (UI changes, new features, bug fixes, API changes) is delivered instantly via `bun deploy`.

You need an app store update when:
- You add a new Capacitor plugin (native code changes)
- You change `capacitor.config.ts` settings that affect the native shell
- You update the splash screen or app icon
- Apple or Google require a new SDK version

This distinction matters for release planning. Web changes can ship immediately. Native changes go through Apple's review process (24-48 hours) and Google's review process (usually faster, but variable).


## App store submission

### Apple (App Store)

**Account setup:**
- Enroll at developer.apple.com ($99/year)
- Create an App ID: `com.hpscolorado.compass`
- Create provisioning profiles for development and distribution
- Create an APNs authentication key

**Required assets:**
- App icon: 1024x1024 PNG, no transparency, no rounded corners (the system adds corner radius)
- Screenshots: iPhone 6.7" (1290x2796), iPhone 6.5" (1284x2778), iPhone 5.5" (1242x2208)
- iPad screenshots if supporting tablet
- Privacy policy URL (required)

**Guideline 4.2 mitigation:**

Apple rejects apps that are "merely a web site bundled as an application." The native features integrated into Compass are specifically chosen to demonstrate native capability: push notifications via APNs, Face ID / Touch ID biometric auth, native camera with GPS metadata, device filesystem for offline photo storage, network status detection, status bar integration, native keyboard handling, and Universal Links. That's eight distinct native integrations, which should be sufficient. If Apple does push back, the offline photo queue is the strongest argument -- it's functionality that genuinely cannot exist in a browser.

### Google (Play Store)

**Account setup:**
- Enroll at play.google.com/console ($25 one-time fee)
- Create an app listing
- Generate a signing keystore (keep it safe -- you can't change it)

**Required assets:**
- App icon: 512x512 PNG
- Feature graphic: 1024x500 PNG
- Screenshots: phone and tablet
- Privacy policy URL

Google's review is generally less strict about WebView apps than Apple's, but the same native features serve as a strong differentiator.


## File reference

### New files

| File | Purpose |
|------|---------|
| `capacitor.config.ts` | Server URL, plugin configuration, platform settings |
| `src/lib/native/platform.ts` | `isNative()`, `isIOS()`, `isAndroid()`, `getPlatform()` |
| `src/lib/native/detect-server.ts` | Server-side User-Agent check for CapacitorApp |
| `src/lib/native/photo-queue.ts` | Offline photo queue (Filesystem + Preferences + Uploader) |
| `src/hooks/use-native.ts` | React hook via `useSyncExternalStore` |
| `src/hooks/use-native-push.ts` | Push token registration, notification tap handling |
| `src/hooks/use-native-camera.ts` | Camera with GPS EXIF extraction |
| `src/hooks/use-biometric-auth.ts` | Biometric availability, authentication, preference storage |
| `src/hooks/use-photo-queue.ts` | Photo queue React hook (capture, queue, auto-upload) |
| `src/components/native/biometric-guard.tsx` | Lock screen overlay, opt-in prompt |
| `src/components/native/offline-banner.tsx` | "You're offline" banner |
| `src/components/native/native-shell.tsx` | Status bar style sync with theme |
| `src/components/native/upload-queue-indicator.tsx` | Pending upload badge |
| `src/app/api/push/register/route.ts` | POST (upsert token), DELETE (remove on sign-out) |
| `src/lib/push/send.ts` | Platform dispatcher for FCM HTTP v1 and direct APNs delivery |
| `src/lib/push/providers.ts` | FCM OAuth/HTTP and APNs provider-token implementations |
| `public/.well-known/apple-app-site-association` | iOS Universal Links configuration |
| `public/.well-known/assetlinks.json` | Android App Links configuration |

### Modified files

| File | Change |
|------|--------|
| `src/db/schema.ts` | Added `pushTokens` table |
| `src/app/dashboard/layout.tsx` | Added BiometricGuard, OfflineBanner, NativeShell, PushRegistrar |
| `src/components/agent/chat-panel-shell.tsx` | Native keyboard height offset |
| `src/components/settings-modal.tsx` | Biometric lock toggle in notifications tab |
| `package.json` | Capacitor dependencies and `cap:sync`/`cap:ios`/`cap:android` scripts |
| `.gitignore` | Native build artifact exclusions |


## Push environment variables

| Variable | Where | Purpose |
|----------|-------|---------|
| `FIREBASE_SERVICE_ACCOUNT_JSON` | Wrangler secret | Firebase service-account JSON used to mint FCM HTTP v1 OAuth tokens |
| `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_PRIVATE_KEY` | Wrangler secrets | APNs token-auth credentials for iOS push delivery |
| `APNS_BUNDLE_ID` | Wrangler variable (optional) | APNs topic; defaults to `com.hpscolorado.compass` |
| `APNS_ENVIRONMENT` | Wrangler variable (optional) | `production` by default; use `development` only for debug-device tokens |

No other environment variables are needed for the native layer. The existing `WORKOS_*` and `OPENROUTER_API_KEY` variables continue to work as before -- they're used by the web app, which the native shell loads remotely.
