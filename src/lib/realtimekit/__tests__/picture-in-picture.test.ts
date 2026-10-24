// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest"
import {
  createPictureInPictureTileRegistry,
  exitPictureInPictureIfElementMatches,
  selectPictureInPictureVideo,
} from "@/lib/realtimekit/picture-in-picture"

function markReady(video: HTMLVideoElement): void {
  Object.defineProperty(video, "videoWidth", { configurable: true, value: 640 })
  Object.defineProperty(video, "videoHeight", { configurable: true, value: 360 })
}

function loadTile(
  root: HTMLDivElement,
  participantId: string,
  video: HTMLVideoElement,
  dispatchLoad = true,
): HTMLElement {
  const tile = document.createElement("rtk-participant-tile")
  Reflect.set(tile, "participant", { id: participantId })
  const tileShadowRoot = tile.attachShadow({ mode: "open" })
  tileShadowRoot.append(video)
  const meetingShadowRoot = root.shadowRoot ?? root.attachShadow({ mode: "open" })
  meetingShadowRoot.append(tile)
  if (dispatchLoad) {
    tile.dispatchEvent(new CustomEvent("tileLoad", {
      bubbles: true,
      composed: true,
      detail: { participant: { id: participantId }, videoElement: video },
    }))
  }
  return tile
}

