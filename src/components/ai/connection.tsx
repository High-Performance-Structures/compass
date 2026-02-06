"use client"

import type { ConnectionLineComponent } from "@xyflow/react"

const HALF = 0.5

export const Connection: ConnectionLineComponent = ({ fromX, fromY, toX, toY }) => (
  <g>
    <path
      className="animated"
      d={`M${fromX},${fromY} C ${fromX + (toX - fromX) * HALF},${fromY} ${fromX + (toX - fromX) * HALF},${toY} ${toX},${toY}`}
      fill="none"
      stroke="var(--color-ring)"
      strokeWidth={1}
    />
    <circle cx={toX} cy={toY} fill="#fff" r={3} stroke="var(--color-ring)" strokeWidth={1} />
  </g>
)

import {
  addEdge,
  Background,
  type Edge,
  type Connection as FlowConnection,
  Handle,
  Position,
  ReactFlow,
  ReactFlowProvider,
} from "@xyflow/react"
import "@xyflow/react/dist/style.css"
import { useCallback, useState } from "react"

const DemoNode = ({ data }: { data: { label: string } }) => (
  <div className="relative rounded-lg border-2 border-dashed border-primary/50 bg-card px-6 py-3 text-sm font-medium shadow-sm">
    <Handle
      type="target"
      position={Position.Left}
      className="!bg-primary !w-3 !h-3 !border-2 !border-background"
    />
    {data.label}
    <Handle
      type="source"
      position={Position.Right}
      className="!bg-primary !w-3 !h-3 !border-2 !border-background"
    />
  </div>
)

const nodeTypes = { demo: DemoNode }

const initialNodes = [
  { id: "1", type: "demo", position: { x: 50, y: 50 }, data: { label: "Node A" } },
  { id: "2", type: "demo", position: { x: 50, y: 150 }, data: { label: "Node B" } },
  { id: "3", type: "demo", position: { x: 300, y: 100 }, data: { label: "Node C" } },
]

/** Demo component for preview */
export default function ConnectionDemo() {
  const [edges, setEdges] = useState<Edge[]>([])

  const onConnect = useCallback(
    (params: FlowConnection) => setEdges(eds => addEdge(params, eds)),
    [],
  )

  return (
    <div className="h-full min-h-[500px] w-full">
      <ReactFlowProvider>
        <ReactFlow
          defaultNodes={initialNodes}
          edges={edges}
          onConnect={onConnect}
          nodeTypes={nodeTypes}
          connectionLineComponent={Connection}
          fitView
          fitViewOptions={{ padding: 0.5 }}
          proOptions={{ hideAttribution: true }}
        >
          <Background gap={16} size={1} />
          <div className="absolute bottom-4 left-4 rounded-md bg-background/80 px-3 py-2 text-muted-foreground text-xs backdrop-blur-sm">
            Drag from a handle to create a connection
          </div>
        </ReactFlow>
      </ReactFlowProvider>
    </div>
  )
}
