import { isInternalStaffRole } from "@/lib/user-roles"

type TeamMemberIdentity = {
  readonly id: string
  readonly role: string
}

/** Returns one canonical internal contact per Settings team user. */
export function uniqueInternalStaffMembers<Member extends TeamMemberIdentity>(
  members: readonly Member[]
): readonly Member[] {
  const membersByUserId = new Map<string, Member>()
  for (const member of members) {
    if (!isInternalStaffRole(member.role) || membersByUserId.has(member.id)) {
      continue
    }
    membersByUserId.set(member.id, member)
  }
  return Array.from(membersByUserId.values())
}
