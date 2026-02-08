Mobile Module
===

The mobile module wraps Compass in a native iOS and Android app using Capacitor. It's not a separate codebase or a React Native port -- it's a WebView that loads the live Cloudflare deployment. The native layer adds device-specific capabilities: biometric authentication, push notifications, camera access with GPS tagging, offline photo queuing, and status bar theming.

The fundamental design principle: **the web app must never break because of native code.** Every Capacitor import is dynamic (`await import()`), every native feature is gated behind `isNative()` checks, and every native component returns `null` on web. If Capacitor isn't present, the app works exactly as it does in a browser.


platform detection
---

`src/lib/native/platform.ts` provides the detection layer. It checks for the `Capacitor` global that the native runtime injects before hydration:

```typescript
function getCapacitor(): CapacitorGlobal | undefined {
  if (typeof window === "undefined") return undefined
  return (window as unknown as Record<string, unknown>)
    .Capacitor as CapacitorGlobal | undefined
}

export function isNative(): boolean {
  return getCapacitor()?.isNative ?? false
}

export function isIOS(): boolean {
  return getCapacitor()?.getPlatform() === "ios"
}

export function isAndroid(): boolean {
  return getCapacitor()?.getPlatform() === "android"
}
```

The key detail: `isNative()` returns `false` on the server (no `window`), `false` in a normal browser (no `Capacitor` global), and `true` only in the native WebView. This three-way distinction matters for SSR -- server-rendered HTML assumes web, and the native state is only known after hydration.

There's also `src/lib/native/detect-server.ts` for server-side detection via User-Agent:

```typescript
export function isNativeApp(request: Request): boolean {
  const ua = request.headers.get("user-agent") ?? ""
  return ua.includes("CapacitorApp")
}
```


the useNative hook
---

`src/hooks/use-native.ts` wraps platform detection in a React hook using `useSyncExternalStore`. The snapshot never changes after initial load (Capacitor injects before hydration), so the hook is stable.

```typescript
export function useNative(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}
```

`getServerSnapshot` returns `false` (SSR assumes web). `getSnapshot` returns `isNative()`. The `subscribe` function is a no-op because the value never changes after mount.

Every native feature checks `useNative()` before attempting to load Capacitor plugins. This is the gate that prevents web breakage.


native hooks
---

Each native capability has its own hook:

**`use-native-push.ts`** -- push notification registration. On mount (if native), requests notification permissions, registers with APNS/FCM, listens for token registration events, and POSTs the token to `/api/push/register`. Also handles foreground notifications and deep-linking when a notification is tapped.

```typescript
const actionListener = await PushNotifications.addListener(
  "pushNotificationActionPerformed",
  (action) => {
    const url = action.notification.data?.url
    if (typeof url === "string" && url.startsWith("/")) {
      router.push(url)
    }
  },
)
```

**`use-native-camera.ts`** -- camera access with EXIF extraction. Captures photos at 85% quality, 2048px width, saves to gallery, extracts GPS coordinates and timestamp from EXIF data.

**`use-biometric-auth.ts`** -- Face ID / fingerprint authentication. Checks device capability on mount, manages enabled/prompted state in localStorage, provides `authenticate()` that calls `NativeBiometric.verifyIdentity`. The biometric lock activates after the app has been backgrounded for 30+ seconds.

**`use-photo-queue.ts`** -- the most complex hook. Combines camera capture with offline-resilient upload. Takes a photo, saves it to the device filesystem, adds metadata to the queue, and auto-uploads when connectivity returns. Listens for network state changes via `@capacitor/network`.

```typescript
const takeAndQueuePhoto = useCallback(
  async (projectId: string): Promise<CapturedPhoto | null> => {
    const photo = await takePhoto()
    if (!photo) return null
    const id = nanoid()
    const fileName = `${id}.${photo.format}`
    const localPath = await savePhotoToDevice(photo.uri, fileName)
    await addToQueue({
      id, projectId, localPath, fileName,
      lat: photo.exifData.lat, lng: photo.exifData.lng,
      capturedAt: new Date().toISOString(),
    })
    await refresh()
    return photo
  },
  [takePhoto, refresh],
)
```


offline photo queue
---

`src/lib/native/photo-queue.ts` is the persistence layer for photos captured on jobsites with spotty connectivity. It uses Capacitor's `Preferences` plugin (key-value storage that survives app kill) to track queue metadata, and the `Filesystem` plugin to store actual photo files in the app's data directory.

The queue lifecycle:

1. **Capture**: Photo is taken, copied to `compass-photos/{id}.{format}` in the app's data directory
2. **Queue**: Metadata (project ID, GPS coords, timestamp, file path) added to the queue with `pending` status
3. **Upload**: When online, `processQueue()` iterates pending items, uses `@capgo/capacitor-uploader` to POST each file with metadata headers
4. **Cleanup**: Successfully uploaded photos are deleted from the filesystem and removed from the queue
5. **Retry**: Failed uploads get retried up to 3 times. After that, they stay in `failed` status until manually retried

