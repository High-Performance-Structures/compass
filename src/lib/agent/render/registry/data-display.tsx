"use client"

// Small display pieces Jarvis can render: Image, Avatar, Badge, Alert,
// Progress, Rating.
// Part of the agent render registry; ../registry.tsx combines every group.

import { Label } from "@/components/ui/label"
import { Progress } from "@/components/ui/progress"
import { Badge } from "@/components/ui/badge"
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert"
import type { ComponentMap } from "./types"

export const dataDisplayComponents: ComponentMap<
  | "Image"
  | "Avatar"
  | "Badge"
  | "Alert"
  | "Progress"
  | "Rating"
> = {
  // --- Data Display ---

  Image: ({ props }) => (
    <div
      className="bg-muted border border-border rounded flex items-center justify-center text-xs text-muted-foreground aspect-video"
      style={{
        width: props.width ?? 80,
        height: props.height ?? 60,
      }}
    >
      {props.alt || "img"}
    </div>
  ),

  Avatar: ({ props }) => {
    const initials = (props.name || "?")
      .split(" ")
      .map((n) => n[0])
      .join("")
      .slice(0, 2)
      .toUpperCase()
    const size =
      props.size === "lg"
        ? "w-12 h-12 text-base"
        : props.size === "sm"
          ? "w-8 h-8 text-xs"
          : "w-10 h-10 text-sm"

    return (
      <div
        className={`${size} rounded-full bg-muted flex items-center justify-center font-medium`}
      >
        {initials}
      </div>
    )
  },

  Badge: ({ props }) => {
    const colorMap: Record<string, string> = {
      success:
        "bg-success/10 text-success  ",
      warning:
        "bg-warning/10 text-warning  ",
      danger:
        "bg-destructive/10 text-destructive  ",
    }
    const dotMap: Record<string, string> = {
      success: "bg-success",
      warning: "bg-warning",
      danger: "bg-destructive",
      default: "bg-muted-foreground",
    }
    const v = props.variant ?? "default"
    const colors = colorMap[v] ?? ""
    const dot = dotMap[v] ?? dotMap.default

    return (
      <Badge
        variant={v === "default" ? "default" : "secondary"}
        className={colors}
      >
        <span
          className={`size-1.5 rounded-full shrink-0 ${dot}`}
        />
        {props.text}
      </Badge>
    )
  },

  Alert: ({ props }) => {
    const variant =
      props.type === "error" ? "destructive" : "default"
    const custom =
      props.type === "success"
        ? "border-success/30 bg-success/10 text-success   "
        : props.type === "warning"
          ? "border-warning/30 bg-warning/10 text-warning   "
          : props.type === "info"
            ? "border-info/30 bg-info/10 text-info   "
            : ""

    return (
      <Alert variant={variant} className={custom}>
        <AlertTitle>{props.title}</AlertTitle>
        {props.message && (
          <AlertDescription>
            {props.message}
          </AlertDescription>
        )}
      </Alert>
    )
  },

  Progress: ({ props }) => {
    const value = Math.min(
      100,
      Math.max(0, props.value || 0)
    )
    const pctColor =
      value >= 75
        ? "text-success "
        : value >= 40
          ? "text-warning "
          : "text-destructive "

    return (
      <div className="space-y-2">
        {props.label && (
          <Label className="text-sm text-muted-foreground">
            {props.label}
          </Label>
        )}
        <div className="flex items-center gap-2">
          <Progress value={value} className="flex-1" />
          <span
            className={`text-xs font-medium tabular-nums ${pctColor}`}
          >
            {value}%
          </span>
        </div>
      </div>
    )
  },

  Rating: ({ props }) => {
    const max = props.max ?? 5
    return (
      <div className="space-y-2">
        {props.label && (
          <Label className="text-sm text-muted-foreground">
            {props.label}
          </Label>
        )}
        <div className="flex gap-1">
          {Array.from({ length: max }).map((_, i) => (
            <span
              key={i}
              className={`text-lg ${i < props.value ? "text-warning" : "text-muted"}`}
            >
              *
            </span>
          ))}
        </div>
      </div>
    )
  },
}
