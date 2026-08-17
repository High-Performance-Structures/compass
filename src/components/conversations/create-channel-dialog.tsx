"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { useForm } from "react-hook-form"
import { z } from "zod/v4"
import { zodResolver } from "@hookform/resolvers/zod"
import { Hash, Volume2, Megaphone, Lock } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form"
import { SearchableCombobox } from "@/components/searchable-combobox"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Switch } from "@/components/ui/switch"
import { cn } from "@/lib/utils"
import { createChannel } from "@/app/actions/conversations"
import { listCategories } from "@/app/actions/channel-categories"

const channelSchema = z.object({
  name: z
    .string()
    .min(2, "Name must be at least 2 characters")
    .max(50, "Name must be less than 50 characters")
    .regex(
      /^[a-z0-9-]+$/,
      "Lowercase letters, numbers, and hyphens only"
    ),
  type: z.enum(["text", "voice", "announcement"]),
  categoryId: z.string().nullable(),
  isPrivate: z.boolean(),
})

type ChannelFormData = z.infer<typeof channelSchema>

const channelTypes = [
  {
    value: "text",
    label: "Text",
    icon: Hash,
    description: "Send messages, images, GIFs, and files",
    disabled: false,
  },
  {
    value: "voice",
    label: "Voice",
    icon: Volume2,
    description: "Hang out together with voice, video, and screen share",
    disabled: true,
  },
  {
    value: "announcement",
    label: "Announcement",
    icon: Megaphone,
    description: "Important updates that only admins can post",
    disabled: false,
  },
] as const

type CategoryData = {
  readonly id: string
  readonly name: string
  readonly position: number
  readonly channelCount: number
}

type CreateChannelDialogProps = {
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
  readonly projectId?: string
}

export function CreateChannelDialog({
  open,
  onOpenChange,
  projectId,
}: CreateChannelDialogProps) {
  const router = useRouter()
  const [isSubmitting, setIsSubmitting] = React.useState(false)
  const [categories, setCategories] = React.useState<CategoryData[]>([])
  const [loadingCategories, setLoadingCategories] = React.useState(true)

  React.useEffect(() => {
    async function loadCategories() {
      if (open) {
        const result = await listCategories()
        if (result.success && result.data) {
          setCategories(
            result.data.map((cat) => ({
              id: cat.id,
              name: cat.name,
              position: cat.position,
              channelCount: cat.channelCount,
            }))
          )
        }
        setLoadingCategories(false)
      }
    }
    loadCategories()
  }, [open])

  const form = useForm<ChannelFormData>({
    resolver: zodResolver(channelSchema),
    defaultValues: {
      name: "",
      type: "text",
      categoryId: null,
      isPrivate: false,
    },
  })

  const onSubmit = async (data: ChannelFormData) => {
    setIsSubmitting(true)

    const result = await createChannel({
      name: data.name,
      type: data.type,
      categoryId: data.categoryId,
      isPrivate: data.isPrivate,
      projectId,
    })

    if (result.success && result.data) {
      form.reset()
      onOpenChange(false)
      router.push(`/dashboard/conversations/${result.data.channelId}`)
      router.refresh()
    } else {
      form.setError("root", {
        message: result.error ?? "Failed to create channel",
      })
    }

    setIsSubmitting(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>Create Channel</DialogTitle>
        </DialogHeader>

        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(onSubmit)}
            className="space-y-4"
          >
            {/* channel type - vertical radio cards */}
            <FormField
              control={form.control}
              name="type"
              render={({ field }) => (
                <FormItem className="space-y-2">
                  <FormLabel className="text-sm font-semibold">
                    Channel Type
                  </FormLabel>
                  <FormControl>
                    <RadioGroup
                      onValueChange={field.onChange}
                      defaultValue={field.value}
                      className="space-y-1.5"
                    >
                      {channelTypes.map((ct) => {
                        const Icon = ct.icon
                        const selected = field.value === ct.value
                        return (
                          <label
                            key={ct.value}
                            className={cn(
                              "flex cursor-pointer items-center gap-3",
                              "rounded-md border px-3 py-2 transition-colors",
                              selected
                                ? "border-primary bg-primary/5"
                                : "border-border hover:bg-muted/50",
                              ct.disabled &&
                                "cursor-not-allowed opacity-50"
                            )}
                          >
                            <RadioGroupItem
                              value={ct.value}
                              disabled={ct.disabled}
                              className="shrink-0"
                            />
                            <Icon className="h-5 w-5 shrink-0 text-muted-foreground" />
                            <div className="min-w-0">
                              <div className="text-sm font-medium">
                                {ct.label}
                              </div>
                              <div className="text-xs text-muted-foreground">
                                {ct.description}
                              </div>
                            </div>
                          </label>
                        )
                      })}
                    </RadioGroup>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* channel name with # prefix */}
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem className="space-y-1.5">
                  <FormLabel className="text-sm font-semibold">
                    Channel Name
                  </FormLabel>
                  <FormControl>
                    <div className="relative">
                      <Hash className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        placeholder="new-channel"
                        className="pl-9"
                        {...field}
                        onChange={(e) =>
                          field.onChange(
                            e.target.value
                              .toLowerCase()
                              .replace(/[^a-z0-9-]/g, "-")
                          )
                        }
                      />
                    </div>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* category selector */}
            <FormField
              control={form.control}
              name="categoryId"
              render={({ field }) => (
                <FormItem className="space-y-1.5">
                  <FormLabel className="text-sm font-semibold">
                    Category
                  </FormLabel>
                  <FormControl>
                    <SearchableCombobox
                      value={field.value ?? "none"}
                      onValueChange={(value) =>
                        field.onChange(value === "none" ? null : value)
                      }
                      disabled={loadingCategories}
                      ariaLabel="Channel category"
                      placeholder="Select a category"
                      searchPlaceholder="Search categories..."
                      options={[
                        { value: "none", label: "No Category" },
                        ...categories.map((category) => ({
                          value: category.id,
                          label: category.name,
                        })),
                      ]}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* private toggle */}
            <FormField
              control={form.control}
              name="isPrivate"
              render={({ field }) => (
                <FormItem className="flex items-start gap-3 rounded-md border px-3 py-2">
                  <Lock className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1 space-y-0.5">
                    <FormLabel className="text-sm font-semibold">
                      Private Channel
                    </FormLabel>
                    <p className="text-xs text-muted-foreground">
                      Only selected members and roles will be able
                      to view this channel.
                    </p>
                  </div>
                  <FormControl>
                    <Switch
                      checked={field.value}
                      onCheckedChange={field.onChange}
                    />
                  </FormControl>
                </FormItem>
              )}
            />

            {form.formState.errors.root && (
              <p className="text-sm text-destructive">
                {form.formState.errors.root.message}
              </p>
            )}

            <DialogFooter className="gap-2 sm:gap-2">
              <Button
                type="button"
                variant="outline"
                className="flex-1"
                onClick={() => onOpenChange(false)}
                disabled={isSubmitting}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                className="flex-1"
                disabled={isSubmitting}
              >
                {isSubmitting ? "Creating..." : "Create Channel"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
