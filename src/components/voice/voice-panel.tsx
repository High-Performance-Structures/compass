"use client"

import * as React from "react"
import {
  IconAntenna,
  IconPhoneOff,
  IconScreenShare,
  IconScreenShareOff,
  IconVideo,
  IconVideoOff,
  IconWaveSine,
  IconSparkles,
} from "@tabler/icons-react"
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip"
import { useVoiceState } from "@/hooks/use-voice-state"
import { cn } from "@/lib/utils"

export function VoicePanel(): React.ReactElement {
  const {
    channelName,
    isScreenSharing,
    isCameraOn,
    isNoiseSuppression,
    toggleScreenShare,
    toggleCamera,
    toggleNoiseSuppression,
    leaveChannel,
  } = useVoiceState()

  return (
    <div className="group-data-[collapsible=icon]:hidden border-t border-sidebar-border">
      {/* Connection status and disconnect */}
      <div className="p-2">
        <div className="mb-1 flex items-center gap-1.5 text-xs text-emerald-500">
          <IconAntenna className="size-3.5" />
          <span className="font-medium">Voice Connected</span>
        </div>
        <div className="mb-2 flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className="truncate">#{channelName}</span>
            <span>2👤</span>
          </div>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={leaveChannel}
                className="flex size-6 items-center justify-center rounded-md text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"
                aria-label="Disconnect"
              >
                <IconPhoneOff className="size-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent>Disconnect</TooltipContent>
          </Tooltip>
        </div>

        {/* Toggle controls row */}
        <div className="flex items-center gap-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={toggleScreenShare}
                className={cn(
                  "flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground",
                  isScreenSharing && "bg-sidebar-accent text-foreground"
                )}
                aria-label="Toggle screen share"
              >
                {isScreenSharing ? (
                  <IconScreenShare className="size-4" />
                ) : (
                  <IconScreenShareOff className="size-4" />
                )}
              </button>
            </TooltipTrigger>
            <TooltipContent>Screen Share</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={toggleCamera}
                className={cn(
                  "flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground",
                  isCameraOn && "bg-sidebar-accent text-foreground"
                )}
                aria-label="Toggle camera"
              >
                {isCameraOn ? (
                  <IconVideo className="size-4" />
                ) : (
                  <IconVideoOff className="size-4" />
                )}
              </button>
            </TooltipTrigger>
            <TooltipContent>Camera</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={toggleNoiseSuppression}
                className={cn(
                  "flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground",
                  isNoiseSuppression && "bg-sidebar-accent text-foreground"
                )}
                aria-label="Toggle noise suppression"
              >
                <IconWaveSine className="size-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent>Noise Suppression</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                disabled
                className="flex size-7 items-center justify-center rounded-md text-muted-foreground opacity-50"
                aria-label="Activities (coming soon)"
              >
                <IconSparkles className="size-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent>Activities (coming soon)</TooltipContent>
          </Tooltip>
        </div>
      </div>
    </div>
  )
}
