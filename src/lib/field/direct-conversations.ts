type DirectConversationActivity = {
  readonly createdAt: string
  readonly updatedAt: string
}

export function compareDirectConversationActivity(
  left: DirectConversationActivity,
  right: DirectConversationActivity
): number {
  const updatedComparison = right.updatedAt.localeCompare(left.updatedAt)
  if (updatedComparison !== 0) return updatedComparison
  return right.createdAt.localeCompare(left.createdAt)
}

export function orderDirectConversationsByActivity<
  Conversation extends DirectConversationActivity,
>(conversations: readonly Conversation[]): Conversation[] {
  return conversations.slice().sort(compareDirectConversationActivity)
}
