"use client"

import type { ToolUIPart } from "ai"
import {
  CheckCircleIcon,
  ChevronDownIcon,
  LoaderIcon,
  XCircleIcon,
} from "lucide-react"
import type { ComponentProps, ReactNode } from "react"
import { isValidElement } from "react"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { cn } from "@/lib/utils"
import { CodeBlock } from "@/components/ai/code-block"

export type ToolProps = ComponentProps<typeof Collapsible>

export const Tool = ({ className, ...props }: ToolProps) => (
  <Collapsible className={cn("not-prose mb-2", className)} {...props} />
)

export interface ToolHeaderProps {
  title?: string
  type: ToolUIPart["type"]
  state: ToolUIPart["state"]
  className?: string
}

const getStatusIcon = (status: ToolUIPart["state"]): ReactNode => {
  switch (status) {
    case "input-streaming":
    case "input-available":
      return <LoaderIcon className="size-3.5 animate-spin text-muted-foreground" />
    case "output-available":
      return <CheckCircleIcon className="size-3.5 text-primary" />
    case "output-error":
    case "output-denied":
      return <XCircleIcon className="size-3.5 text-destructive" />
    default:
      return <LoaderIcon className="size-3.5 text-muted-foreground" />
  }
}

const isInProgress = (status: ToolUIPart["state"]): boolean =>
  status === "input-streaming" || status === "input-available"

export const ToolHeader = ({ className, title, type, state, ...props }: ToolHeaderProps) => (
  <CollapsibleTrigger
    className={cn(
      "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted/80",
      className,
    )}
    {...props}
  >
    {getStatusIcon(state)}
    <span>
      {title ?? type.split("-").slice(1).join("-")}
      {isInProgress(state) && "..."}
    </span>
    <ChevronDownIcon className="size-3 opacity-50 transition-transform group-data-[state=open]:rotate-180" />
  </CollapsibleTrigger>
)

export type ToolContentProps = ComponentProps<typeof CollapsibleContent>

export const ToolContent = ({ className, ...props }: ToolContentProps) => (
  <CollapsibleContent
    className={cn(
      "mt-1 rounded-lg border bg-muted/30 data-[state=closed]:fade-out-0 data-[state=closed]:slide-out-to-top-2 data-[state=open]:slide-in-from-top-2 text-popover-foreground outline-none data-[state=closed]:animate-out data-[state=open]:animate-in",
      className,
    )}
    {...props}
  />
)

export type ToolInputProps = ComponentProps<"div"> & {
  input: ToolUIPart["input"]
}

export const ToolInput = ({ className, input, ...props }: ToolInputProps) => (
  <div className={cn("space-y-2 overflow-hidden p-3", className)} {...props}>
    <h4 className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
      Parameters
    </h4>
    <div className="rounded-md bg-muted/50">
      <CodeBlock code={JSON.stringify(input, null, 2)} language="json" />
    </div>
  </div>
)

export type ToolOutputProps = ComponentProps<"div"> & {
  output: ToolUIPart["output"]
  errorText: ToolUIPart["errorText"]
}

export const ToolOutput = ({ className, output, errorText, ...props }: ToolOutputProps) => {
  if (!(output || errorText)) {
    return null
  }

  let Output = <div>{output as ReactNode}</div>

  if (typeof output === "object" && !isValidElement(output)) {
    Output = <CodeBlock code={JSON.stringify(output, null, 2)} language="json" />
  } else if (typeof output === "string") {
    Output = <CodeBlock code={output} language="json" />
  }

  return (
    <div className={cn("space-y-2 p-3", className)} {...props}>
      <h4 className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
        {errorText ? "Error" : "Result"}
      </h4>
      <div
        className={cn(
          "overflow-x-auto rounded-md text-xs [&_table]:w-full",
          errorText ? "bg-destructive/10 text-destructive" : "bg-muted/50 text-foreground",
        )}
      >
        {errorText && <div>{errorText}</div>}
        {Output}
      </div>
    </div>
  )
}

/** Demo component for preview */
export default function ToolDemo() {
  return (
    <div className="w-full max-w-2xl p-6">
      <Tool defaultOpen>
        <ToolHeader title="Weather Lookup" type="tool-invocation" state="output-available" />
        <ToolContent>
          <ToolInput
            input={{
              location: "San Francisco, CA",
              units: "fahrenheit",
            }}
          />
          <ToolOutput
            output={{
              temperature: 68,
              condition: "Partly cloudy",
              humidity: 65,
              wind: "12 mph NW",
            }}
            errorText={undefined}
          />
        </ToolContent>
      </Tool>
    </div>
  )
}
