"use client"

import {
  BaseEdge,
  type EdgeProps,
  getBezierPath,
  getSimpleBezierPath,
  type InternalNode,
  type Node,
  Position,
  useInternalNode,
} from "@xyflow/react"

const Temporary = ({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
}: EdgeProps) => {
  const [edgePath] = getSimpleBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  })

  return (
    <BaseEdge
      className="stroke-1 stroke-ring"
      id={id}
      path={edgePath}
      style={{
        strokeDasharray: "5, 5",
      }}
    />
  )
}

const getHandleCoordsByPosition = (node: InternalNode<Node>, handlePosition: Position) => {
  // Choose the handle type based on position - Left is for target, Right is for source
  const handleType = handlePosition === Position.Left ? "target" : "source"

  const handle = node.internals.handleBounds?.[handleType]?.find(h => h.position === handlePosition)

  if (!handle) {
    return [0, 0] as const
  }

  let offsetX = handle.width / 2
  let offsetY = handle.height / 2

  // this is a tiny detail to make the markerEnd of an edge visible.
  // The handle position that gets calculated has the origin top-left, so depending which side we are using, we add a little offset
  // when the handlePosition is Position.Right for example, we need to add an offset as big as the handle itself in order to get the correct position
  switch (handlePosition) {
    case Position.Left:
      offsetX = 0
      break
    case Position.Right:
      offsetX = handle.width
      break
    case Position.Top:
      offsetY = 0
      break
    case Position.Bottom:
      offsetY = handle.height
      break
    default:
      throw new Error(`Invalid handle position: ${handlePosition}`)
  }

  const x = node.internals.positionAbsolute.x + handle.x + offsetX
  const y = node.internals.positionAbsolute.y + handle.y + offsetY

  return [x, y] as const
}

const getEdgeParams = (source: InternalNode<Node>, target: InternalNode<Node>) => {
  const sourcePos = Position.Right
  const [sx, sy] = getHandleCoordsByPosition(source, sourcePos)
  const targetPos = Position.Left
  const [tx, ty] = getHandleCoordsByPosition(target, targetPos)

  return {
    sx,
    sy,
    tx,
    ty,
    sourcePos,
    targetPos,
  }
}

const Animated = ({ id, source, target, markerEnd, style }: EdgeProps) => {
  const sourceNode = useInternalNode(source)
  const targetNode = useInternalNode(target)

  if (!(sourceNode && targetNode)) {
    return null
  }

  const { sx, sy, tx, ty, sourcePos, targetPos } = getEdgeParams(sourceNode, targetNode)

  const [edgePath] = getBezierPath({
    sourceX: sx,
    sourceY: sy,
    sourcePosition: sourcePos,
    targetX: tx,
    targetY: ty,
    targetPosition: targetPos,
  })

  return (
    <>
      <BaseEdge id={id} markerEnd={markerEnd} path={edgePath} style={style} />
      <circle fill="var(--primary)" r="4">
        <animateMotion dur="2s" path={edgePath} repeatCount="indefinite" />
      </circle>
    </>
  )
}

export const Edge = {
  Temporary,
  Animated,
}

import { Background, Handle, ReactFlow, ReactFlowProvider } from "@xyflow/react"
import "@xyflow/react/dist/style.css"

const SimpleNode = ({ data }: { data: { label: string } }) => (
  <div className="relative rounded-md border bg-card px-4 py-2 text-sm font-medium">
    <Handle type="target" position={Position.Left} className="!bg-primary !w-2 !h-2" />
    {data.label}
    <Handle type="source" position={Position.Right} className="!bg-primary !w-2 !h-2" />
  </div>
)

const nodeTypes = { simple: SimpleNode }
const edgeTypes = { animated: Animated, temporary: Temporary }

const initialNodes = [
  { id: "1", type: "simple", position: { x: 50, y: 80 }, data: { label: "Start" } },
  { id: "2", type: "simple", position: { x: 220, y: 80 }, data: { label: "Process" } },
  { id: "3", type: "simple", position: { x: 390, y: 80 }, data: { label: "End" } },
]

const initialEdges = [
  { id: "e1-2", source: "1", target: "2", type: "animated" },
  { id: "e2-3", source: "2", target: "3", type: "temporary" },
]

/** Demo component for preview */
export default function EdgeDemo() {
  return (
    <div className="h-full min-h-[500px] w-full">
      <ReactFlowProvider>
        <ReactFlow
          defaultNodes={initialNodes}
          defaultEdges={initialEdges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          fitView
          fitViewOptions={{ padding: 0.4 }}
          panOnScroll
          proOptions={{ hideAttribution: true }}
        >
          <Background gap={16} size={1} />
        </ReactFlow>
      </ReactFlowProvider>
    </div>
  )
}
