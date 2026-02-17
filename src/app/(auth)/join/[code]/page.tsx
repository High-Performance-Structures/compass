import { getCurrentUser } from "@/lib/auth"
import { getInviteByCode } from "@/app/actions/invites"
import { JoinForm } from "@/components/auth/join-form"

interface Props {
  params: Promise<{ code: string }>
}

export default async function JoinPage({ params }: Props) {
  const { code } = await params

  const result = await getInviteByCode(code)

  if (!result.success || !result.data) {
    return (
      <div className="space-y-4 text-center">
        <div className="space-y-1">
          <h2 className="text-2xl font-semibold tracking-tight">
            Invalid invite
          </h2>
          <p className="text-sm text-muted-foreground">
            This invite link is invalid or has expired.
          </p>
        </div>
      </div>
    )
  }

  const currentUser = await getCurrentUser()

  return (
    <JoinForm
      code={code}
      orgName={result.data.organizationName}
      role={result.data.role}
      isAuthenticated={currentUser !== null}
    />
  )
}
