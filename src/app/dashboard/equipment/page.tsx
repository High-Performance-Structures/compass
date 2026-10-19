export const dynamic = "force-dynamic"

import { IconBulldozer } from "@tabler/icons-react"

import { getEquipmentWorkspace } from "@/app/actions/equipment"
import { EquipmentWorkspaceView } from "@/components/equipment/equipment-workspace"
import { ContextualHelpBeacon } from "@/components/help/contextual-help-beacon"
import { PageHeader } from "@/components/page-header"

export default async function EquipmentPage(): Promise<React.ReactElement> {
  const workspace = await getEquipmentWorkspace()
  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-4 md:p-6">
      <PageHeader
        icon={<IconBulldozer className="size-5 text-primary" />}
        eyebrow="Office Tools"
        title="Equipment"
        actions={<ContextualHelpBeacon topicId="equipment.machine-log" />}
      />
      <EquipmentWorkspaceView workspace={workspace} />
    </div>
  )
}
