"use client"

import { NodeToolbar, Position } from "@xyflow/react"
import type { ComponentProps } from "react"
import { cn } from "@/lib/utils"

type ToolbarProps = ComponentProps<typeof NodeToolbar>

export const Toolbar = ({ className, ...props }: ToolbarProps) => (
  <NodeToolbar
    className={cn("flex items-center gap-1 rounded-sm border bg-background p-1.5", className)}
    position={Position.Bottom}
    {...props}
  />
)

import { Background, ReactFlow, ReactFlowProvider } from "@xyflow/react"
import { CopyIcon, EditIcon, TrashIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import "@xyflow/react/dist/style.css"

const ToolbarNode = ({ data, selected }: { data: { label: string }; selected: boolean }) => (
  <div
    className={cn(
      "rounded-lg border-2 bg-card px-4 py-2 text-sm font-medium transition-all",
      selected ? "border-primary shadow-md" : "border-transparent",
    )}
  >
    {data.label}
    <Toolbar>
      <Button size="icon-sm" variant="ghost" className="size-7">
        <EditIcon className="size-3.5" />
      </Button>
      <Button size="icon-sm" variant="ghost" className="size-7">
        <CopyIcon className="size-3.5" />
      </Button>
      <Button
        size="icon-sm"
        variant="ghost"
        className="size-7 text-destructive hover:text-destructive"
      >
        <TrashIcon className="size-3.5" />
      </Button>
    </Toolbar>
  </div>
)

const nodeTypes = { toolbar: ToolbarNode }

const initialNodes = [
  { id: "1", type: "toolbar", position: { x: 50, y: 50 }, data: { label: "Node A" } },
  { id: "2", type: "toolbar", position: { x: 200, y: 120 }, data: { label: "Node B" } },
  { id: "3", type: "toolbar", position: { x: 100, y: 200 }, data: { label: "Node C" } },
]

/** Demo component for preview */
export default function ToolbarDemo() {
  return (
    <div className="h-full min-h-[500px] w-full">
      <ReactFlowProvider>
        <ReactFlow
          defaultNodes={initialNodes}
          nodeTypes={nodeTypes}
          fitView
          fitViewOptions={{ padding: 0.5 }}
          panOnScroll
          proOptions={{ hideAttribution: true }}
        >
          <Background gap={16} size={1} />
          <div className="absolute bottom-4 left-4 rounded-md bg-background/80 px-3 py-2 text-muted-foreground text-xs backdrop-blur-sm">
            Click a node to show its toolbar
          </div>
        </ReactFlow>
      </ReactFlowProvider>
    </div>
  )
}
