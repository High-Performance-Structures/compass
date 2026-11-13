"use server"

import { projectConversationFilter, projectConversationScope, readProjectConversations } from "@/lib/domain/conversations/project-conversations"

/** One job's conversations for the Conversations tab of its Messages page. */
export async function getProjectConversations(projectId: string, options: { readonly scope?: string; readonly filter?: string; readonly search?: string; readonly page?: number } = {}) {
  return readProjectConversations({
    projectId,
    scope: projectConversationScope(options.scope),
    filter: projectConversationFilter(options.filter),
    search: options.search ?? "",
    page: options.page ?? 1,
  })
}
