import type RTKMeeting from "@cloudflare/realtimekit"
import type Transformer from "@cloudflare/realtimekit-virtual-background"
import type {
  TalkBackground,
  TalkCleanup
} from "@/lib/realtimekit/talk-preferences"

type Middleware = Parameters<RTKMeeting["self"]["addVideoMiddleware"]>[0]
export type BackgroundResult =
  | { readonly success: true }
  | { readonly success: false; readonly error: string }

/** Own only Talk's middleware; serialize changes so slow image loads cannot win over newer choices. */
export class TalkBackgroundController {
  private transformer: Transformer | null = null
  private cleanup: TalkCleanup | null = null
  private middleware: Middleware | null = null
  private queue: Promise<BackgroundResult> = Promise.resolve({ success: true })
  private disposed = false

  constructor(private readonly meeting: RTKMeeting) {}

  apply(
    background: TalkBackground,
    imageUrl: string | null,
    cleanup: TalkCleanup = "standard"
  ): Promise<BackgroundResult> {
    this.queue = this.queue.then(async () => {
      if (this.disposed)
        return { success: false, error: "This meeting has closed." }
      try {
        if (background.mode === "none") {
          await this.remove()
          await this.meeting.self.setVideoMiddlewareGlobalConfig({
            disablePerFrameCanvasRendering: false
          })
          return { success: true }
        }
        if (this.transformer && this.cleanup !== cleanup) {
          await this.remove()
          this.transformer.destruct()
          this.transformer = null
        }
        if (!this.transformer) {
          const { default: VideoBackgroundTransformer } = await import(
            "@cloudflare/realtimekit-virtual-background"
          )
          if (!VideoBackgroundTransformer.isSupported()) {
            return {
              success: false,
              error:
                "Background effects are unavailable in this browser. Try a current desktop Chrome or Edge browser."
            }
          }
          // The SDK loads its WASM and model from its asset hosts, not the Compass public directory.
          this.transformer = await VideoBackgroundTransformer.init({
            meeting: this.meeting,
            // Await this frame's resized pixels so the mask does not trail a moving person.
            segmentationConfig: { deferInputResizing: false },
            postProcessingConfig:
              cleanup === "strong"
                ? {
                    jointBilateralFilter: { sigmaSpace: 2, sigmaColor: 0.1 },
                    coverage: [0.65, 0.9],
                    lightWrapping: 0
                  }
                : {}
          })
          this.cleanup = cleanup
        }
        if (this.disposed)
          return { success: false, error: "This meeting has closed." }
        if (background.mode === "image" && !imageUrl)
          return { success: false, error: "Choose a background image." }
        const middleware =
          background.mode === "blur"
            ? await this.transformer.createBackgroundBlurVideoMiddleware(
                background.strength
              )
            : await this.transformer.createStaticBackgroundVideoMiddleware(
                imageUrl ?? ""
              )
        if (this.disposed)
          return { success: false, error: "This meeting has closed." }
        await this.remove()
        // Off restores normal rendering. Reusing a transformer must restore its own render loop every time.
        await this.meeting.self.setVideoMiddlewareGlobalConfig({
          disablePerFrameCanvasRendering: true
        })
        const result = await this.meeting.self.addVideoMiddleware(middleware)
        if (!result.success) return { success: false, error: result.message }
        this.middleware = middleware
        return { success: true }
      } catch {
        return {
          success: false,
          error:
            "Background effects could not load. Your camera will stay off. Retry, choose Off, or join without video."
        }
      }
    })
    return this.queue
  }

  private async remove(): Promise<void> {
    if (this.middleware) {
      this.transformer?.destruct()
      const result = await this.meeting.self.removeVideoMiddleware(
        this.middleware
      )
      if (!result.success) throw new Error(result.message)
      this.middleware = null
    }
  }

  async dispose(): Promise<void> {
    this.disposed = true
    await this.queue
    try {
      await this.remove()
    } finally {
      this.transformer?.destruct()
      this.transformer = null
    }
  }
}
