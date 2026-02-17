"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { IconLoader } from "@tabler/icons-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { acceptInvite } from "@/app/actions/invites"

interface Props {
  code: string
  orgName: string
  role: string
  isAuthenticated: boolean
}

export function JoinForm({ code, orgName, role, isAuthenticated }: Props) {
  const router = useRouter()
  const [isPending, setIsPending] = React.useState(false)

  async function handleJoin() {
    setIsPending(true)
    try {
      const result = await acceptInvite(code)
      if (!result.success) {
        toast.error(result.error ?? "Failed to join organization")
        return
      }
      router.push("/dashboard")
    } finally {
      setIsPending(false)
    }
  }

  function handleSignIn() {
    router.push(`/login?from=/join/${code}`)
  }

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h2 className="text-2xl font-semibold tracking-tight">
          You&apos;ve been invited
        </h2>
        <p className="text-sm text-muted-foreground">
          Join <span className="font-medium text-foreground">{orgName}</span> as{" "}
          <span className="font-medium text-foreground capitalize">{role}</span>
        </p>
      </div>

      {isAuthenticated ? (
        <Button
          className="w-full"
          onClick={handleJoin}
          disabled={isPending}
        >
          {isPending && (
            <IconLoader className="mr-2 h-4 w-4 animate-spin" />
          )}
          Join {orgName}
        </Button>
      ) : (
        <div className="space-y-3">
          <Button className="w-full" onClick={handleSignIn}>
            Sign in to join
          </Button>
          <p className="text-center text-xs text-muted-foreground">
            You&apos;ll be redirected back after signing in.
          </p>
        </div>
      )}
    </div>
  )
}
