import type { ProjectDepartment } from "@/lib/project-branding"
import { socialDepartment } from "@/lib/social/types"

export type XCredentialAccount = {
  readonly department: string
  readonly externalAccountId: string
  readonly accessTokenEncrypted: string
  readonly refreshTokenEncrypted: string | null
  readonly tokenExpiresAt: string | null
  readonly grantedScopes: string
  readonly status: string
  readonly updatedAt: string
}

function timestamp(value: string | null): number {
  if (!value) return Number.NEGATIVE_INFINITY
  const parsed = new Date(value).getTime()
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY
}

export function sharedXDepartments(input: {
  readonly requestedDepartment: ProjectDepartment
  readonly externalAccountId: string
  readonly accounts: readonly XCredentialAccount[]
}): readonly ProjectDepartment[] {
  const departments = new Set<ProjectDepartment>([input.requestedDepartment])
  for (const account of input.accounts) {
    if (account.status !== "connected" || account.externalAccountId !== input.externalAccountId) {
      continue
    }
    const department = socialDepartment(account.department)
    if (department) departments.add(department)
  }
  return [...departments]
}

export function freshestXAccessAccount(
  accounts: readonly XCredentialAccount[],
  now: number,
): XCredentialAccount | null {
  let freshest: XCredentialAccount | null = null
  for (const account of accounts) {
    if (timestamp(account.tokenExpiresAt) <= now + 5 * 60_000) continue
    if (!freshest || timestamp(account.tokenExpiresAt) > timestamp(freshest.tokenExpiresAt)) {
      freshest = account
    }
  }
  return freshest
}

export function newestXRefreshAccount(
  accounts: readonly XCredentialAccount[],
): XCredentialAccount | null {
  let newest: XCredentialAccount | null = null
  for (const account of accounts) {
    if (!account.refreshTokenEncrypted) continue
    const expiresAt = timestamp(account.tokenExpiresAt)
    const newestExpiresAt = newest ? timestamp(newest.tokenExpiresAt) : Number.NEGATIVE_INFINITY
    if (
      !newest
      || expiresAt > newestExpiresAt
      || (expiresAt === newestExpiresAt && timestamp(account.updatedAt) > timestamp(newest.updatedAt))
    ) {
      newest = account
    }
  }
  return newest
}
