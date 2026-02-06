"use client"

import { useControllableState } from "@radix-ui/react-use-controllable-state"
import {
  CircleIcon,
  LoaderCircleIcon,
  MarsIcon,
  PauseIcon,
  PlayIcon,
  VenusIcon,
} from "lucide-react"
import type { ComponentProps, ReactNode } from "react"
import { createContext, useContext, useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@/components/ui/command"
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { cn } from "@/lib/utils"

interface VoiceSelectorContextValue {
  value: string | undefined
  setValue: (value: string | undefined) => void
  open: boolean
  setOpen: (open: boolean) => void
}

const VoiceSelectorContext = createContext<VoiceSelectorContextValue | null>(null)

export const useVoiceSelector = () => {
  const context = useContext(VoiceSelectorContext)
  if (!context) {
    throw new Error("VoiceSelector components must be used within VoiceSelector")
  }
  return context
}

export type VoiceSelectorProps = ComponentProps<typeof Dialog> & {
  value?: string
  defaultValue?: string
  onValueChange?: (value: string | undefined) => void
}

export const VoiceSelector = ({
  value: valueProp,
  defaultValue,
  onValueChange,
  open: openProp,
  defaultOpen = false,
  onOpenChange,
  children,
  ...props
}: VoiceSelectorProps) => {
  const [value, setValue] = useControllableState({
    prop: valueProp,
    defaultProp: defaultValue,
    onChange: onValueChange,
  })

  const [open, setOpen] = useControllableState({
    prop: openProp,
    defaultProp: defaultOpen,
    onChange: onOpenChange,
  })

  const voiceSelectorContext = useMemo(
    () => ({ value, setValue, open: open ?? false, setOpen }),
    [value, setValue, open, setOpen],
  )

  return (
    <VoiceSelectorContext.Provider value={voiceSelectorContext}>
      <Dialog onOpenChange={setOpen} open={open} {...props}>
        {children}
      </Dialog>
    </VoiceSelectorContext.Provider>
  )
}

export type VoiceSelectorTriggerProps = ComponentProps<typeof DialogTrigger>

export const VoiceSelectorTrigger = (props: VoiceSelectorTriggerProps) => (
  <DialogTrigger {...props} />
)

export type VoiceSelectorContentProps = ComponentProps<typeof DialogContent> & {
  title?: ReactNode
}

export const VoiceSelectorContent = ({
  className,
  children,
  title = "Voice Selector",
  ...props
}: VoiceSelectorContentProps) => (
  <DialogContent className={cn("p-0", className)} {...props}>
    <DialogTitle className="sr-only">{title}</DialogTitle>
    <Command>{children}</Command>
  </DialogContent>
)

export type VoiceSelectorInputProps = ComponentProps<typeof CommandInput>

export const VoiceSelectorInput = ({ className, ...props }: VoiceSelectorInputProps) => (
  <CommandInput className={cn("h-auto py-3.5", className)} {...props} />
)

export type VoiceSelectorListProps = ComponentProps<typeof CommandList>

export const VoiceSelectorList = (props: VoiceSelectorListProps) => <CommandList {...props} />

export type VoiceSelectorEmptyProps = ComponentProps<typeof CommandEmpty>

export const VoiceSelectorEmpty = (props: VoiceSelectorEmptyProps) => <CommandEmpty {...props} />

export type VoiceSelectorGroupProps = ComponentProps<typeof CommandGroup>

export const VoiceSelectorGroup = (props: VoiceSelectorGroupProps) => <CommandGroup {...props} />

export type VoiceSelectorItemProps = ComponentProps<typeof CommandItem>

export const VoiceSelectorItem = ({ className, ...props }: VoiceSelectorItemProps) => (
  <CommandItem className={cn("px-4 py-2", className)} {...props} />
)

export type VoiceSelectorShortcutProps = ComponentProps<typeof CommandShortcut>

export const VoiceSelectorShortcut = (props: VoiceSelectorShortcutProps) => (
  <CommandShortcut {...props} />
)

export type VoiceSelectorSeparatorProps = ComponentProps<typeof CommandSeparator>

export const VoiceSelectorSeparator = (props: VoiceSelectorSeparatorProps) => (
  <CommandSeparator {...props} />
)

export type VoiceSelectorGenderProps = ComponentProps<"span"> & {
  value?: "male" | "female" | "transgender" | "androgyne" | "non-binary" | "intersex"
}

export const VoiceSelectorGender = ({
  className,
  value,
  children,
  ...props
}: VoiceSelectorGenderProps) => {
  let icon: ReactNode | null = null

  switch (value) {
    case "male":
      icon = <MarsIcon className="size-4" />
      break
    case "female":
      icon = <VenusIcon className="size-4" />
      break
    default:
      icon = <CircleIcon className="size-4" />
  }

  return (
    <span className={cn("text-muted-foreground text-xs", className)} {...props}>
      {children ?? icon}
    </span>
  )
}

export type VoiceSelectorAccentProps = ComponentProps<"span"> & {
  value?: string
}

const accentEmojis: Record<string, string> = {
  american: "\u{1F1FA}\u{1F1F8}",
  british: "\u{1F1EC}\u{1F1E7}",
  australian: "\u{1F1E6}\u{1F1FA}",
  canadian: "\u{1F1E8}\u{1F1E6}",
  irish: "\u{1F1EE}\u{1F1EA}",
  indian: "\u{1F1EE}\u{1F1F3}",
  french: "\u{1F1EB}\u{1F1F7}",
  german: "\u{1F1E9}\u{1F1EA}",
  italian: "\u{1F1EE}\u{1F1F9}",
  spanish: "\u{1F1EA}\u{1F1F8}",
  japanese: "\u{1F1EF}\u{1F1F5}",
  chinese: "\u{1F1E8}\u{1F1F3}",
  korean: "\u{1F1F0}\u{1F1F7}",
}

export const VoiceSelectorAccent = ({
  className,
  value,
  children,
  ...props
}: VoiceSelectorAccentProps) => {
  const emoji = value ? accentEmojis[value] : null

  return (
    <span className={cn("text-muted-foreground text-xs", className)} {...props}>
      {children ?? emoji}
    </span>
  )
}

export type VoiceSelectorAgeProps = ComponentProps<"span">

export const VoiceSelectorAge = ({ className, ...props }: VoiceSelectorAgeProps) => (
  <span className={cn("text-muted-foreground text-xs tabular-nums", className)} {...props} />
)

export type VoiceSelectorNameProps = ComponentProps<"span">

export const VoiceSelectorName = ({ className, ...props }: VoiceSelectorNameProps) => (
  <span className={cn("flex-1 truncate text-left font-medium", className)} {...props} />
)

export type VoiceSelectorDescriptionProps = ComponentProps<"span">

export const VoiceSelectorDescription = ({
  className,
  ...props
}: VoiceSelectorDescriptionProps) => (
  <span className={cn("text-muted-foreground text-xs", className)} {...props} />
)

export type VoiceSelectorAttributesProps = ComponentProps<"div">

export const VoiceSelectorAttributes = ({
  className,
  children,
  ...props
}: VoiceSelectorAttributesProps) => (
  <div className={cn("flex items-center text-xs", className)} {...props}>
    {children}
  </div>
)

export type VoiceSelectorBulletProps = ComponentProps<"span">

export const VoiceSelectorBullet = ({ className, ...props }: VoiceSelectorBulletProps) => (
  <span aria-hidden="true" className={cn("select-none text-border", className)} {...props}>
    &bull;
  </span>
)

export type VoiceSelectorPreviewProps = Omit<ComponentProps<"button">, "children"> & {
  playing?: boolean
  loading?: boolean
  onPlay?: () => void
}

export const VoiceSelectorPreview = ({
  className,
  playing,
  loading,
  onPlay,
  onClick,
  ...props
}: VoiceSelectorPreviewProps) => {
  const handleClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation()
    onClick?.(event)
    onPlay?.()
  }

  let icon = <PlayIcon className="size-3" />

  if (loading) {
    icon = <LoaderCircleIcon className="size-3 animate-spin" />
  } else if (playing) {
    icon = <PauseIcon className="size-3" />
  }

  return (
    <Button
      aria-label={playing ? "Pause preview" : "Play preview"}
      className={cn("size-6", className)}
      disabled={loading}
      onClick={handleClick}
      size="icon"
      type="button"
      variant="outline"
      {...props}
    >
      {icon}
    </Button>
  )
}

