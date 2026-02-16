"use client"

import * as React from "react"
import { IconCheck } from "@tabler/icons-react"
import { cn } from "@/lib/utils"

type DevicePickerProps = {
  readonly devices: MediaDeviceInfo[]
  readonly selectedDeviceId: string | undefined
  readonly onSelectDevice: (deviceId: string) => void
  readonly label: string
}

function cleanDeviceLabel(label: string): string {
  return label.replace(/\(([\da-fA-F]{4}:[\da-fA-F]{4})\)$/, "").trim()
}

export function DevicePicker({
  devices,
  selectedDeviceId,
  onSelectDevice,
  label,
}: DevicePickerProps): React.ReactElement {
  return (
    <div className="p-2">
      <div className="mb-2 px-2 text-xs font-medium text-muted-foreground">
        {label}
      </div>
      {devices.length === 0 ? (
        <div className="px-2 py-4 text-center text-sm text-muted-foreground">
          No devices found
        </div>
      ) : (
        <div className="space-y-0.5">
          {devices.map((device) => {
            const isSelected = device.deviceId === selectedDeviceId
            return (
              <button
                key={device.deviceId}
                type="button"
                onClick={() => onSelectDevice(device.deviceId)}
                className={cn(
                  "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-accent",
                  isSelected && "bg-accent"
                )}
              >
                <div className="flex size-4 shrink-0 items-center justify-center">
                  {isSelected && <IconCheck className="size-3.5" />}
                </div>
                <span className="flex-1 truncate text-left">
                  {cleanDeviceLabel(device.label) || "Unknown Device"}
                </span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
