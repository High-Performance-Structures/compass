"use server"

import { revalidatePath } from "next/cache"
import { CorrespondenceAttachmentError, deleteStagedCorrespondenceAttachment, stageCorrespondenceAttachment, type StagedCorrespondenceAttachment } from "@/lib/correspondence/attachment-storage"
import { listCorrespondenceProjectFiles, stageCorrespondenceProjectFile, type ProjectAttachmentFolder } from "@/lib/correspondence/project-file-attachments"
import type { CorrespondenceResult } from "@/lib/correspondence/types"

function attachmentFailure(error: unknown): { readonly success: false; readonly error: string } {
  return { success: false, error: error instanceof CorrespondenceAttachmentError ? error.message : "The file is unavailable. Check project file access and try again." }
}
export async function getCorrespondenceProjectFiles(projectId: string, folderId: string | null = null, pageToken: string | null = null): Promise<CorrespondenceResult<ProjectAttachmentFolder>> {
  try { return { success: true, data: await listCorrespondenceProjectFiles(projectId, folderId, pageToken) } } catch (error) { return attachmentFailure(error) }
}
export async function attachCorrespondenceProjectFile(projectId: string, fileId: string): Promise<CorrespondenceResult<StagedCorrespondenceAttachment>> {
  try {
    const data = await stageCorrespondenceProjectFile(projectId, fileId)
    revalidatePath(`/dashboard/projects/${projectId}/messages`)
    return { success: true, data }
  } catch (error) { return attachmentFailure(error) }
}
export async function removeCorrespondenceAttachment(projectId: string, attachmentId: string): Promise<CorrespondenceResult<null>> {
  try {
    await deleteStagedCorrespondenceAttachment({ projectId, attachmentId })
    revalidatePath(`/dashboard/projects/${projectId}/messages`)
    return { success: true, data: null }
  } catch (error) { return attachmentFailure(error) }
}

export async function uploadCorrespondenceAttachment(projectId: string, form: FormData): Promise<CorrespondenceResult<StagedCorrespondenceAttachment>> {
  try {
    const file = form.get("file")
    if (!(file instanceof File)) return { success: false, error: "Choose a file to upload." }
    const data = await stageCorrespondenceAttachment({ projectId, file })
    revalidatePath(`/dashboard/projects/${projectId}/messages`)
    return { success: true, data }
  } catch (error) { return attachmentFailure(error) }
}
