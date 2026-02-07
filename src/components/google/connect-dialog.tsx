"use client"

import { useState, useRef } from "react"
import {
  IconBrandGoogleDrive,
  IconUpload,
  IconLoader2,
  IconCheck,
} from "@tabler/icons-react"

import { connectGoogleDrive } from "@/app/actions/google-drive"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import { toast } from "sonner"

export function GoogleConnectDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [keyFile, setKeyFile] = useState<string | null>(null)
  const [keyFileName, setKeyFileName] = useState("")
  const [domain, setDomain] = useState("")
  const [loading, setLoading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleFileSelect = (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = e.target.files?.[0]
    if (!file) return

    setKeyFileName(file.name)
    const reader = new FileReader()
    reader.onload = ev => {
      const content = ev.target?.result
      if (typeof content === "string") {
        setKeyFile(content)
        // try to extract domain hint from client_email
        try {
          const parsed = JSON.parse(content)
          if (parsed.client_email) {
            // not setting domain automatically - admin needs to enter workspace domain
          }
        } catch {
          // ignore
        }
      }
    }
    reader.readAsText(file)
  }

  const handleConnect = async () => {
    if (!keyFile || !domain.trim()) return

    setLoading(true)
    const result = await connectGoogleDrive(
      keyFile,
      domain.trim()
    )

    if (result.success) {
      toast.success("Google Drive connected")
      setKeyFile(null)
      setKeyFileName("")
      setDomain("")
      onOpenChange(false)
    } else {
      toast.error(result.error)
    }
    setLoading(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <IconBrandGoogleDrive size={20} />
            Connect Google Drive
          </DialogTitle>
          <DialogDescription>
            Upload your Google service account JSON key and
            enter your workspace domain.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label className="text-xs">
              Service Account Key (JSON)
            </Label>
            <div
              className="flex items-center gap-2 rounded-lg border border-dashed p-3 cursor-pointer hover:border-primary/50"
              onClick={() => fileInputRef.current?.click()}
            >
              {keyFile ? (
                <>
                  <IconCheck
                    size={16}
                    className="text-green-500 shrink-0"
                  />
                  <span className="text-sm truncate">
                    {keyFileName}
                  </span>
                </>
              ) : (
                <>
                  <IconUpload
                    size={16}
                    className="text-muted-foreground shrink-0"
                  />
                  <span className="text-sm text-muted-foreground">
                    Click to select JSON key file
                  </span>
                </>
              )}
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept=".json"
              className="hidden"
              onChange={handleFileSelect}
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">
              Workspace Domain
            </Label>
            <Input
              placeholder="e.g. openrangeconstruction.ltd"
              value={domain}
              onChange={e => setDomain(e.target.value)}
              disabled={loading}
            />
            <p className="text-xs text-muted-foreground">
              The Google Workspace domain your organization
              uses.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={loading}
          >
            Cancel
          </Button>
          <Button
            onClick={handleConnect}
            disabled={!keyFile || !domain.trim() || loading}
          >
            {loading && (
              <IconLoader2
                size={16}
                className="mr-2 animate-spin"
              />
            )}
            Connect
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
