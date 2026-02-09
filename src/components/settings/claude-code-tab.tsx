"use client"

import * as React from "react"
import {
  Key,
  Copy,
  Trash2,
  Check,
  Loader2,
  Circle,
  Terminal,
  ChevronDown,
  ChevronRight,
  Plus,
  ShieldCheck,
} from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Separator } from "@/components/ui/separator"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  createApiKey,
  listApiKeys,
  revokeApiKey,
  deleteApiKey,
} from "@/app/actions/mcp-keys"
import { useBridgeState } from "@/components/agent/chat-provider"

interface ApiKeyRow {
  readonly id: string
  readonly name: string
  readonly keyPrefix: string
  readonly scopes: ReadonlyArray<string>
  readonly lastUsedAt: string | null
  readonly createdAt: string
  readonly expiresAt: string | null
  readonly isActive: boolean
}

function CopyButton({
  text,
}: {
  readonly text: string
}) {
  const [copied, setCopied] = React.useState(false)

  const handleCopy = async () => {
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <Button
      variant="ghost"
      size="icon"
      className="h-7 w-7 shrink-0"
      onClick={handleCopy}
    >
      {copied ? (
        <Check className="h-3.5 w-3.5 text-green-500" />
      ) : (
        <Copy className="h-3.5 w-3.5" />
      )}
    </Button>
  )
}

