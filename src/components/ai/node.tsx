"use client"

import { Handle, Position } from "@xyflow/react"
import type { ComponentProps } from "react"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { cn } from "@/lib/utils"

export type NodeProps = ComponentProps<typeof Card> & {
  handles: {
    target: boolean
    source: boolean
  }
}

export const Node = ({ handles, className, ...props }: NodeProps) => (
  <Card
    className={cn("node-container relative size-full h-auto w-sm gap-0 rounded-md p-0", className)}
    {...props}
  >
    {handles.target && <Handle position={Position.Left} type="target" />}
    {handles.source && <Handle position={Position.Right} type="source" />}
    {props.children}
  </Card>
)

export type NodeHeaderProps = ComponentProps<typeof CardHeader>

export const NodeHeader = ({ className, ...props }: NodeHeaderProps) => (
  <CardHeader
    className={cn("gap-0.5 rounded-t-md border-b bg-secondary p-3!", className)}
    {...props}
  />
)

export type NodeTitleProps = ComponentProps<typeof CardTitle>

export const NodeTitle = (props: NodeTitleProps) => <CardTitle {...props} />

export type NodeDescriptionProps = ComponentProps<typeof CardDescription>

export const NodeDescription = (props: NodeDescriptionProps) => <CardDescription {...props} />

export type NodeActionProps = ComponentProps<typeof CardAction>

export const NodeAction = (props: NodeActionProps) => <CardAction {...props} />

export type NodeContentProps = ComponentProps<typeof CardContent>

export const NodeContent = ({ className, ...props }: NodeContentProps) => (
  <CardContent className={cn("p-3", className)} {...props} />
)

export type NodeFooterProps = ComponentProps<typeof CardFooter>

export const NodeFooter = ({ className, ...props }: NodeFooterProps) => (
  <CardFooter className={cn("rounded-b-md border-t bg-secondary p-3!", className)} {...props} />
)

import { Background, type Edge, ReactFlow, ReactFlowProvider } from "@xyflow/react"
import { BrainIcon, CheckCircleIcon, DatabaseIcon, SendIcon, ZapIcon } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import "@xyflow/react/dist/style.css"

const TriggerNode = ({ data }: { data: { label: string } }) => (
  <Node handles={{ target: false, source: true }} className="w-48">
    <NodeHeader>
      <NodeTitle className="flex items-center gap-2 text-sm">
        <ZapIcon className="size-3.5 text-yellow-500" />
        {data.label}
      </NodeTitle>
    </NodeHeader>
    <NodeContent className="py-2">
      <p className="text-muted-foreground text-xs">Starts the workflow</p>
    </NodeContent>
  </Node>
)

const AgentNode = ({ data }: { data: { label: string; model: string } }) => (
  <Node handles={{ target: true, source: true }} className="w-56">
    <NodeHeader>
      <NodeTitle className="flex items-center gap-2 text-sm">
        <BrainIcon className="size-3.5 text-purple-500" />
        {data.label}
      </NodeTitle>
      <NodeDescription className="text-xs">{data.model}</NodeDescription>
    </NodeHeader>
    <NodeContent className="py-2">
      <div className="flex flex-wrap gap-1">
        <Badge variant="outline" className="text-xs">
          search
        </Badge>
        <Badge variant="outline" className="text-xs">
          code
        </Badge>
      </div>
    </NodeContent>
  </Node>
)

const DataNode = ({ data }: { data: { label: string; source: string } }) => (
  <Node handles={{ target: true, source: true }} className="w-48">
    <NodeHeader>
      <NodeTitle className="flex items-center gap-2 text-sm">
        <DatabaseIcon className="size-3.5 text-blue-500" />
        {data.label}
      </NodeTitle>
    </NodeHeader>
    <NodeContent className="py-2">
      <p className="font-mono text-muted-foreground text-xs">{data.source}</p>
    </NodeContent>
  </Node>
)

const OutputNode = ({ data }: { data: { label: string } }) => (
  <Node handles={{ target: true, source: false }} className="w-48">
    <NodeHeader>
      <NodeTitle className="flex items-center gap-2 text-sm">
        <SendIcon className="size-3.5 text-green-500" />
        {data.label}
      </NodeTitle>
    </NodeHeader>
    <NodeContent className="py-2">
      <div className="flex items-center gap-1.5 text-green-600 text-xs">
        <CheckCircleIcon className="size-3" />
        Ready
      </div>
    </NodeContent>
  </Node>
)

const nodeTypes = {
  trigger: TriggerNode,
  agent: AgentNode,
  data: DataNode,
  output: OutputNode,
}

const initialNodes = [
  { id: "1", type: "trigger", position: { x: 0, y: 100 }, data: { label: "User Input" } },
  {
    id: "2",
    type: "data",
    position: { x: 220, y: 0 },
    data: { label: "Context", source: "vectordb" },
  },
  {
    id: "3",
    type: "agent",
    position: { x: 220, y: 120 },
    data: { label: "AI Agent", model: "claude-3.5-sonnet" },
  },
  { id: "4", type: "output", position: { x: 500, y: 100 }, data: { label: "Response" } },
]

const initialEdges: Edge[] = [
  { id: "e1-3", source: "1", target: "3", type: "smoothstep" },
  { id: "e2-3", source: "2", target: "3", type: "smoothstep" },
  { id: "e3-4", source: "3", target: "4", type: "smoothstep" },
]

/** Demo component for preview */
export default function NodeDemo() {
  return (
    <div className="h-full min-h-[500px] w-full">
      <ReactFlowProvider>
        <ReactFlow
          defaultNodes={initialNodes}
          defaultEdges={initialEdges}
          nodeTypes={nodeTypes}
          fitView
          fitViewOptions={{ padding: 0.3 }}
          panOnScroll
          proOptions={{ hideAttribution: true }}
        >
          <Background gap={16} size={1} />
        </ReactFlow>
      </ReactFlowProvider>
    </div>
  )
}
