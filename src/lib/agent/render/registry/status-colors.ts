// Badge colours for record statuses (paid, overdue, in progress...) used by the
// Compass record cards in ../registry.tsx: a pill background and a dot colour.

export function badgeStatusColor(status: string): string {
  switch (status.toLowerCase()) {
    case "complete":
    case "completed":
    case "paid":
    case "active":
      return "bg-success/10 text-success  "
    case "in progress":
    case "in_progress":
    case "sent":
      return "bg-info/10 text-info  "
    case "pending":
    case "draft":
    case "not started":
    case "not_started":
      return "bg-muted text-foreground  "
    case "overdue":
    case "delayed":
    case "cancelled":
    case "canceled":
      return "bg-destructive/10 text-destructive  "
    case "warning":
    case "at risk":
    case "at_risk":
      return "bg-warning/10 text-warning  "
    default:
      return "bg-muted text-foreground  "
  }
}

export function badgeDotColor(status: string): string {
  switch (status.toLowerCase()) {
    case "complete":
    case "completed":
    case "paid":
    case "active":
      return "bg-success"
    case "in progress":
    case "in_progress":
    case "sent":
      return "bg-info"
    case "pending":
    case "draft":
    case "not started":
    case "not_started":
      return "bg-muted-foreground"
    case "overdue":
    case "delayed":
    case "cancelled":
    case "canceled":
      return "bg-destructive"
    case "warning":
    case "at risk":
    case "at_risk":
      return "bg-warning"
    default:
      return "bg-muted-foreground"
  }
}
