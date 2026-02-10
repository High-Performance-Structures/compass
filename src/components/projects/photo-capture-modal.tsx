"use client"

import { useEffect, useState, useRef } from "react"
import { useIsMobile } from "@/hooks/use-mobile"
import { Button } from "@/components/ui/button"
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog"
import {
    Drawer,
    DrawerContent,
    DrawerDescription,
    DrawerHeader,
    DrawerTitle,
} from "@/components/ui/drawer"
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { toast } from "sonner"
import { CameraIcon, Loader2Icon, UploadIcon, XIcon } from "lucide-react"
import { getProjectMediaUploadUrl, registerUploadedAsset } from "@/app/actions/media"
import { getProjects } from "@/app/actions/projects"

interface PhotoCaptureEventDetail {
    projectId?: string
    context?: "daily_log" | "gallery"
}

// Helper to resize and compress image
async function processImage(file: File): Promise<File> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                let width = img.width;
                let height = img.height;

                // Target 1080p roughly
                const MAX_WIDTH = 1920;
                const MAX_HEIGHT = 1080;

                if (width > height) {
                    if (width > MAX_WIDTH) {
                        height *= MAX_WIDTH / width;
                        width = MAX_WIDTH;
                    }
                } else {
                    if (height > MAX_HEIGHT) {
                        width *= MAX_HEIGHT / height;
                        height = MAX_HEIGHT;
                    }
                }

                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');
                if (!ctx) {
                    reject(new Error("Failed to get canvas context"));
                    return;
                }
                ctx.drawImage(img, 0, 0, width, height);

                // Convert to WebP for efficiency
                canvas.toBlob((blob) => {
                    if (!blob) {
                        reject(new Error("Failed to compress image"));
                        return;
                    }
                    // Change extension to .webp
                    const newName = file.name.replace(/\.[^/.]+$/, "") + ".webp";
                    const newFile = new File([blob], newName, {
                        type: "image/webp",
                        lastModified: Date.now(),
                    });
                    resolve(newFile);
                }, "image/webp", 0.8);
            };
            img.onerror = reject;
            img.src = e.target?.result as string;
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

// Helper for dev mode to get base64 from file
async function fileToBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

