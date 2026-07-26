export function canViewOwnerUpdateDrafts(role: string): boolean {
  switch (role) {
    case "admin":
    case "secondary_admin":
    case "office":
    case "field":
      return true
    default:
      return false
  }
}

export function isOwnerUpdateVisibleToRole(
  status: string,
  role: string
): boolean {
  if (canViewOwnerUpdateDrafts(role)) return true

  return status === "published" || status === "sent"
}