describe("RealtimeKit picture-in-picture tile registry", () => {
  it("discovers shadow-DOM tiles and prefers a ready self preview", () => {
    const root = document.createElement("div")
    const registry = createPictureInPictureTileRegistry()
    const remote = document.createElement("video")
    const self = document.createElement("video")
    markReady(remote)
    markReady(self)
    document.body.appendChild(root)

    const detach = registry.attach(root)
    loadTile(root, "remote", remote)
    loadTile(root, "self", self)

    expect(root.querySelectorAll("video")).toHaveLength(0)
    expect(registry.getCandidates("self").map((candidate) => candidate.video)).toEqual([remote, self])
    expect(selectPictureInPictureVideo(registry.getCandidates("self"))).toBe(self)

    detach()
    root.remove()
  })

  it("removes a tile when RealtimeKit unloads it after detachment", () => {
    const root = document.createElement("div")
    const registry = createPictureInPictureTileRegistry()
    const video = document.createElement("video")
    markReady(video)
    document.body.appendChild(root)

    const detach = registry.attach(root)
    const tile = loadTile(root, "self", video)
    expect(registry.getCandidates("self")).toHaveLength(1)

    tile.remove()
    tile.dispatchEvent(new CustomEvent("tileUnload", {
      detail: { participant: { id: "self" } },
    }))
    // Reconnect the video so a stale registration cannot hide behind the
    // registry's connected-video filter.
    root.appendChild(video)

    expect(registry.getCandidates("self")).toHaveLength(0)

    detach()
    root.remove()
  })

  it("removes only the unloaded tile while retaining another self preview", () => {
    const root = document.createElement("div")
    const registry = createPictureInPictureTileRegistry()
    const firstSelf = document.createElement("video")
    const secondSelf = document.createElement("video")
    markReady(firstSelf)
    markReady(secondSelf)
    document.body.appendChild(root)

    const detach = registry.attach(root)
    loadTile(root, "self", firstSelf)
    const secondTile = loadTile(root, "self", secondSelf)
    expect(registry.getCandidates("self").map((candidate) => candidate.video)).toEqual([firstSelf, secondSelf])
    secondTile.dispatchEvent(new CustomEvent("tileUnload", {
      bubbles: true,
      composed: true,
      detail: { id: "self" },
    }))

    expect(registry.getCandidates("self").map((candidate) => candidate.video)).toEqual([firstSelf])

    detach()
    root.remove()
  })

  it("exits matching browser PiP when its registered tile unloads", async () => {
    const root = document.createElement("div")
    const registry = createPictureInPictureTileRegistry()
    const video = document.createElement("video")
    markReady(video)
    document.body.appendChild(root)
    const exitPictureInPicture = vi.fn(async () => {
      Object.defineProperty(document, "pictureInPictureElement", {
        configurable: true,
        value: null,
      })
    })
    Object.defineProperty(document, "pictureInPictureElement", {
      configurable: true,
      value: video,
    })
    Object.defineProperty(document, "exitPictureInPicture", {
      configurable: true,
      value: exitPictureInPicture,
    })

    const detach = registry.attach(root, (removedVideo) => {
      void exitPictureInPictureIfElementMatches(removedVideo)
    })
    const tile = loadTile(root, "self", video)
    tile.dispatchEvent(new CustomEvent("tileUnload", {
      detail: { id: "self" },
    }))

    await Promise.resolve()
    expect(exitPictureInPicture).toHaveBeenCalledOnce()
    expect(registry.getCandidates("self")).toHaveLength(0)

    detach()
    root.remove()
  })

  it("does not exit unrelated browser PiP during tile cleanup or registry replacement", async () => {
    const root = document.createElement("div")
    const registry = createPictureInPictureTileRegistry()
    const firstVideo = document.createElement("video")
    const replacementVideo = document.createElement("video")
    const unrelatedVideo = document.createElement("video")
    markReady(firstVideo)
    markReady(replacementVideo)
    markReady(unrelatedVideo)
    document.body.appendChild(root)
    const exitPictureInPicture = vi.fn(async () => {})
    Object.defineProperty(document, "pictureInPictureElement", {
      configurable: true,
      value: unrelatedVideo,
    })
    Object.defineProperty(document, "exitPictureInPicture", {
      configurable: true,
      value: exitPictureInPicture,
    })

    const detach = registry.attach(root, (removedVideo) => {
      void exitPictureInPictureIfElementMatches(removedVideo)
    })
    const firstTile = loadTile(root, "self", firstVideo)
    loadTile(root, "self", replacementVideo)
    firstTile.dispatchEvent(new CustomEvent("tileUnload", {
      detail: { id: "self" },
    }))
    await Promise.resolve()
    expect(exitPictureInPicture).not.toHaveBeenCalled()
    expect(registry.getCandidates("self").map((candidate) => candidate.video)).toEqual([
      replacementVideo,
    ])

    detach()
    root.remove()
  })

  it("exits matching browser PiP when the registry detaches for leave or unmount", async () => {
    const root = document.createElement("div")
    const registry = createPictureInPictureTileRegistry()
    const video = document.createElement("video")
    markReady(video)
    document.body.appendChild(root)
    const exitPictureInPicture = vi.fn(async () => {})
    Object.defineProperty(document, "pictureInPictureElement", {
      configurable: true,
      value: video,
    })
    Object.defineProperty(document, "exitPictureInPicture", {
      configurable: true,
      value: exitPictureInPicture,
    })

    const detach = registry.attach(root, (removedVideo) => {
      void exitPictureInPictureIfElementMatches(removedVideo)
    })
    loadTile(root, "self", video)
    detach()

    await Promise.resolve()
    expect(exitPictureInPicture).toHaveBeenCalledOnce()
    root.remove()
  })

  it("coalesces concurrent exit requests for the same browser PiP element", async () => {
    const video = document.createElement("video")
    let resolveExit: (() => void) | undefined
    const exitPictureInPicture = vi.fn(
      () => new Promise<void>((resolve) => { resolveExit = resolve })
    )
    Object.defineProperty(document, "pictureInPictureElement", {
      configurable: true,
      value: video,
    })
    Object.defineProperty(document, "exitPictureInPicture", {
      configurable: true,
      value: exitPictureInPicture,
    })

    const firstExit = exitPictureInPictureIfElementMatches(video)
    const secondExit = exitPictureInPictureIfElementMatches(video)
    expect(exitPictureInPicture).toHaveBeenCalledOnce()
    resolveExit?.()
    await expect(firstExit).resolves.toBe(true)
    await expect(secondExit).resolves.toBe(true)
  })

  it("does not duplicate root listeners when attached more than once", () => {
    const root = document.createElement("div")
    const registry = createPictureInPictureTileRegistry()

    const firstDetach = registry.attach(root)
    const secondDetach = registry.attach(root)

    expect(secondDetach).toBe(firstDetach)
    firstDetach()
    root.remove()
  })

  it("replays an already loaded shadow-DOM tile after detach and reopen", () => {
    const root = document.createElement("div")
    const registry = createPictureInPictureTileRegistry()
    const video = document.createElement("video")
    markReady(video)
    document.body.appendChild(root)
    loadTile(root, "self", video, false)

    const firstDetach = registry.attach(root)
    expect(registry.getCandidates("self").map((candidate) => candidate.video)).toEqual([video])

    firstDetach()
    expect(registry.getCandidates("self")).toHaveLength(0)

    registry.attach(root)
    expect(registry.getCandidates("self").map((candidate) => candidate.video)).toEqual([video])

    root.remove()
  })

  it("prefers a ready self preview, falls back to ready remote video, and excludes forbidden media", () => {
    const blocked = {
      video: "blocked",
      isSelfPreview: true,
      isReady: true,
      canUsePictureInPicture: false,
    }
    const self = {
      video: "self",
      isSelfPreview: true,
      isReady: false,
      canUsePictureInPicture: true,
    }
    const remote = {
      video: "remote",
      isSelfPreview: false,
      isReady: true,
      canUsePictureInPicture: true,
    }

    expect(selectPictureInPictureVideo([blocked, self, remote])).toBe("remote")
  })
})