export function PhotoCaptureModal() {
    const [open, setOpen] = useState(false)
    const isMobile = useIsMobile()
    const isDesktop = !isMobile
    const [projectId, setProjectId] = useState<string>("")
    const [projects, setProjects] = useState<{ id: string; name: string }[]>([])
    const [file, setFile] = useState<File | null>(null)
    const [previewUrl, setPreviewUrl] = useState<string | null>(null)
    const [uploading, setUploading] = useState(false)
    const [notes, setNotes] = useState("")

    const fileInputRef = useRef<HTMLInputElement>(null)

    useEffect(() => {
        const handleRequest = (e: Event) => {
            const detail = (e as CustomEvent<PhotoCaptureEventDetail>).detail
            setProjectId(detail.projectId ?? "")
            setFile(null)
            setPreviewUrl(null)
            setNotes("")
            setUploading(false)
            setOpen(true)

            // Fetch projects if needed
            getProjects().then(setProjects)
        }

        const handleOpen = () => {
            handleRequest(new CustomEvent("agent-request-photo", { detail: {} }))
        }

        window.addEventListener("agent-request-photo", handleRequest as EventListener)
        // Also listen for a global event just in case
        window.addEventListener("open-photo-capture", handleOpen)

        return () => {
            window.removeEventListener("agent-request-photo", handleRequest as EventListener)
            window.removeEventListener("open-photo-capture", handleOpen)
        }
    }, [])

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const selected = e.target.files?.[0]
        if (selected) {
            setFile(selected)
            const url = URL.createObjectURL(selected)
            setPreviewUrl(url)
        }
    }

    const handleUpload = async () => {
        if (!file || !projectId) {
            toast.error("Please select a project and a photo.")
            return
        }

        setUploading(true)
        try {
            // 0. Process image (Resize & Compress)
            const processedFile = await processImage(file);
            console.log(`Compressed: ${file.size / 1024 / 1024}MB -> ${processedFile.size / 1024 / 1024}MB`);

            // 1. Get upload URL
            const result = await getProjectMediaUploadUrl(
                projectId,
                processedFile.name,
                processedFile.type
            )

            if (!result.success) {
                // If it failed to get URL, throw error
                throw new Error(result.error || "Failed to get upload URL")
            }

            // 2. Upload to Drive (or Mock)
            // Note: In dev mode, result.uploadUrl might be a mock URL (httpbin)
            const uploadUrl = result.uploadUrl!

            let driveFileId: string
            let webViewLink: string
            let thumbnailLink: string | null

            if (uploadUrl.includes("googleapis")) {
                const uploadRes = await fetch(uploadUrl, {
                    method: "PUT",
                    headers: {
                        "Content-Type": processedFile.type,
                    },
                    body: processedFile,
                })

                if (!uploadRes.ok) {
                    throw new Error("Failed to upload to Google Drive")
                }

                // Get file ID from response body
                const driveFile = (await uploadRes.json()) as { id: string; webViewLink: string; thumbnailLink: string; name: string; mimeType: string }
                driveFileId = driveFile.id
                webViewLink = driveFile.webViewLink
                thumbnailLink = driveFile.thumbnailLink
            } else {
                // Mock upload fallback (dev mode)
                console.log("Mock upload detected, using processed Base64 URI")
                driveFileId = `mock-${Date.now()}`

                // Use the processed file for base64
                const base64 = await fileToBase64(processedFile)
                webViewLink = base64
                thumbnailLink = base64
            }

            if (!webViewLink) {
                throw new Error("Failed to get image URL")
            }

            // 3. Register asset
            const registerRes = await registerUploadedAsset(
                projectId,
                driveFileId,
                processedFile.name,
                processedFile.type,
                webViewLink,
                thumbnailLink,
                new Date().toISOString().split("T")[0], // Today's date
                notes
            )

            if (!registerRes.success) {
                throw new Error(registerRes.error)
            }

            toast.success("Photo uploaded successfully!")

            // Dispatch event to refresh gallery
            window.dispatchEvent(new CustomEvent("project-photo-uploaded"))

            setOpen(false)
        } catch (err) {
            console.error(err)
            toast.error(err instanceof Error ? err.message : "Upload failed")
        } finally {
            setUploading(false)
        }
    }

    const Content = (
        <div className="space-y-4 p-4 md:p-0">
            {!projectId && (
                <div className="space-y-2">
                    <Label>Select Project</Label>
                    <Select onValueChange={setProjectId} value={projectId}>
                        <SelectTrigger>
                            <SelectValue placeholder="Select project..." />
                        </SelectTrigger>
                        <SelectContent>
                            {projects.map(p => (
                                <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>
            )}

            <div className="border-2 border-dashed rounded-lg p-6 flex flex-col items-center justify-center gap-4 text-center cursor-pointer hover:bg-muted/50 transition-colors"
                onClick={() => fileInputRef.current?.click()}
            >
                {previewUrl ? (
                    <div className="relative w-full aspect-video bg-black/5 rounded overflow-hidden">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={previewUrl} alt="Preview" className="w-full h-full object-contain" />
                        <Button variant="destructive" size="icon" className="absolute top-2 right-2 h-8 w-8"
                            onClick={(e) => {
                                e.stopPropagation()
                                setFile(null)
                                setPreviewUrl(null)
                            }}
                        >
                            <XIcon className="h-4 w-4" />
                        </Button>
                    </div>
                ) : (
                    <>
                        <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center text-primary">
                            <CameraIcon className="h-6 w-6" />
                        </div>
                        <div>
                            <p className="font-medium">Tap to take photo</p>
                            <p className="text-sm text-muted-foreground">or choose from library</p>
                        </div>
                    </>
                )}
                <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*,video/*"
                    capture="environment"
                    className="hidden"
                    onChange={handleFileChange}
                />
            </div>

            {previewUrl && (
                <div className="space-y-2">
                    <Label>Daily Log Notes (Optional)</Label>
                    <Input
                        placeholder="Add a note..."
                        value={notes}
                        onChange={(e) => setNotes(e.target.value)}
                    />
                </div>
            )}

            <div className="flex justify-end gap-2 pt-2">
                <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
                <Button onClick={handleUpload} disabled={!file || !projectId || uploading}>
                    {uploading ? (
                        <>
                            <Loader2Icon className="mr-2 h-4 w-4 animate-spin" />
                            Uploading...
                        </>
                    ) : (
                        <>
                            <UploadIcon className="mr-2 h-4 w-4" />
                            Upload Photo
                        </>
                    )}
                </Button>
            </div>
        </div>
    )

    if (isDesktop) {
        return (
            <Dialog open={open} onOpenChange={setOpen}>
                <DialogContent className="sm:max-w-[425px]">
                    <DialogHeader>
                        <DialogTitle>Upload Project Photo</DialogTitle>
                        <DialogDescription>
                            Add a photo to the daily log.
                        </DialogDescription>
                    </DialogHeader>
                    {Content}
                </DialogContent>
            </Dialog>
        )
    }

    return (
        <Drawer open={open} onOpenChange={setOpen}>
            <DrawerContent>
                <DrawerHeader className="text-left">
                    <DrawerTitle>Upload Project Photo</DrawerTitle>
                    <DrawerDescription>
                        Add a photo to the daily log.
                    </DrawerDescription>
                </DrawerHeader>
                {Content}
            </DrawerContent>
        </Drawer>
    )
}