```typescript
await Uploader.startUpload({
  filePath: photo.localPath,
  serverUrl: uploadUrl,
  method: "POST",
  headers: {
    "X-Project-Id": photo.projectId,
    "X-Photo-Id": photo.id,
    "X-Captured-At": photo.capturedAt,
    ...(photo.lat !== undefined && { "X-GPS-Lat": String(photo.lat) }),
    ...(photo.lng !== undefined && { "X-GPS-Lng": String(photo.lng) }),
  },
})
```

GPS coordinates and timestamps are passed as headers rather than multipart form fields. This keeps the upload simple (single file body) while preserving all metadata.


native components
---

`src/components/native/` contains four components. All return `null` on web.

**`native-shell.tsx`** -- syncs the native status bar style with the current theme. When the app switches between light and dark mode, the status bar text color updates to match.

```typescript
export function NativeShell() {
  const native = useNative()
  const { resolvedTheme } = useTheme()

  useEffect(() => {
    if (!native) return
    async function syncStatusBar() {
      const { StatusBar, Style } = await import("@capacitor/status-bar")
      await StatusBar.setStyle({
        style: resolvedTheme === "dark" ? Style.Dark : Style.Light,
      })
    }
    syncStatusBar()
  }, [native, resolvedTheme])

  return null
}
```

**`biometric-guard.tsx`** -- wraps the app with biometric lock screen functionality. Listens for app state changes (background/foreground). If the app was backgrounded for more than 30 seconds and biometrics are enabled, it shows a full-screen lock overlay. Auto-authenticates on appear, with a fallback "Use password" button that redirects to the login page.

Also handles first-login setup: after a 2-second delay on first native launch, prompts the user to enable biometric locking. The prompt state is tracked in localStorage so it's only shown once.

**`offline-banner.tsx`** -- shows a slim amber banner when the device is offline. Uses `@capacitor/network` on native, falls back to `navigator.onLine` events on web. This component actually works on both platforms -- the web fallback is useful for PWA-like behavior.

**`upload-queue-indicator.tsx`** -- shows pending photo upload count as a pill badge. Changes appearance based on status: neutral for pending, pulsing for uploading, red for errors with "tap to retry" text.


push notifications
---

`src/lib/push/send.ts` sends push notifications via FCM HTTP v1 API. It works from Cloudflare Workers without the Firebase SDK -- just a direct HTTP POST to `https://fcm.googleapis.com/v1/projects/-/messages:send`.

The sender:

1. Looks up all push tokens for the target user from the `push_tokens` table
2. Sends each token a notification with platform-specific config (high priority for Android, sound + badge for iOS)
3. Auto-cleans invalid tokens: 404 responses (unregistered device) trigger token deletion

```typescript
const message: FcmMessage = {
  message: {
    token: t.token,
    notification: { title: payload.title, body: payload.body },
    data: payload.data ? { ...payload.data } : undefined,
    android: { priority: "high" },
    apns: { payload: { aps: { sound: "default", badge: 1 } } },
  },
}
```

Device tokens are registered via `POST /api/push/register` (called by `use-native-push.ts` on app launch) and cleaned up via `DELETE /api/push/register`.


Capacitor configuration
---

`capacitor.config.ts` configures the native wrapper:

```typescript
const config: CapacitorConfig = {
  appId: "ltd.openrangeconstruction.compass",
  appName: "Compass",
  webDir: "public",
  server: {
    url: "https://compass.openrangeconstruction.ltd",
    cleartext: false,
    allowNavigation: [
      "compass.openrangeconstruction.ltd",
      "api.workos.com",
      "authkit.workos.com",
      "accounts.google.com",
      "login.microsoftonline.com",
    ],
  },
}
```

The `server.url` points to the live production deployment. The app doesn't bundle a static export -- it loads the real web app in a WebView. This means native users always get the latest version without app store updates for UI changes.

`allowNavigation` lists domains the WebView is allowed to navigate to. This is needed for OAuth flows (WorkOS, Google, Microsoft) that redirect the user to external auth pages.

The `webDir: "public"` is mostly a formality for Capacitor CLI requirements. Since the app loads from a remote URL, local web assets are only used during the splash screen.

Plugins configured:
- `SplashScreen` -- white background, 2-second display, auto-hide
- `Keyboard` -- resize body on keyboard show (not viewport), dark style
- `PushNotifications` -- badge, sound, and alert presentation options

iOS-specific: `contentInset: "automatic"` for safe area handling, custom `compass` URL scheme.
Android-specific: mixed content disabled (HTTPS only), input capture enabled.


the dynamic import pattern
---

Every Capacitor plugin is loaded with dynamic `await import()` inside an async function, never at module scope. This is critical: Capacitor plugins only exist in the native runtime. A top-level import would crash the web app at module evaluation time.

```typescript
// correct: dynamic import inside a native-gated effect
useEffect(() => {
  if (!native) return
  async function setup() {
    const { PushNotifications } = await import("@capacitor/push-notifications")
    await PushNotifications.requestPermissions()
  }
  setup()
}, [native])
```

This pattern repeats throughout the mobile module. The `native` check prevents the import from even being attempted on web, and the dynamic import ensures the module is only loaded when actually needed.
