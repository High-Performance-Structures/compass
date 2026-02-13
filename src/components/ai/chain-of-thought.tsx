"use client"

import { useControllableState } from "@radix-ui/react-use-controllable-state"
import {
  BrainIcon,
  ChevronDownIcon,
  DotIcon,
  ImageIcon,
  LoaderIcon,
  type LucideIcon,
  SearchIcon,
} from "lucide-react"
import type { ComponentProps, ReactNode } from "react"
import { createContext, memo, useContext, useMemo } from "react"
import { Badge } from "@/components/ui/badge"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { cn } from "@/lib/utils"

interface ChainOfThoughtContextValue {
  isOpen: boolean
  setIsOpen: (open: boolean) => void
}

const ChainOfThoughtContext = createContext<ChainOfThoughtContextValue | null>(null)

const useChainOfThought = () => {
  const context = useContext(ChainOfThoughtContext)
  if (!context) {
    throw new Error("ChainOfThought components must be used within ChainOfThought")
  }
  return context
}

export type ChainOfThoughtProps = ComponentProps<"div"> & {
  open?: boolean
  defaultOpen?: boolean
  onOpenChange?: (open: boolean) => void
}

export const ChainOfThought = memo(
  ({
    className,
    open,
    defaultOpen = false,
    onOpenChange,
    children,
    ...props
  }: ChainOfThoughtProps) => {
    const [isOpen, setIsOpen] = useControllableState({
      prop: open,
      defaultProp: defaultOpen,
      onChange: onOpenChange,
    })

    const chainOfThoughtContext = useMemo(() => ({ isOpen, setIsOpen }), [isOpen, setIsOpen])

    return (
      <ChainOfThoughtContext.Provider value={chainOfThoughtContext}>
        <Collapsible
          className={cn("not-prose mb-2", className)}
          onOpenChange={setIsOpen}
          open={isOpen}
          {...props}
        >
          {children}
        </Collapsible>
      </ChainOfThoughtContext.Provider>
    )
  },
)

export type ChainOfThoughtHeaderProps = ComponentProps<typeof CollapsibleTrigger> & {
  isStreaming?: boolean
}

export const ChainOfThoughtHeader = memo(
  ({ className, children, isStreaming = false, ...props }: ChainOfThoughtHeaderProps) => {
    const { isOpen } = useChainOfThought()

    return (
      <CollapsibleTrigger
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted/80",
          className,
        )}
        {...props}
      >
        {isStreaming ? (
          <LoaderIcon className="size-3.5 animate-spin" />
        ) : (
          <BrainIcon className="size-3.5" />
        )}
        <span>{children ?? "Chain of Thought"}</span>
        <ChevronDownIcon
          className={cn(
            "size-3 opacity-50 transition-transform group-data-[state=open]:rotate-180",
            isOpen ? "rotate-180" : "rotate-0",
          )}
        />
      </CollapsibleTrigger>
    )
  },
)

export type ChainOfThoughtStepProps = ComponentProps<"div"> & {
  icon?: LucideIcon
  label: ReactNode
  description?: ReactNode
  status?: "complete" | "active" | "pending"
}

export const ChainOfThoughtStep = memo(
  ({
    className,
    icon: Icon = DotIcon,
    label,
    description,
    status = "complete",
    children,
    ...props
  }: ChainOfThoughtStepProps) => {
    const statusStyles = {
      complete: "text-muted-foreground",
      active: "text-foreground",
      pending: "text-muted-foreground/50",
    }

    const iconClassName = status === "active" ? "animate-pulse" : ""

    return (
      <div
        className={cn(
          "flex gap-2 text-sm",
          statusStyles[status],
          "fade-in-0 slide-in-from-top-2 animate-in",
          className,
        )}
        {...props}
      >
        <div className="relative mt-0.5">
          {status === "active" ? (
            <LoaderIcon className={cn("size-3.5 animate-spin", iconClassName)} />
          ) : (
            <Icon className={cn("size-3.5", iconClassName)} />
          )}
          <div className="-mx-px absolute top-5 bottom-0 left-1/2 w-px bg-border" />
        </div>
        <div className="flex-1 space-y-2 overflow-hidden">
          <div>{label}</div>
          {description && <div className="text-muted-foreground text-xs">{description}</div>}
          {children}
        </div>
      </div>
    )
  },
)

export type ChainOfThoughtSearchResultsProps = ComponentProps<"div">

export const ChainOfThoughtSearchResults = memo(
  ({ className, ...props }: ChainOfThoughtSearchResultsProps) => (
    <div className={cn("flex flex-wrap items-center gap-2", className)} {...props} />
  ),
)

export type ChainOfThoughtSearchResultProps = ComponentProps<typeof Badge>

