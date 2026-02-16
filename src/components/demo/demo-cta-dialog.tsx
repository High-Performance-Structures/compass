"use client"

import Link from "next/link"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"

interface DemoCtaDialogProps {
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
}

export function DemoCtaDialog({ open, onOpenChange }: DemoCtaDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Ready to build your own workspace?</DialogTitle>
          <DialogDescription>
            Sign up to create projects, manage schedules, and collaborate with
            your team.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
          <Button asChild variant="outline">
            <Link href="/login">Log in</Link>
          </Button>
          <Button asChild>
            <Link href="/signup">Sign up</Link>
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
