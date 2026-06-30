export const dynamic = "force-dynamic"

import type * as React from "react"
import Link from "next/link"
import { redirect } from "next/navigation"
import { IconArrowLeft, IconMessageCircle } from "@tabler/icons-react"

import { openProjectConversationChannel } from "@/app/actions/project-messages"
import { Button } from "@/components/ui/button"

export default async function ProjectMessagesPage({
  params,
}: {
  params: Promise<{ id: string }>
}): Promise<React.ReactElement> {
  const { id } = await params
  const result = await openProjectConversationChannel(id)

  if (result.success) {
    redirect(`/dashboard/conversations/${result.data.channelId}`)
  }

  return (
    <main className="mx-auto flex min-h-[60vh] w-full max-w-xl flex-col items-center justify-center gap-4 px-6 text-center">
      <div className="flex size-12 items-center justify-center rounded-lg border bg-card text-muted-foreground">
        <IconMessageCircle className="size-6" />
      </div>
      <div className="space-y-2">
        <h1 className="text-xl font-semibold">Project messages did not open</h1>
        <p className="text-sm text-muted-foreground">{result.error}</p>
      </div>
      <Button asChild variant="outline">
        <Link href={`/dashboard/projects/${id}`}>
          <IconArrowLeft className="size-4" />
          Back to project
        </Link>
      </Button>
    </main>
  )
}
