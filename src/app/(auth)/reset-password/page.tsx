import { ResetPasswordForm } from "@/components/auth/reset-password-form"
import { SetPasswordForm } from "@/components/auth/set-password-form"

type ResetPasswordPageProps = {
  readonly searchParams: Promise<{
    readonly token?: string | readonly string[]
  }>
}

export default async function ResetPasswordPage({
  searchParams,
}: ResetPasswordPageProps): Promise<React.ReactElement> {
  const { token: tokenParam } = await searchParams
  const token = Array.isArray(tokenParam) ? tokenParam[0] : tokenParam

  if (token) {
    return (
      <div className="space-y-2">
        <div className="space-y-1">
          <h2 className="text-2xl font-semibold tracking-tight">
            Set new password
          </h2>
          <p className="text-sm text-muted-foreground">
            Enter your new password below
          </p>
        </div>

        <SetPasswordForm token={token} />
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <div className="space-y-1">
        <h2 className="text-2xl font-semibold tracking-tight">
          Reset password
        </h2>
        <p className="text-sm text-muted-foreground">
          Enter your email to receive a reset link
        </p>
      </div>

      <ResetPasswordForm />
    </div>
  )
}
