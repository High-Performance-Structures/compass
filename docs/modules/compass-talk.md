# Compass Talk camera and background preferences

The meeting window opens with a private setup screen. Previewing the camera or testing the microphone initializes local media without joining the room. Click **Join meeting** to enter. New accounts default to camera-off and microphone-off.

## Backgrounds and personal images

Choose Off, adjustable blur, HPS or ORC branded backgrounds, illustrations, or the provided photo presets. Use **Upload a background** to add a JPEG, PNG, or WebP up to 8 MB and 32 megapixels. The crop editor produces a 16:9 JPEG; zoom and horizontal/vertical position control the crop. Up to six personal images can be saved.

Personal images, joining preferences, and device choices are stored locally in this browser, under the signed-in Compass account. They are not synchronized to another browser or device. Images are re-encoded before saving; the original file is not uploaded to Compass. Storage failures are reported, and choices still work for the current meeting.

Each personal background has a confirmation-based removal action. Removing a selected image clears both its stored image and its selection, switching to Off.

## Before and during a meeting

The setup screen offers camera preview, a microphone level meter, a speaker test tone, device selectors, and camera/microphone joining preferences. A missing saved device falls back to the browser default. Speaker routing depends on browser support; the test explains when it uses the system default.

During a call, **Background & Settings** opens the same preferences and preview. The camera pauses while its background pipeline is replaced. If the effect cannot start, it stays off; choose Off, retry, or continue without video. Background middleware is prepared before camera startup, and the application checks for a raw-video fallback.

## Runtime and compatibility

Background segmentation runs in the browser through `@cloudflare/realtimekit-virtual-background`. The package downloads its WASM and model from vendor asset hosts; it does not require files at `/tflite.wasm` or `/tflite-simd.wasm` on Compass. The two photo presets also load from the vendor asset host.

Effect support is checked at runtime. The current SDK excludes iOS effects and requires suitable WebGL/browser support. Off, joining without video, and the preferences layout remain usable when effects are unavailable.

## Implementation

- `realtimekit-meeting-window.tsx` owns meeting initialization, explicit joining, and media controls.
- `use-talk-settings.ts` owns account-scoped browser preferences, device choices, and camera transitions.
- `talk-background-controller.ts` serializes background changes and removes only its own middleware.
- `talk-setup.tsx`, `talk-preview.tsx`, `talk-settings-panel.tsx`, and `talk-image-editor.tsx` provide the controls.
