"use client"

import { Panel as PanelPrimitive } from "@xyflow/react"
import type { ComponentProps } from "react"
import { cn } from "@/lib/utils"

type PanelProps = ComponentProps<typeof PanelPrimitive>

export const Panel = ({ className, ...props }: PanelProps) => (
  <PanelPrimitive
    className={cn("m-4 overflow-hidden rounded-md border bg-card p-1", className)}
    {...props}
  />
)

import { Background, ReactFlow, ReactFlowProvider } from "@xyflow/react"
import { LayersIcon, PlusIcon, SettingsIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import "@xyflow/react/dist/style.css"

const SimpleNode = ({ data }: { data: { label: string } }) => (
  <div className="rounded-md border bg-card px-3 py-1.5 text-xs font-medium">{data.label}</div>
)

const nodeTypes = { simple: SimpleNode }

const initialNodes = [
  { id: "1", type: "simple", position: { x: 180, y: 100 }, data: { label: "Workflow" } },
]

/** Demo component for preview */
export default function PanelDemo() {
  return (
    <div className="h-full w-full min-h-screen">
      <ReactFlowProvider>
        <ReactFlow defaultNodes={initialNodes} nodeTypes={nodeTypes} fitView panOnScroll>
          <Background bgColor="var(--sidebar)" />
          <Panel position="top-left">
            <div className="flex items-center gap-1">
              <Button size="icon-sm" variant="ghost">
                <PlusIcon className="size-3.5" />
              </Button>
              <Button size="icon-sm" variant="ghost">
                <LayersIcon className="size-3.5" />
              </Button>
              <Button size="icon-sm" variant="ghost">
                <SettingsIcon className="size-3.5" />
              </Button>
            </div>
          </Panel>
          <Panel position="bottom-right">
            <span className="px-2 text-muted-foreground text-xs">1 node</span>
          </Panel>
        </ReactFlow>
      </ReactFlowProvider>
    </div>
  )
}
