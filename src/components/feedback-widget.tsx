"use client"

import { createContext, useContext, useState } from "react"
import { usePathname } from "next/navigation"
import { MessageCircle } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

const FeedbackContext = createContext<{ open: () => void }>({ open: () => {} })

export function useFeedback() {
  return useContext(FeedbackContext)
}

export function FeedbackCallout() {
  const { open } = useFeedback()
  return (
    <p className="text-primary font-semibold">
      Have feedback?{" "}
      <button onClick={open} className="underline underline-offset-2 hover:opacity-80">
        Let us know what you think
      </button>
      {" "}— we&apos;d love to hear from you.
    </p>
  )
}

export function FeedbackWidget({ children }: { children?: React.ReactNode }) {
  const [dialogOpen, setDialogOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [type, setType] = useState<string>("")
  const [message, setMessage] = useState("")
  const [name, setName] = useState("")
  const [email, setEmail] = useState("")
  const pathname = usePathname()

  function resetForm() {
    setType("")
    setMessage("")
    setName("")
    setEmail("")
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!type || !message.trim()) return

    setSubmitting(true)
    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type,
          message,
          name: name || undefined,
          email: email || undefined,
          pageUrl: pathname,
          userAgent: navigator.userAgent,
          viewportWidth: window.innerWidth,
          viewportHeight: window.innerHeight,
        }),
      })

      if (res.ok) {
        toast.success("Feedback submitted, thank you!")
        resetForm()
        setDialogOpen(false)
      } else {
        const data = await res.json() as { error?: string }
        toast.error(data.error || "Something went wrong")
      }
    } catch {
      toast.error("Failed to submit feedback")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <FeedbackContext.Provider value={{ open: () => setDialogOpen(true) }}>
      {children}

      <Button
        onClick={() => setDialogOpen(true)}
        size="icon-lg"
        className="group fixed bottom-12 right-6 z-40 gap-0 rounded-full shadow-lg transition-all duration-200 hover:w-auto hover:gap-2 hover:px-4 overflow-hidden hidden md:flex"
      >
        <MessageCircle className="size-5 shrink-0" />
        <span className="max-w-0 overflow-hidden whitespace-nowrap opacity-0 transition-all duration-200 group-hover:max-w-40 group-hover:opacity-100">
          Feedback
        </span>
      </Button>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-[calc(100%-2rem)] sm:max-w-md p-4 sm:p-6">
          <DialogHeader className="space-y-1.5">
            <DialogTitle className="text-base sm:text-lg">Send Feedback</DialogTitle>
            <DialogDescription className="text-xs sm:text-sm">
              Report a bug, request a feature, or ask a question.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="grid gap-3 sm:gap-4">
            <div className="grid gap-1.5">
              <Label htmlFor="feedback-type" className="text-xs sm:text-sm">Type</Label>
              <Select value={type} onValueChange={setType}>
                <SelectTrigger id="feedback-type" className="h-9">
                  <SelectValue placeholder="Select type..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="bug">Bug Report</SelectItem>
                  <SelectItem value="feature">Feature Request</SelectItem>
                  <SelectItem value="question">Question</SelectItem>
                  <SelectItem value="general">General Feedback</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="feedback-message" className="text-xs sm:text-sm">Message</Label>
              <Textarea
                id="feedback-message"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Describe your feedback..."
                maxLength={2000}
                rows={3}
                required
                className="text-sm resize-none"
              />
              <p className="text-xs text-muted-foreground text-right">
                {message.length}/2000
              </p>
            </div>

            <div className="grid sm:grid-cols-2 gap-3 sm:gap-4">
              <div className="grid gap-1.5">
                <Label htmlFor="feedback-name" className="text-xs sm:text-sm">Name (optional)</Label>
                <Input
                  id="feedback-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Your name"
                  className="h-9 text-sm"
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="feedback-email" className="text-xs sm:text-sm">Email (optional)</Label>
                <Input
                  id="feedback-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  className="h-9 text-sm"
                />
              </div>
            </div>

            <Button type="submit" disabled={submitting || !type || !message.trim()} className="h-9 text-sm">
              {submitting ? "Submitting..." : "Submit Feedback"}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </FeedbackContext.Provider>
  )
}
