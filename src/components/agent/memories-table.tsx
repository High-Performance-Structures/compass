"use client"

import * as React from "react"
import { Pin, PinOff, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  getSlabMemories,
  deleteSlabMemory,
  toggleSlabMemoryPin,
} from "@/app/actions/memories"
import type { SlabMemory } from "@/db/schema"

const TYPE_VARIANTS: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  preference: "default",
  workflow: "secondary",
  fact: "outline",
  decision: "destructive",
}

export function MemoriesTable() {
  const [memories, setMemories] = React.useState<ReadonlyArray<SlabMemory>>([])
  const [loading, setLoading] = React.useState(true)

  React.useEffect(() => {
    getSlabMemories().then((result) => {
      if (result.success) {
        setMemories(result.memories)
      }
      setLoading(false)
    })
  }, [])

  const handleDelete = async (id: string) => {
    const prev = memories
    setMemories((m) => m.filter((item) => item.id !== id))

    const result = await deleteSlabMemory(id)
    if (result.success) {
      toast.success("Memory deleted")
    } else {
      setMemories(prev)
      toast.error(result.error)
    }
  }

  const handleTogglePin = async (id: string, currentPinned: boolean) => {
    const next = !currentPinned
    setMemories((m) =>
      m.map((item) =>
        item.id === id ? { ...item, pinned: next } : item,
      ),
    )

    const result = await toggleSlabMemoryPin(id, next)
    if (!result.success) {
      setMemories((m) =>
        m.map((item) =>
          item.id === id ? { ...item, pinned: currentPinned } : item,
        ),
      )
      toast.error(result.error)
    }
  }

  if (loading) {
    return (
      <div className="space-y-3">
        <div className="bg-muted h-4 w-48 animate-pulse rounded" />
        <div className="bg-muted h-4 w-64 animate-pulse rounded" />
        <div className="bg-muted h-4 w-40 animate-pulse rounded" />
      </div>
    )
  }

  if (memories.length === 0) {
    return (
      <p className="text-muted-foreground text-sm py-4">
        Slab hasn&apos;t saved any memories yet.
      </p>
    )
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-[80px] text-xs">Type</TableHead>
          <TableHead className="text-xs">Content</TableHead>
          <TableHead className="w-[72px] text-xs text-right">
            Actions
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {memories.map((memory) => (
          <TableRow key={memory.id}>
            <TableCell className="py-2">
              <Badge
                variant={TYPE_VARIANTS[memory.memoryType] ?? "secondary"}
                className="text-[10px] px-1.5 py-0"
              >
                {memory.memoryType}
              </Badge>
            </TableCell>
            <TableCell className="py-2 text-xs max-w-[280px] truncate">
              {memory.content}
            </TableCell>
            <TableCell className="py-2 text-right">
              <div className="flex items-center justify-end gap-0.5">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={() => handleTogglePin(memory.id, memory.pinned)}
                  title={memory.pinned ? "Unpin" : "Pin"}
                >
                  {memory.pinned ? (
                    <PinOff className="h-3.5 w-3.5" />
                  ) : (
                    <Pin className="h-3.5 w-3.5" />
                  )}
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-destructive hover:text-destructive"
                  onClick={() => handleDelete(memory.id)}
                  title="Delete"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
