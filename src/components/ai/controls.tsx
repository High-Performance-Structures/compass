"use client"

import { Controls as ControlsPrimitive } from "@xyflow/react"
import type { ComponentProps } from "react"
import { cn } from "@/lib/utils"

export type ControlsProps = ComponentProps<typeof ControlsPrimitive>

export const Controls = ({ className, ...props }: ControlsProps) => (
  <ControlsPrimitive
    className={cn(
      "gap-px overflow-hidden rounded-md border bg-card p-1 shadow-none!",
      "[&>button]:rounded-md [&>button]:border-none! [&>button]:bg-transparent! [&>button]:hover:bg-secondary!",
      className,
    )}
    {...props}
  />
)

import { Background, ReactFlow, ReactFlowProvider } from "@xyflow/react"
import "@xyflow/react/dist/style.css"

const SimpleNode = ({ data }: { data: { label: string } }) => (
  <div className="rounded-md border bg-card px-3 py-1.5 text-xs font-medium">{data.label}</div>
)

const nodeTypes = { simple: SimpleNode }

const initialNodes = [
  { id: "1", type: "simple", position: { x: 100, y: 80 }, data: { label: "Node A" } },
  { id: "2", type: "simple", position: { x: 250, y: 80 }, data: { label: "Node B" } },
]

/** Demo component for preview */
export default function ControlsDemo() {
  return (
    <div className="h-full w-full min-h-screen">
      <ReactFlowProvider>
        <ReactFlow defaultNodes={initialNodes} nodeTypes={nodeTypes} fitView panOnScroll>
          <Background bgColor="var(--sidebar)" />
          <Controls position="bottom-left" />
        </ReactFlow>
      </ReactFlowProvider>
    </div>
  )
}
