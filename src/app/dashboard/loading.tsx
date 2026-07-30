import { IconCompass } from "@tabler/icons-react"

export default function DashboardLoading(): React.ReactElement {
  return (
    <div
      role="status"
      aria-label="Loading Compass"
      className="grid min-h-[45vh] place-items-center p-6"
    >
      <div className="flex flex-col items-center gap-3 text-muted-foreground">
        <span className="relative grid size-10 place-items-center">
          <IconCompass className="size-10 text-primary" />
          <span className="absolute h-6 w-px origin-center animate-spin bg-primary" />
        </span>
        <p className="text-sm font-medium">Loading Compass…</p>
      </div>
    </div>
  )
}
