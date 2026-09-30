// @vitest-environment jsdom
import * as React from "react"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { CompositionContent, SavedComposition } from "@/lib/correspondence/types"
const mocks = vi.hoisted(() => ({ save: vi.fn(), discard: vi.fn() }))
vi.mock("@/app/actions/correspondence-saved-drafts", () => ({ saveProjectComposition: mocks.save, setProjectDraftDiscarded: mocks.discard }))
import { useCompositionDraft } from "../correspondence/use-composition-draft"
const content: CompositionContent = {kind:"email",subject:"Private draft",body:"Unsent",to:[],cc:[],bcc:["private@example.test"],attachmentIds:["saved-file"],requestId:null}

describe("composition draft lifecycle", () => {
  let root: Root
  let host: HTMLDivElement
  let controls: ReturnType<typeof useCompositionDraft> | null
  beforeEach(() => {
    vi.useFakeTimers(); vi.clearAllMocks(); controls = null
    Object.defineProperty(globalThis,"IS_REACT_ACT_ENVIRONMENT",{value:true,configurable:true})
    host = document.createElement("div"); document.body.append(host); root = createRoot(host)
    mocks.save.mockImplementation(async (_project: string,id: string,version: number,value: CompositionContent) => ({success:true,data:{id,version:version+1,content:value,attachments:[],updatedAt:"2026-09-30"}}))
    mocks.discard.mockImplementation(async (_project: string,_id: string,version: number) => ({success:true,data:{version:version+1}}))
  })
  afterEach(async () => {await act(async () => root.unmount());host.remove();vi.useRealTimers()})
  function Harness(props: {readonly value:CompositionContent; readonly initial:SavedComposition|null}): React.ReactElement {
    controls = useCompositionDraft({projectId:"project",initial:props.initial,content:props.value,busy:false,onStatus:vi.fn(),onSaved:vi.fn()})
    return React.createElement("span",null,props.value.body)
  }
  async function render(value: CompositionContent,initial: SavedComposition|null = null): Promise<void> {
    await act(async () => root.render(React.createElement(Harness,{value,initial})))
  }
  function handle(): ReturnType<typeof useCompositionDraft> {if(!controls) throw new Error("Harness not mounted");return controls}
  it("autosaves Bcc and files then flushes the latest text before leaving", async () => {
    await render(content)
    await act(async () => {await vi.advanceTimersByTimeAsync(700)})
    expect(mocks.save).toHaveBeenLastCalledWith("project",expect.any(String),0,content)
    await render({...content,body:"Updated before navigation"})
    await act(async () => {expect(await handle().flush()).toBe(true)})
    expect(mocks.save).toHaveBeenLastCalledWith("project",expect.any(String),1,{...content,body:"Updated before navigation"})
  })
  it("restores the existing ID/version and saves clearing an existing draft", async () => {
    const initial: SavedComposition = {id:"stored",version:4,content,attachments:[],updatedAt:"2026-09-30"}
    await render(content,initial)
    await act(async () => {await vi.advanceTimersByTimeAsync(700)})
    expect(mocks.save).not.toHaveBeenCalled()
    const empty: CompositionContent = {...content,subject:"",body:"",bcc:[],attachmentIds:[]}
    await render(empty,initial)
    await act(async () => {expect(await handle().flush()).toBe(true)})
    expect(mocks.save).toHaveBeenLastCalledWith("project","stored",4,empty)
  })
  it("blocks navigation when save fails and uses versioned discard/undo", async () => {
    await render(content)
    mocks.save.mockResolvedValueOnce({success:false,error:"Concurrent edit"})
    await act(async () => {expect(await handle().flush()).toBe(false)})
    await act(async () => {expect(await handle().discard()).toBe(true)})
    expect(mocks.discard).toHaveBeenLastCalledWith("project",expect.any(String),1,true)
    await act(async () => {expect(await handle().restore()).toBe(true)})
    expect(mocks.discard).toHaveBeenLastCalledWith("project",expect.any(String),2,false)
  })
})
