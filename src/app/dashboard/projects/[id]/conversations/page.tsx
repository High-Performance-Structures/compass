import { redirect } from "next/navigation"

export default async function ProjectConversationsPage({
  params,
}: {
  readonly params: Promise<{ readonly id: string }>
}): Promise<never> {
  const { id } = await params
  redirect(`/dashboard/conversations?projectId=${encodeURIComponent(id)}`)
}