/** Demo component for preview */
export default function VoiceSelectorDemo() {
  const [selectedVoice, setSelectedVoice] = useState<string | undefined>()
  const [playingVoice, setPlayingVoice] = useState<string | null>(null)

  const voices = [
    {
      id: "alloy",
      name: "Alloy",
      gender: "female" as const,
      accent: "american",
      description: "Warm and professional",
    },
    {
      id: "echo",
      name: "Echo",
      gender: "male" as const,
      accent: "british",
      description: "Clear and articulate",
    },
    {
      id: "nova",
      name: "Nova",
      gender: "female" as const,
      accent: "australian",
      description: "Friendly and energetic",
    },
    {
      id: "onyx",
      name: "Onyx",
      gender: "male" as const,
      accent: "american",
      description: "Deep and authoritative",
    },
  ]

  return (
    <div className="w-full max-w-sm p-4">
      <VoiceSelector value={selectedVoice} onValueChange={setSelectedVoice}>
        <VoiceSelectorTrigger asChild>
          <Button variant="outline" className="w-full justify-between">
            {selectedVoice ? voices.find(v => v.id === selectedVoice)?.name : "Select voice..."}
          </Button>
        </VoiceSelectorTrigger>
        <VoiceSelectorContent>
          <VoiceSelectorInput placeholder="Search voices..." />
          <VoiceSelectorList>
            <VoiceSelectorEmpty>No voices found.</VoiceSelectorEmpty>
            <VoiceSelectorGroup heading="Available Voices">
              {voices.map(voice => (
                <VoiceSelectorItem
                  key={voice.id}
                  value={voice.id}
                  className="flex items-center gap-3"
                >
                  <VoiceSelectorPreview
                    playing={playingVoice === voice.id}
                    onPlay={() => setPlayingVoice(voice.id)}
                  />
                  <div className="flex flex-1 flex-col">
                    <VoiceSelectorName>{voice.name}</VoiceSelectorName>
                    <VoiceSelectorDescription>{voice.description}</VoiceSelectorDescription>
                  </div>
                  <VoiceSelectorAttributes className="gap-2">
                    <VoiceSelectorGender value={voice.gender} />
                    <VoiceSelectorAccent value={voice.accent} />
                  </VoiceSelectorAttributes>
                </VoiceSelectorItem>
              ))}
            </VoiceSelectorGroup>
          </VoiceSelectorList>
        </VoiceSelectorContent>
      </VoiceSelector>
    </div>
  )
}
