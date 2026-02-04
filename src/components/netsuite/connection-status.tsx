"use client"

import * as React from "react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import {
  initiateNetSuiteOAuth,
  disconnectNetSuite,
  getNetSuiteConnectionStatus,
} from "@/app/actions/netsuite-sync"

export function NetSuiteConnectionStatus() {
  const [status, setStatus] = React.useState<{
    configured: boolean
    connected: boolean
    accountId: string | null
  } | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [actionLoading, setActionLoading] = React.useState(false)

  React.useEffect(() => {
    getNetSuiteConnectionStatus().then(s => {
      setStatus(s)
      setLoading(false)
    })
  }, [])

  const handleConnect = async () => {
    setActionLoading(true)
    const result = await initiateNetSuiteOAuth()
    if (result.success && result.authorizeUrl) {
      // set state cookie before redirecting
      document.cookie = `netsuite_oauth_state=${result.state}; path=/; max-age=600; secure; samesite=lax`
      window.location.href = result.authorizeUrl
    }
    setActionLoading(false)
  }

  const handleDisconnect = async () => {
    setActionLoading(true)
    await disconnectNetSuite()
    setStatus(prev =>
      prev ? { ...prev, connected: false } : prev
    )
    setActionLoading(false)
  }

  if (loading) {
    return (
      <div className="space-y-3">
        <div className="bg-muted h-4 w-48 animate-pulse rounded" />
        <div className="bg-muted h-4 w-32 animate-pulse rounded" />
      </div>
    )
  }

  if (!status?.configured) {
    return (
      <div className="space-y-3">
        <p className="text-muted-foreground text-sm">
          NetSuite integration is not configured.
          Set the required environment variables to enable it.
        </p>
        <div className="text-muted-foreground space-y-1 text-xs font-mono">
          <div>NETSUITE_CLIENT_ID</div>
          <div>NETSUITE_CLIENT_SECRET</div>
          <div>NETSUITE_ACCOUNT_ID</div>
          <div>NETSUITE_REDIRECT_URI</div>
          <div>NETSUITE_TOKEN_ENCRYPTION_KEY</div>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">NetSuite</span>
            <Badge
              variant={status.connected ? "default" : "secondary"}
            >
              {status.connected ? "Connected" : "Not connected"}
            </Badge>
          </div>
          {status.accountId && (
            <p className="text-muted-foreground text-xs">
              Account: {status.accountId}
            </p>
          )}
        </div>

        {status.connected ? (
          <Button
            variant="outline"
            size="sm"
            onClick={handleDisconnect}
            disabled={actionLoading}
          >
            Disconnect
          </Button>
        ) : (
          <Button
            size="sm"
            onClick={handleConnect}
            disabled={actionLoading}
          >
            Connect
          </Button>
        )}
      </div>

      <Separator />

      {status.connected && (
        <p className="text-muted-foreground text-sm">
          OAuth 2.0 connected. Customers, vendors, and financial
          records will sync automatically.
        </p>
      )}
    </div>
  )
}