function SetupInstructions() {
  const [expanded, setExpanded] =
    React.useState(false)

  const steps = [
    {
      label: "Generate an API key above",
      code: null,
    },
    {
      label: "Install the bridge daemon",
      code: "npm install -g compass-bridge",
    },
    {
      label: "Initialize with your Compass URL",
      code: "compass-bridge init",
    },
    {
      label: "Paste your API key when prompted",
      code: null,
    },
    {
      label: "Start the daemon",
      code: "compass-bridge start",
    },
  ]

  return (
    <div className="space-y-2">
      <button
        type="button"
        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
        onClick={() => setExpanded((v) => !v)}
      >
        {expanded ? (
          <ChevronDown className="h-3 w-3" />
        ) : (
          <ChevronRight className="h-3 w-3" />
        )}
        Setup instructions
      </button>

      {expanded && (
        <div className="space-y-2 pl-4">
          {steps.map((step, i) => (
            <div key={i} className="space-y-1">
              <p className="text-xs">
                <span className="text-muted-foreground">
                  {i + 1}.
                </span>{" "}
                {step.label}
              </p>
              {step.code && (
                <div className="flex items-center gap-1 bg-muted rounded px-2 py-1.5">
                  <Terminal className="h-3 w-3 text-muted-foreground shrink-0" />
                  <code className="text-[11px] flex-1 font-mono">
                    {step.code}
                  </code>
                  <CopyButton text={step.code} />
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function CreateKeyDialog({
  onCreated,
}: {
  readonly onCreated: () => void
}) {
  const [open, setOpen] = React.useState(false)
  const [name, setName] = React.useState("")
  const [scopes, setScopes] = React.useState<
    Set<string>
  >(new Set(["read", "write"]))
  const [creating, setCreating] = React.useState(false)
  const [newKey, setNewKey] = React.useState<
    string | null
  >(null)

  const toggleScope = (scope: string) => {
    setScopes((prev) => {
      const next = new Set(prev)
      if (next.has(scope)) next.delete(scope)
      else next.add(scope)
      return next
    })
  }

  const handleCreate = async () => {
    if (!name.trim()) return
    setCreating(true)
    const result = await createApiKey(
      name.trim(),
      Array.from(scopes),
    )
    setCreating(false)

    if (result.success) {
      setNewKey(result.key)
      onCreated()
    } else {
      toast.error(result.error)
    }
  }

  const handleClose = () => {
    setOpen(false)
    setName("")
    setScopes(new Set(["read", "write"]))
    setNewKey(null)
  }

  return (
    <Dialog open={open} onOpenChange={(v) => {
      if (!v) handleClose()
      else setOpen(true)
    }}>
      <DialogTrigger asChild>
        <Button size="sm" className="h-8">
          <Plus className="h-3.5 w-3.5 mr-1" />
          Generate Key
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-sm">
            {newKey
              ? "Key Created"
              : "Generate API Key"}
          </DialogTitle>
          <DialogDescription className="text-xs">
            {newKey
              ? "Copy this key now. It won't be shown again."
              : "Create a key for the compass-bridge daemon."}
          </DialogDescription>
        </DialogHeader>

        {newKey ? (
          <div className="space-y-3">
            <div className="flex items-center gap-2 bg-muted rounded-md px-3 py-2">
              <code className="text-xs font-mono flex-1 break-all select-all">
                {newKey}
              </code>
              <CopyButton text={newKey} />
            </div>
            <div className="flex items-start gap-2 text-amber-600 dark:text-amber-400">
              <ShieldCheck className="h-4 w-4 shrink-0 mt-0.5" />
              <p className="text-xs">
                Store this key securely. It cannot be
                retrieved after closing this dialog.
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="key-name" className="text-xs">
                Name
              </Label>
              <Input
                id="key-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="My workstation"
                className="h-9 text-sm"
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Scopes</Label>
              <div className="space-y-2">
                {[
                  {
                    id: "read",
                    label: "Read",
                    desc: "Query data, recall memories, list themes",
                  },
                  {
                    id: "write",
                    label: "Write",
                    desc: "Save memories, set themes, CRUD operations",
                  },
                  {
                    id: "admin",
                    label: "Admin",
                    desc: "Install/uninstall skills",
                  },
                ].map((scope) => (
                  <label
                    key={scope.id}
                    className="flex items-start gap-2 cursor-pointer"
                  >
                    <Checkbox
                      checked={scopes.has(scope.id)}
                      onCheckedChange={() =>
                        toggleScope(scope.id)
                      }
                      className="mt-0.5"
                    />
                    <div>
                      <p className="text-xs font-medium">
                        {scope.label}
                      </p>
                      <p className="text-[10px] text-muted-foreground">
                        {scope.desc}
                      </p>
                    </div>
                  </label>
                ))}
              </div>
            </div>
          </div>
        )}

        <DialogFooter>
          {newKey ? (
            <Button
              size="sm"
              className="h-8"
              onClick={handleClose}
            >
              Done
            </Button>
          ) : (
            <Button
              size="sm"
              className="h-8"
              onClick={handleCreate}
              disabled={
                creating ||
                !name.trim() ||
                scopes.size === 0
              }
            >
              {creating && (
                <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
              )}
              Generate
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function KeyRow({
  apiKey,
  onRevoke,
  onDelete,
}: {
  readonly apiKey: ApiKeyRow
  readonly onRevoke: (id: string) => void
  readonly onDelete: (id: string) => void
}) {
  const scopes = apiKey.scopes

  return (
    <div className="flex items-center gap-3 rounded-md border px-3 py-2">
      <Key className="h-4 w-4 text-muted-foreground shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium truncate">
            {apiKey.name}
          </span>
          <Badge
            variant={apiKey.isActive ? "default" : "secondary"}
            className="text-[10px] px-1.5 py-0"
          >
            {apiKey.isActive ? "active" : "revoked"}
          </Badge>
        </div>
        <div className="flex items-center gap-2 mt-0.5">
          <code className="text-[10px] text-muted-foreground font-mono">
            {apiKey.keyPrefix}...
          </code>
          <span className="text-[10px] text-muted-foreground">
            {scopes.join(", ")}
          </span>
          {apiKey.lastUsedAt && (
            <span className="text-[10px] text-muted-foreground">
              used{" "}
              {new Date(
                apiKey.lastUsedAt,
              ).toLocaleDateString()}
            </span>
          )}
        </div>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        {apiKey.isActive && (
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => onRevoke(apiKey.id)}
            title="Revoke"
          >
            <Circle className="h-3.5 w-3.5" />
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-destructive hover:text-destructive"
          onClick={() => onDelete(apiKey.id)}
          title="Delete"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  )
}

export function ClaudeCodeTab() {
  const [keys, setKeys] = React.useState<
    ReadonlyArray<ApiKeyRow>
  >([])
  const [loading, setLoading] = React.useState(true)

  // use shared bridge state from ChatProvider
  const bridge = useBridgeState()

  const loadKeys = React.useCallback(async () => {
    const result = await listApiKeys()
    if (result.success) {
      setKeys(result.data)
    }
    setLoading(false)
  }, [])

  React.useEffect(() => {
    loadKeys()
  }, [loadKeys])

  const handleRevoke = async (id: string) => {
    const prev = keys
    setKeys((k) =>
      k.map((key) =>
        key.id === id
          ? { ...key, isActive: false }
          : key,
      ),
    )

    const result = await revokeApiKey(id)
    if (result.success) {
      toast.success("Key revoked")
    } else {
      setKeys(prev)
      toast.error(result.error)
    }
  }

  const handleDelete = async (id: string) => {
    const prev = keys
    setKeys((k) => k.filter((key) => key.id !== id))

    const result = await deleteApiKey(id)
    if (result.success) {
      toast.success("Key deleted")
    } else {
      setKeys(prev)
      toast.error(result.error)
    }
  }

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label className="text-xs">Claude Code</Label>
        <p className="text-muted-foreground text-xs">
          Connect Claude Code to Compass via a local
          bridge daemon. Uses your own Anthropic API key
          for inference.
        </p>
      </div>

      {/* connection status */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <div
            className={`h-2 w-2 rounded-full ${
              bridge.bridgeConnected
                ? "bg-green-500"
                : "bg-red-500"
            }`}
          />
          <span className="text-xs">
            {bridge.bridgeConnected
              ? "Bridge daemon detected"
              : "Bridge daemon not running"}
          </span>
        </div>
        <Switch
          checked={bridge.bridgeEnabled}
          onCheckedChange={bridge.setBridgeEnabled}
        />
      </div>

      <Separator />

      {/* API keys */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-xs">API Keys</Label>
          <CreateKeyDialog onCreated={loadKeys} />
        </div>

        {loading ? (
          <div className="space-y-2 pt-1">
            <div className="bg-muted h-12 animate-pulse rounded-md" />
            <div className="bg-muted h-12 animate-pulse rounded-md" />
          </div>
        ) : keys.length === 0 ? (
          <p className="text-muted-foreground text-xs py-2">
            No API keys yet. Generate one to connect
            the bridge daemon.
          </p>
        ) : (
          <div className="space-y-1.5">
            {keys.map((key) => (
              <KeyRow
                key={key.id}
                apiKey={key}
                onRevoke={handleRevoke}
                onDelete={handleDelete}
              />
            ))}
          </div>
        )}
      </div>

      <Separator />

      <SetupInstructions />
    </div>
  )
}
