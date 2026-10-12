import type * as React from "react"
import { IconAddressBook } from "@tabler/icons-react"
import { getClientFollowUpWorkspace } from "@/app/actions/client-follow-up"
import { ClientFollowUpBoard } from "@/components/client-follow-up/client-follow-up-board"
import { PageHeader } from "@/components/page-header"

export const dynamic = "force-dynamic"

export default async function ClientFollowUpPage({
  searchParams,
}: {
  readonly searchParams: Promise<{ readonly period?: string; readonly job?: string }>
}): Promise<React.ReactElement> {
  const params = await searchParams
  const result = await getClientFollowUpWorkspace(params.period)
  return (
    <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-6 overflow-y-auto p-4 lg:p-6">
      <PageHeader
        className="mb-0 border-b pb-5"
        icon={<IconAddressBook className="size-6 text-muted-foreground" />}
        title="Client follow-up"
      />
      {result.success ? (
        <ClientFollowUpBoard workspace={result.data} initialJobId={params.job ?? null} />
      ) : (
        <p className="text-sm text-muted-foreground">{result.error}</p>
      )}
    </main>
  )
}
