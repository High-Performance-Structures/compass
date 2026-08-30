/** @vitest-environment jsdom */

import { describe, expect, it } from "vitest"
import {
  createPictureInPictureTileRegistry,
  selectPictureInPictureVideo,
} from "@/lib/realtimekit/picture-in-picture"

function setVideoReady(video: HTMLVideoElement): void {
  Object.defineProperty(video, "videoWidth", { configurable: true, value: 640 })
  Object.defineProperty(video, "videoHeight", { configurable: true, value: 360 })
}

function addRealtimeKitTile(
  root: HTMLDivElement,
  participantId: string,
  video: HTMLVideoElement
): HTMLElement {
  const tile = document.createElement("rtk-participant-tile")
  const shadowRoot = tile.attachShadow({ mode: "open" })
  shadowRoot.append(video)
  const meetingShadowRoot =
    root.shadowRoot ?? root.attachShadow({ mode: "open" })
  meetingShadowRoot.appendChild(tile)
  tile.dispatchEvent(
    new CustomEvent("tileLoad", {
      bubbles: true,
      composed: true,
      detail: {
        participant: { id: participantId },
        videoElement: video,
      },
    })
  )
  return tile
}

describe("RealtimeKit picture-in-picture tile discovery", () => {
  it("discovers a self video from a tile shadow root before a remote video", () => {
    const root = document.createElement("div")
    document.body.appendChild(root)
    const registry = createPictureInPictureTileRegistry()
    const remoteVideo = document.createElement("video")
    const selfVideo = document.createElement("video")
    setVideoReady(remoteVideo)
    setVideoReady(selfVideo)

    const detach = registry.attach(root)
    addRealtimeKitTile(root, "remote-participant", remoteVideo)
    addRealtimeKitTile(root, "self-participant", selfVideo)

    expect(root.querySelectorAll("video")).toHaveLength(0)
    expect(
      selectPictureInPictureVideo(registry.getCandidates("self-participant"))
    ).toBe(selfVideo)

    detach()
    root.remove()
  })

  it("keeps the remote candidate when the self tile unloads", () => {
    const root = document.createElement("div")
    document.body.appendChild(root)
    const registry = createPictureInPictureTileRegistry()
    const remoteVideo = document.createElement("video")
    const selfVideo = document.createElement("video")
    setVideoReady(remoteVideo)
    setVideoReady(selfVideo)
    registry.attach(root)
    addRealtimeKitTile(root, "remote-participant", remoteVideo)
    const selfTile = addRealtimeKitTile(root, "self-participant", selfVideo)

    selfTile.dispatchEvent(
      new CustomEvent("tileUnload", {
        bubbles: true,
        composed: true,
        detail: { id: "self-participant" },
      })
    )

    expect(
      selectPictureInPictureVideo(registry.getCandidates("self-participant"))
    ).toBe(remoteVideo)
    root.remove()
  })

  it("keeps the other self tile when one of two self tiles unloads", () => {
    const root = document.createElement("div")
    document.body.appendChild(root)
    const registry = createPictureInPictureTileRegistry()
    const mainSelfVideo = document.createElement("video")
    const previewSelfVideo = document.createElement("video")
    setVideoReady(mainSelfVideo)
    setVideoReady(previewSelfVideo)
    registry.attach(root)
    addRealtimeKitTile(root, "self-participant", mainSelfVideo)
    const previewTile = addRealtimeKitTile(
      root,
      "self-participant",
      previewSelfVideo
    )

    previewTile.dispatchEvent(
      new CustomEvent("tileUnload", {
        bubbles: true,
        composed: true,
        detail: { id: "self-participant" },
      })
    )

    expect(
      selectPictureInPictureVideo(registry.getCandidates("self-participant"))
    ).toBe(mainSelfVideo)
    root.remove()
  })

  it("clears disconnected tiles and registrations on detach", () => {
    const root = document.createElement("div")
    document.body.appendChild(root)
    const registry = createPictureInPictureTileRegistry()
    const video = document.createElement("video")
    setVideoReady(video)
    const detach = registry.attach(root)
    const tile = addRealtimeKitTile(root, "self-participant", video)

    tile.remove()
    expect(registry.getCandidates("self-participant")).toHaveLength(0)

    detach()
    expect(registry.getCandidates("self-participant")).toHaveLength(0)
    root.remove()
  })

  it("prefers a ready self video and ignores videos that disallow PiP", () => {
    const blocked = { video: "blocked", isSelfPreview: true, isReady: true, canUsePictureInPicture: false }
    const remote = { video: "remote", isSelfPreview: false, isReady: true, canUsePictureInPicture: true }
    const self = { video: "self", isSelfPreview: true, isReady: true, canUsePictureInPicture: true }

    expect(selectPictureInPictureVideo([blocked, remote, self])).toBe("self")
  })
})
