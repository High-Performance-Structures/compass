"use client"

import * as React from "react"
import { Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { CreateChannelDialog } from "./create-channel-dialog"

export function CreateChannelButton() {
  const [open, setOpen] = React.useState(false)

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Plus className="mr-2 h-4 w-4" />
        Create Channel
      </Button>
      <CreateChannelDialog open={open} onOpenChange={setOpen} />
    </>
  )
}
