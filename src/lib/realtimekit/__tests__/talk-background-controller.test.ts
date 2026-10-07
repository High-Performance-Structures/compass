import { beforeEach, describe, expect, it, vi } from "vitest"
import RTKMeeting from "@cloudflare/realtimekit"
import { TalkBackgroundController } from "../talk-background-controller"

const mocks = vi.hoisted(() => ({
  supported: true,
  add: vi.fn(async (middleware: unknown) => {
    void middleware
    return { success: true, message: "ok" }
  }),
  remove: vi.fn(async (middleware: unknown) => {
    void middleware
    return { success: true, message: "ok" }
  }),
  configure: vi.fn(async () => {}),
  destruct: vi.fn(),
  blur: vi.fn(async () => async () => {}),
  image: vi.fn(async (url: string) => {
    void url
    return async () => {}
  }),
  init: vi.fn()
}))

vi.mock("@cloudflare/realtimekit", () => ({
  default: {
    init: async () => ({
      self: {
        addVideoMiddleware: mocks.add,
        removeVideoMiddleware: mocks.remove,
        setVideoMiddlewareGlobalConfig: mocks.configure
      }
    })
  }
}))
vi.mock("@cloudflare/realtimekit-virtual-background", () => ({
  default: {
    isSupported: () => mocks.supported,
    init: async () => {
      mocks.init()
      return {
        createBackgroundBlurVideoMiddleware: mocks.blur,
        createStaticBackgroundVideoMiddleware: mocks.image,
        destruct: mocks.destruct
      }
    }
  }
}))

describe("Talk background ownership", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.supported = true
    mocks.add.mockResolvedValue({ success: true, message: "ok" })
  })
  it("leaves Off usable without downloading the effect runtime", async () => {
    const controller = new TalkBackgroundController(
      await RTKMeeting.init({ authToken: "test" })
    )
    expect(await controller.apply({ mode: "none" }, null)).toEqual({
      success: true
    })
    expect(mocks.init).not.toHaveBeenCalled()
    expect(mocks.remove).not.toHaveBeenCalled()
  })
  it("serializes background changes and removes only its own middleware", async () => {
    const controller = new TalkBackgroundController(
      await RTKMeeting.init({ authToken: "test" })
    )
    const first = controller.apply({ mode: "blur", strength: 45 }, null)
    const second = controller.apply(
      { mode: "image", imageId: "image" },
      "/image.svg"
    )
    await Promise.all([first, second])
    expect(mocks.add).toHaveBeenCalledTimes(2)
    expect(mocks.remove).toHaveBeenCalledWith(mocks.add.mock.calls[0]?.[0])
    expect(mocks.destruct).toHaveBeenCalledTimes(1)
    await controller.apply({ mode: "none" }, null)
    expect(mocks.remove).toHaveBeenCalledTimes(2)
  })
  it("reports unsupported effects without changing media", async () => {
    mocks.supported = false
    const controller = new TalkBackgroundController(
      await RTKMeeting.init({ authToken: "test" })
    )
    expect(
      await controller.apply({ mode: "blur", strength: 45 }, null)
    ).toMatchObject({ success: false })
    expect(mocks.add).not.toHaveBeenCalled()
  })
  it("checks the SDK's middleware result instead of claiming success", async () => {
    mocks.add.mockResolvedValue({
      success: false,
      message: "Camera unavailable"
    })
    const controller = new TalkBackgroundController(
      await RTKMeeting.init({ authToken: "test" })
    )
    expect(
      await controller.apply({ mode: "blur", strength: 45 }, null)
    ).toEqual({ success: false, error: "Camera unavailable" })
  })
  it("does not install queued effects after the meeting closes", async () => {
    const controller = new TalkBackgroundController(
      await RTKMeeting.init({ authToken: "test" })
    )
    const apply = controller.apply({ mode: "blur", strength: 45 }, null)
    await controller.dispose()
    expect(await apply).toMatchObject({ success: false })
    expect(mocks.add).not.toHaveBeenCalled()
  })
})