export const ChainOfThoughtSearchResult = memo(
  ({ className, children, ...props }: ChainOfThoughtSearchResultProps) => (
    <Badge
      className={cn("gap-1 px-2 py-0.5 font-normal text-xs", className)}
      variant="secondary"
      {...props}
    >
      {children}
    </Badge>
  ),
)

export type ChainOfThoughtContentProps = ComponentProps<typeof CollapsibleContent>

export const ChainOfThoughtContent = memo(
  ({ className, children, ...props }: ChainOfThoughtContentProps) => {
    return (
      <CollapsibleContent
        className={cn(
          "mt-1 rounded-lg border bg-muted/30 p-3 text-sm",
          "data-[state=closed]:fade-out-0 data-[state=closed]:slide-out-to-top-2",
          "data-[state=open]:slide-in-from-top-2 text-popover-foreground outline-none",
          "data-[state=closed]:animate-out data-[state=open]:animate-in",
          className,
        )}
        {...props}
      >
        <div className="space-y-3">{children}</div>
      </CollapsibleContent>
    )
  },
)

export type ChainOfThoughtImageProps = ComponentProps<"div"> & {
  caption?: string
}

export const ChainOfThoughtImage = memo(
  ({ className, children, caption, ...props }: ChainOfThoughtImageProps) => (
    <div className={cn("mt-2 space-y-2", className)} {...props}>
      <div className="relative flex max-h-[22rem] items-center justify-center overflow-hidden rounded-lg bg-muted p-3">
        {children}
      </div>
      {caption && <p className="text-muted-foreground text-xs">{caption}</p>}
    </div>
  ),
)

ChainOfThought.displayName = "ChainOfThought"
ChainOfThoughtHeader.displayName = "ChainOfThoughtHeader"
ChainOfThoughtStep.displayName = "ChainOfThoughtStep"
ChainOfThoughtSearchResults.displayName = "ChainOfThoughtSearchResults"
ChainOfThoughtSearchResult.displayName = "ChainOfThoughtSearchResult"
ChainOfThoughtContent.displayName = "ChainOfThoughtContent"
ChainOfThoughtImage.displayName = "ChainOfThoughtImage"

import { Image } from "@/components/ai/image"

const exampleImage = {
  base64:
    "iVBORw0KGgoAAAANSUhEUgAAASwAAADICAYAAABS39xVAAAACXBIWXMAABYlAAAWJQFJUiTwAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAABLkSURBVHgB7d1rUxvXGQfw5+xqJXQBCRACgSE4tsEXsJvGaduknU7TTt9m0neZaT/AdNq+yxfoh+hMp9O0SdO0TemkjePYsbExNuYiQCAJSavdPX3OauViISSwJFbw/DEwWqF9zln2t+ecPXtWABEREREREREREREREREREREREREREdFl",
  mediaType: "image/png" as const,
  uint8Array: new Uint8Array([]),
}

/** Demo component for preview */
export default function ChainOfThoughtDemo() {
  return (
    <ChainOfThought defaultOpen>
      <ChainOfThoughtHeader />
      <ChainOfThoughtContent>
        <ChainOfThoughtStep
          icon={SearchIcon}
          label="Searching for chocolate chip cookie recipes"
          status="complete"
        >
          <ChainOfThoughtSearchResults>
            {[
              "https://www.allrecipes.com",
              "https://www.foodnetwork.com",
              "https://www.seriouseats.com",
            ].map(website => (
              <ChainOfThoughtSearchResult key={website}>
                {new URL(website).hostname}
              </ChainOfThoughtSearchResult>
            ))}
          </ChainOfThoughtSearchResults>
        </ChainOfThoughtStep>

        <ChainOfThoughtStep
          icon={ImageIcon}
          label="Found a highly-rated recipe with 4.8 stars"
          status="complete"
        >
          <ChainOfThoughtImage caption="Classic chocolate chip cookies fresh from the oven.">
            <Image
              alt="Chocolate chip cookies"
              base64={exampleImage.base64}
              className="aspect-square h-[150px] border"
              mediaType={exampleImage.mediaType}
              uint8Array={exampleImage.uint8Array}
            />
          </ChainOfThoughtImage>
        </ChainOfThoughtStep>

        <ChainOfThoughtStep
          label="This recipe uses brown butter for extra flavor and requires chilling the dough."
          status="complete"
        />

        <ChainOfThoughtStep
          icon={SearchIcon}
          label="Looking for ingredient substitutions..."
          status="active"
        >
          <ChainOfThoughtSearchResults>
            {["https://www.kingarthurbaking.com", "https://www.thekitchn.com"].map(website => (
              <ChainOfThoughtSearchResult key={website}>
                {new URL(website).hostname}
              </ChainOfThoughtSearchResult>
            ))}
          </ChainOfThoughtSearchResults>
        </ChainOfThoughtStep>
      </ChainOfThoughtContent>
    </ChainOfThought>
  )
}
