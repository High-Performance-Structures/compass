"use client"

import type { ReactNode } from "react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"

type TalkLeaveConfirmationProps = {
  readonly open: boolean
  readonly busy: boolean
  readonly error: string | null
  readonly canEndMeeting: boolean
  readonly hasUnsavedNotes: boolean
  readonly onOpenChange: (open: boolean) => void
  readonly onLeave: () => void
  readonly onEndMeeting: () => void
}

export function TalkLeaveConfirmation(props: TalkLeaveConfirmationProps): ReactNode {
  return (
    <Dialog open={props.open} onOpenChange={open => { if (!props.busy) props.onOpenChange(open) }}>
      <DialogContent className="dark z-[130]" showCloseButton={!props.busy}>
        <DialogHeader>
          <DialogTitle>Leave meeting?</DialogTitle>
          <DialogDescription>
            Leave the call yourself{props.canEndMeeting ? ", or end the meeting and disconnect everyone." : ". Other participants can stay in the call."}
          </DialogDescription>
        </DialogHeader>
        {props.hasUnsavedNotes ? (
          <p className="text-sm text-muted-foreground">
            Your notes have not been saved to the conversation. They stay in this browser and reappear the next time you open this meeting.
          </p>
        ) : null}
        {props.error ? <p role="alert" className="text-sm text-destructive">{props.error}</p> : null}
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="outline" disabled={props.busy} onClick={() => props.onOpenChange(false)}>Cancel</Button>
          <Button variant="secondary" disabled={props.busy} onClick={props.onLeave}>Leave meeting</Button>
          {props.canEndMeeting ? <Button variant="destructive" disabled={props.busy} onClick={props.onEndMeeting}>End for Everyone</Button> : null}
        </div>
      </DialogContent>
    </Dialog>
  )
}
