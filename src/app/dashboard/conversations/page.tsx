import { redirect } from "next/navigation"
import { MessageSquare } from "lucide-react"
import { listChannels } from "@/app/actions/conversations"
import { CreateChannelButton } from "@/components/conversations/create-channel-button"

export default async function ConversationsPage() {
  const result = await listChannels()

  if (result.success && result.data && result.data.length > 0) {
    redirect(`/dashboard/conversations/${result.data[0].id}`)
  }

  return (
    <div className="flex h-full flex-1 flex-col items-center justify-center gap-4 p-8">
      <MessageSquare className="h-16 w-16 text-muted-foreground/40" />
      <div className="text-center">
        <h2 className="text-2xl font-semibold">No channels yet</h2>
        <p className="mt-2 text-muted-foreground">
          Create your first channel to start conversations with your team
        </p>
      </div>
      <CreateChannelButton />
    </div>
  )
}
