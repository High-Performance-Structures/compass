"use client"

import Image from "next/image"
import Link from "next/link"
import { useRouter } from "next/navigation"
import * as React from "react"
import {
  IconBrandFacebook,
  IconBrandInstagram,
  IconBrandX,
  IconSparkles,
  IconTrash,
} from "@tabler/icons-react"
import { toast } from "sonner"

import {
  deleteSocialPostDraft,
  publishSocialPost,
  saveSocialPostDraft,
  suggestSocialPost,
  type SocialPostWorkspace,
} from "@/app/actions/social-posts"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"

function platformIcon(platform: string): React.ReactElement {
  if (platform === "instagram") return <IconBrandInstagram className="size-4" />
  if (platform === "x") return <IconBrandX className="size-4" />
  return <IconBrandFacebook className="size-4" />
}

function platformLabel(platform: string): string {
  if (platform === "instagram") return "Instagram"
  if (platform === "x") return "X"
  return "Facebook"
}

function hashtagInput(values: readonly string[]): string {
  return values.join(" ")
}

function parseHashtags(value: string): readonly string[] {
  return value.split(/[\s,]+/).map((tag) => tag.trim()).filter(Boolean)
}

export function ProjectSocialWorkspace({
  workspace,
}: {
  readonly workspace: SocialPostWorkspace
}): React.ReactElement {
  const router = useRouter()
  const [editingPostId, setEditingPostId] = React.useState<string | undefined>()
  const [heading, setHeading] = React.useState("")
  const [body, setBody] = React.useState("")
  const [hashtags, setHashtags] = React.useState("")
  const [photoIds, setPhotoIds] = React.useState<readonly string[]>([])
  const [platforms, setPlatforms] = React.useState<readonly string[]>(
    workspace.accounts.map((account) => account.platform),
  )
  const [projectAlbum, setProjectAlbum] = React.useState(false)
  const [pending, startTransition] = React.useTransition()

  function toggleValue(values: readonly string[], value: string, checked: boolean): readonly string[] {
    return checked
      ? values.includes(value) ? values : [...values, value]
      : values.filter((item) => item !== value)
  }

  function resetComposer(): void {
    setEditingPostId(undefined)
    setHeading("")
    setBody("")
    setHashtags("")
    setPhotoIds([])
    setPlatforms(workspace.accounts.map((account) => account.platform))
    setProjectAlbum(false)
  }

  function editPost(post: SocialPostWorkspace["posts"][number]): void {
    setEditingPostId(post.id)
    setHeading(post.heading)
    setBody(post.body)
    setHashtags(hashtagInput(post.hashtags))
    setPhotoIds(post.photoIds)
    setPlatforms(post.targets.map((target) => target.platform))
    setProjectAlbum(post.targets.some(
      (target) => target.platform === "facebook" && target.facebookAlbumMode === "project_album",
    ))
    window.scrollTo({ top: 0, behavior: "smooth" })
  }

  function saveDraft(): void {
    startTransition(async () => {
      const result = await saveSocialPostDraft({
        projectId: workspace.project.id,
        postId: editingPostId,
        heading,
        body,
        hashtags: parseHashtags(hashtags),
        photoIds,
        platforms,
        facebookAlbumMode: projectAlbum ? "project_album" : "none",
      })
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success(editingPostId ? "Social draft updated." : "Social draft created.")
      resetComposer()
      router.refresh()
    })
  }

  function suggestCopy(): void {
    startTransition(async () => {
      const result = await suggestSocialPost({
        projectId: workspace.project.id,
        photoIds,
      })
      if (!result.success) {
        toast.error(result.error)
        return
      }
      setHeading(result.suggestion.heading)
      setBody(result.suggestion.body)
      setHashtags(hashtagInput(result.suggestion.hashtags))
      toast.success("AI suggestion added for staff review.")
    })
  }

  function publish(postId: string): void {
    startTransition(async () => {
      const result = await publishSocialPost({
        projectId: workspace.project.id,
        postId,
        confirmPublish: true,
      })
      if (result.success) {
        toast.success("Publishing completed.")
      } else {
        toast.error(result.error)
      }
      router.refresh()
    })
  }

  function removeDraft(postId: string): void {
    startTransition(async () => {
      const result = await deleteSocialPostDraft({
        projectId: workspace.project.id,
        postId,
      })
      if (result.success) {
        toast.success("Draft removed from the active queue.")
      } else {
        toast.error(result.error)
      }
      router.refresh()
    })
  }

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Social publishing · Department {workspace.project.department}
          </p>
          <h1 className="mt-1 text-2xl font-semibold">Project social posts</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Draft from approved photos, review privacy-safe copy, then publish to this department’s accounts.
          </p>
        </div>
        <Button asChild variant="outline">
          <Link href={`/dashboard/projects/${workspace.project.id}/information`}>
            Edit public project identity
          </Link>
        </Button>
      </header>

      {!workspace.project.privacyReady ? (
        <section className="rounded-lg border border-destructive/40 bg-destructive/5 p-4">
          <h2 className="font-semibold">Public project identity required</h2>
          {workspace.project.privacyErrors.map((error) => (
            <p key={error} className="mt-1 text-sm text-muted-foreground">{error}</p>
          ))}
        </section>
      ) : (
        <section className="rounded-lg border bg-card p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Approved public identity
          </p>
          <p className="mt-1 font-semibold">{workspace.project.publicTitle}</p>
          <p className="text-sm text-muted-foreground">{workspace.project.publicLocationCity}</p>
        </section>
      )}

      <section className="rounded-lg border bg-card p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="font-semibold">{editingPostId ? "Edit social draft" : "Create a social draft"}</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              AI suggestions are drafts only. A staff member must review all copy and an approver must confirm publishing.
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            disabled={pending || photoIds.length === 0 || !workspace.project.privacyReady}
            onClick={suggestCopy}
          >
            <IconSparkles className="size-4" />
            Suggest from photos
          </Button>
        </div>

        <Separator className="my-4" />

        <div className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="social-heading">Heading</Label>
            <Input
              id="social-heading"
              value={heading}
              maxLength={120}
              onChange={(event) => setHeading(event.target.value)}
              placeholder="A short project progress heading"
              disabled={!workspace.project.privacyReady}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="social-hashtags">Tags</Label>
            <Input
              id="social-hashtags"
              value={hashtags}
              onChange={(event) => setHashtags(event.target.value)}
              placeholder="#Construction #ProjectProgress"
              disabled={!workspace.project.privacyReady}
            />
          </div>
          <div className="space-y-2 lg:col-span-2">
            <Label htmlFor="social-body">Post text</Label>
            <Textarea
              id="social-body"
              value={body}
              maxLength={2_000}
              rows={5}
              onChange={(event) => setBody(event.target.value)}
              placeholder="Describe the work without names, street addresses, exact dates, or other private details."
              disabled={!workspace.project.privacyReady}
            />
          </div>
        </div>

        <div className="mt-5">
          <Label>Department destinations</Label>
          {workspace.accounts.length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">
              No social accounts are connected for this department. An administrator can connect them in Settings → Integrations.
            </p>
          ) : (
            <div className="mt-2 grid gap-2 sm:grid-cols-3">
              {workspace.accounts.map((account) => (
                <label key={account.id} className="flex items-center gap-2 rounded-md border p-3 text-sm">
                  <Checkbox
                    checked={platforms.includes(account.platform)}
                    onCheckedChange={(checked) => setPlatforms((current) =>
                      toggleValue(current, account.platform, checked === true)
                    )}
                  />
                  {platformIcon(account.platform)}
                  <span className="min-w-0">
                    <span className="block font-medium">{platformLabel(account.platform)}</span>
                    <span className="block truncate text-xs text-muted-foreground">{account.accountName}</span>
                  </span>
                </label>
              ))}
            </div>
          )}
          {platforms.includes("facebook") ? (
            <label className="mt-3 flex items-start gap-2 text-sm">
              <Checkbox
                checked={projectAlbum}
                onCheckedChange={(checked) => setProjectAlbum(checked === true)}
              />
              <span>
                <span className="block font-medium">Use this project’s Facebook album</span>
                <span className="block text-xs text-muted-foreground">
                  Compass will reuse a Page album with the same privacy-safe public title, or create it when none exists.
                </span>
              </span>
            </label>
          ) : null}
        </div>

        <div className="mt-5">
          <div className="flex items-center justify-between gap-3">
            <Label>Approved public photos</Label>
            <span className="text-xs text-muted-foreground">{photoIds.length} selected</span>
          </div>
          {workspace.photos.length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">
              Mark approved photos as public-shareable in Photo review before using them here.
            </p>
          ) : (
            <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
              {workspace.photos.map((photo) => {
                const selected = photoIds.includes(photo.id)
                return (
                  <label
                    key={photo.id}
                    className={cn(
                      "cursor-pointer overflow-hidden rounded-md border text-left transition",
                      selected ? "border-primary ring-2 ring-primary/20" : "hover:border-muted-foreground/50",
                    )}
                  >
                    <input
                      type="checkbox"
                      className="sr-only"
                      checked={selected}
                      onChange={(event) => setPhotoIds((current) =>
                        toggleValue(current, photo.id, event.target.checked)
                      )}
                    />
                    <div className="relative aspect-square bg-muted">
                      <Image
                        src={`/api/projects/${workspace.project.id}/photos/${photo.id}`}
                        alt={photo.caption ?? photo.fileName}
                        fill
                        sizes="(max-width: 640px) 50vw, 180px"
                        className="object-cover"
                        unoptimized
                      />
                      <span className="absolute left-2 top-2 flex size-5 items-center justify-center bg-background/90">
                        <span aria-hidden="true" className={cn(
                          "size-3 border",
                          selected && "border-primary bg-primary",
                        )} />
                      </span>
                    </div>
                    <span className="block truncate px-2 py-1.5 text-xs">{photo.caption ?? photo.fileName}</span>
                  </label>
                )
              })}
            </div>
          )}
        </div>

        <div className="mt-5 flex flex-wrap justify-end gap-2">
          {editingPostId ? (
            <Button type="button" variant="outline" onClick={resetComposer} disabled={pending}>
              Cancel edit
            </Button>
          ) : null}
          <Button
            type="button"
            onClick={saveDraft}
            disabled={
              pending ||
              !workspace.project.privacyReady ||
              workspace.accounts.length === 0 ||
              platforms.length === 0 ||
              !heading.trim() ||
              !body.trim()
            }
          >
            {editingPostId ? "Save draft changes" : "Create draft"}
          </Button>
        </div>
      </section>

      <section className="rounded-lg border bg-card">
        <div className="p-4 sm:p-5">
          <h2 className="font-semibold">Project social history</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Drafts, destination results, and published links remain visible for review.
          </p>
        </div>
        <div className="divide-y border-t">
          {workspace.posts.map((post) => (
            <article key={post.id} className="p-4 sm:p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-medium">{post.heading}</h3>
                    <Badge variant={post.status === "published" ? "default" : "outline"}>
                      {post.status}
                    </Badge>
                  </div>
                  <p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">{post.body}</p>
                  {post.hashtags.length > 0 ? (
                    <p className="mt-2 text-sm text-primary">{post.hashtags.join(" ")}</p>
                  ) : null}
                  <div className="mt-3 flex flex-wrap gap-2">
                    {post.targets.map((target) => (
                      <span key={target.platform} className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                        {platformIcon(target.platform)}
                        {platformLabel(target.platform)} · {target.status}
                        {target.externalPostUrl ? (
                          <a href={target.externalPostUrl} target="_blank" rel="noreferrer" className="text-primary underline">
                            View
                          </a>
                        ) : null}
                        {target.error ? <span className="text-destructive">{target.error}</span> : null}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="flex shrink-0 flex-wrap gap-2">
                  {post.status === "draft" ? (
                    <Button type="button" variant="outline" size="sm" disabled={pending} onClick={() => editPost(post)}>
                      Edit
                    </Button>
                  ) : null}
                  {workspace.canPublish && ["draft", "failed", "partial"].includes(post.status) ? (
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button type="button" size="sm" disabled={pending}>Review and publish</Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Publish this post publicly?</AlertDialogTitle>
                          <AlertDialogDescription>
                            Confirm that the photos, heading, text, tags, public title, and town/city are approved for every selected destination. Publishing is an external action and may not be reversible from Compass.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction onClick={() => publish(post.id)}>Publish now</AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  ) : null}
                  {post.status !== "published" && post.status !== "partial" ? (
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button type="button" variant="ghost" size="icon" disabled={pending} aria-label="Delete social draft">
                          <IconTrash className="size-4" />
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Remove this draft?</AlertDialogTitle>
                          <AlertDialogDescription>
                            The draft will leave the active queue but remain recoverable in the audit record. No external post will be deleted.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Keep draft</AlertDialogCancel>
                          <AlertDialogAction onClick={() => removeDraft(post.id)}>Remove draft</AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  ) : null}
                </div>
              </div>
            </article>
          ))}
          {workspace.posts.length === 0 ? (
            <p className="p-8 text-center text-sm text-muted-foreground">
              No social posts have been created for this project yet.
            </p>
          ) : null}
        </div>
      </section>
    </div>
  )
}
