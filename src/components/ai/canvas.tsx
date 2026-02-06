"use client"

import { Background, ReactFlow, type ReactFlowProps } from "@xyflow/react"
import type { ReactNode } from "react"
import "@xyflow/react/dist/style.css"

type CanvasProps = ReactFlowProps & {
  children?: ReactNode
}

export const Canvas = ({ children, ...props }: CanvasProps) => (
  <ReactFlow
    deleteKeyCode={["Backspace", "Delete"]}
    fitView
    panOnDrag={false}
    panOnScroll
    selectionOnDrag={true}
    zoomOnDoubleClick={false}
    {...props}
  >
    <Background bgColor="var(--sidebar)" />
    {children}
  </ReactFlow>
)

import {
  addEdge,
  type Connection,
  type Edge,
  type Node as ReactFlowNode,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
} from "@xyflow/react"
import { PlusIcon, ZapIcon } from "lucide-react"
import { useCallback, useMemo } from "react"
import { Button } from "@/components/ui/button"
import { Controls } from "@/components/ai/controls"
import { Node, NodeHeader, NodeTitle } from "@/components/ai/node"
import { Panel } from "@/components/ai/panel"

const AgentNode = ({ data }: { data: { label: string } }) => (
  <Node handles={{ target: true, source: true }} className="w-[140px]">
    <NodeHeader className="p-2">
      <NodeTitle className="flex items-center gap-1.5 text-xs">
        <ZapIcon className="size-3" />
        {data.label}
      </NodeTitle>
    </NodeHeader>
  </Node>
)

const initialNodes: ReactFlowNode[] = [
  { id: "1", type: "agent", position: { x: 50, y: 100 }, data: { label: "Input" } },
  { id: "2", type: "agent", position: { x: 300, y: 100 }, data: { label: "Process" } },
  { id: "3", type: "agent", position: { x: 550, y: 100 }, data: { label: "Output" } },
]

const initialEdges: Edge[] = [
  { id: "e1-2", source: "1", target: "2" },
  { id: "e2-3", source: "2", target: "3" },
]

/** Demo component for preview */
export default function CanvasDemo() {
  const nodeTypes = useMemo(() => ({ agent: AgentNode }), [])
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges)

  const onConnect = useCallback(
    (params: Connection) => setEdges(eds => addEdge(params, eds)),
    [setEdges],
  )

  const addNode = useCallback(() => {
    const id = `${Date.now()}`
    const newNode: ReactFlowNode = {
      id,
      type: "agent",
      position: { x: Math.random() * 400 + 100, y: Math.random() * 200 + 50 },
      data: { label: `Node ${nodes.length + 1}` },
    }
    setNodes(nds => [...nds, newNode])
  }, [nodes.length, setNodes])

  return (
    <div className="h-full w-full min-h-screen">
      <ReactFlowProvider>
        <Canvas
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          nodeTypes={nodeTypes}
        >
          <Controls />
          <Panel position="top-right">
            <Button size="sm" variant="ghost" onClick={addNode}>
              <PlusIcon className="size-4" />
              Add Node
            </Button>
          </Panel>
        </Canvas>
      </ReactFlowProvider>
    </div>
  )
}
