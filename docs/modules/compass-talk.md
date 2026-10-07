# Compass Talk camera and background preferences

The meeting window opens with a private setup screen. Previewing the camera or testing the microphone initializes local media without joining the room. Click **Join meeting** to enter. New accounts default to camera-off and microphone-off.

## Backgrounds and personal images

Choose Off, adjustable blur, HPS or ORC branded backgrounds, illustrations, or the provided photo presets. Use **Upload a background** to add a JPEG, PNG, or WebP up to 8 MB and 32 megapixels. The crop editor produces a 16:9 JPEG; zoom and horizontal/vertical position control the crop. Up to six personal images can be saved.

Personal images, joining preferences, and device choices are stored locally in this browser, under the signed-in Compass account. They are not synchronized to another browser or device. Images are re-encoded before saving; the original file is not uploaded to Compass. Storage failures are reported, and choices still work for the current meeting.

Each personal background has a confirmation-based removal action. Removing a selected image clears both its stored image and its selection, switching to Off.

Blur strength applies once per adjustment, when the slider is released or keyboard steps pause, so a live camera restarts its background pipeline once rather than at every step.

**Stronger background cleanup** increases mask filtering and the confidence required to keep camera pixels, reducing uncertain background edges and light spill. It may trim fine hair or fingertips. Standard remains the default and existing preferences retain their background, images, and devices. The stronger mask controls are most effective in Chrome, Edge, and Firefox; the SDK's Safari fallback does not apply the same GPU mask refinement. Neither setting guarantees that every misclassified monitor or object will disappear.

The GPU pipeline waits for the current frame's resized pixels before segmentation. Each effect installation also restores middleware-owned rendering, including after Off, so the SDK's normal canvas renderer cannot compete with the effect loop.

## Before and during a meeting

The setup screen offers camera preview, a microphone level meter, a speaker test tone, device selectors, and camera/microphone joining preferences. A missing saved device falls back to the browser default. Speaker routing depends on browser support; the test explains when it uses the system default.

During a call, the single bottom toolbar always provides **Mute** or **Unmute** for your own microphone. It does not require opening Participants. Muting stops the local track; unmuting requests a fresh track from the selected microphone. The meeting renderer uses container-fill mode so it cannot cover the controls or notes panel. Camera, screen sharing, picture-in-picture, Background & Settings, Chat, Participants, and Leave share this toolbar. Controls wrap at narrower widths; notes and transcript stay beside the meeting on wide screens and below it on smaller screens. The SDK does not add a second set of media controls. **PiP** opens the SDK participant view with the browser’s supported meeting media controls. **Leave** opens a confirmation with **Leave meeting** and **Cancel**; authorized hosts can also choose **End for Everyone**. Failed leave or end requests keep the call open and show an error. Use **Notes & Transcript** in the toolbar to hide or show the panel, or close it with the panel’s close button. Hiding expands the meeting into the freed space and preserves the notes draft, selected tab, and captured transcript for the current call. Hiding the panel does not turn caption capture off. Unsaved notes are kept in this browser for each meeting and restored the next time it opens; saving them to the conversation clears the stored draft. The Leave confirmation mentions unsaved notes. The transcript follows new lines unless you scroll up.

During a call, **Background & Settings** opens the same preferences and preview. The camera pauses while its background pipeline is replaced. If the effect cannot start, it stays off; choose Off, retry, or continue without video. Background middleware is prepared before camera startup, and the application checks for a raw-video fallback.

An unmuted participant can appear before their subscribed audio track is ready. The voice-activity meter skips pending tracks and picks them up when they arrive, so entering an active call with the camera and microphone off does not crash the meeting page.

## Runtime and compatibility

Background segmentation runs in the browser through `@cloudflare/realtimekit-virtual-background`. The package downloads its WASM and model from vendor asset hosts; it does not require files at `/tflite.wasm` or `/tflite-simd.wasm` on Compass. The two photo presets also load from the vendor asset host.

Effect support is checked at runtime. The current SDK excludes iOS effects and requires suitable WebGL/browser support. Off, joining without video, and the preferences layout remain usable when effects are unavailable.

## Implementation

- `realtimekit-meeting-window.tsx` owns meeting initialization, explicit joining, and media controls.
- `use-talk-settings.ts` owns account-scoped browser preferences, device choices, and camera transitions.
- `talk-background-controller.ts` serializes background changes and removes only its own middleware.
- `talk-setup.tsx`, `talk-preview.tsx`, `talk-settings-panel.tsx`, and `talk-image-editor.tsx` provide the controls.

If supplying a fresh microphone track does not enable audio, Talk releases that track and retries SDK-owned capture (the path used by the SDK PiP controls), retaining an available selected microphone. Microphone failures distinguish browser access, meeting publishing permissions, and audio publishing failure. Device names refresh after microphone access succeeds; before permission, settings explain why names can be hidden. Recovery instructions apply across supported browsers and operating systems.
