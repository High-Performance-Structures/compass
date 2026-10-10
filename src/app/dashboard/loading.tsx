import { CompassLoader } from "@/components/compass-loader"

export default function DashboardLoading(): React.ReactElement {
  return (
    <div className="grid min-h-[45vh] place-items-center p-6">
      <CompassLoader label="Loading Compass…" />
    </div>
  )
}
