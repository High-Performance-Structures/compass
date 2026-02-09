import * as React from "react"

const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
const DAYS_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]

// Helper to create a local Date from "yyyy-MM-dd" string
// This avoids timezone issues that occur with parseISO (which uses UTC)
function localDateFromString(dateStr: string): Date {
    const [year, month, day] = dateStr.split('-').map(Number)
    return new Date(year, month - 1, day)
}

// Helper to format a Date to "yyyy-MM-dd" string using local time
function formatDateToString(date: Date): string {
    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const day = String(date.getDate()).padStart(2, '0')
    return `${year}-${month}-${day}`
}

// Format date as "Monday, Feb 9" using local time
function formatDisplayDate(date: Date): string {
    const dayName = DAYS_LONG[date.getDay()]
    const monthName = MONTHS_SHORT[date.getMonth()]
    const dayNum = date.getDate()
    return `${dayName}, ${monthName} ${dayNum}`
}

// Format date as "Feb 9" using local time
function formatShortDate(date: Date): string {
    const monthName = MONTHS_SHORT[date.getMonth()]
    const dayNum = date.getDate()
    return `${monthName} ${dayNum}`
}

// Check if two dates are the same day (local time)
function isSameLocalDay(a: Date, b: Date): boolean {
    return a.getFullYear() === b.getFullYear() &&
        a.getMonth() === b.getMonth() &&
        a.getDate() === b.getDate()
}
import { Loader2Icon, TrashIcon, DownloadIcon, XIcon, MoreVerticalIcon, UploadIcon, PencilIcon, CheckIcon, CalendarIcon, ChevronDown } from "lucide-react"
import { getProjectPhotos, deleteAsset, updateAssetName } from "@/app/actions/media"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Input } from "@/components/ui/input"
import {
    Dialog,
    DialogContent,
    DialogTitle,
} from "@/components/ui/dialog"
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@/components/ui/popover"
import { SimpleCalendar } from "@/components/ui/simple-calendar"
import { toast } from "sonner"
import { cn } from "@/lib/utils"

interface Asset {
    id: string
    url: string
    thumbnailUrl: string | null
    name: string
    type: string
    createdAt: string
    dailyLogId: string | null
    date: string | null
    driveFileId: string | null
}

const PhotoPreviewContent = ({ asset, onClose, onDelete, onDownload }: { asset: Asset, onClose: () => void, onDelete: () => void, onDownload: () => void }) => {
    const [isEditing, setIsEditing] = React.useState(false)
    const [name, setName] = React.useState(asset.name)
    const [saving, setSaving] = React.useState(false)

    // Sync name if asset changes
    React.useEffect(() => {
        setName(asset.name)
        setIsEditing(false)
    }, [asset])

    const handleSave = async () => {
        if (!name.trim() || name === asset.name) {
            setIsEditing(false)
            return
        }
        setSaving(true)
        try {
            const result = await updateAssetName(asset.id, name)
            if (result.success) {
                setIsEditing(false)
                toast.success("Photo renamed")
                // Need to refresh parent assets? Ideally yes.
                // But for now let's just update local state or rely on revalidatePath eventually catching up
                // Actually revalidatePath should handling it on next refresh, but optimistic update is better.
                // We'll dispatch an event? Or just let it be.
                window.dispatchEvent(new CustomEvent("project-photo-uploaded")) // Reuse this event to trigger refresh
            } else {
                toast.error("Failed to rename photo")
            }
        } finally {
            setSaving(false)
        }
    }

    return (
        <div className="relative flex flex-col w-auto h-auto max-w-full max-h-[90vh] bg-black rounded-lg overflow-hidden shadow-2xl group border border-white/10">
            {/* Header Bar - Always visible on mobile, hover on desktop */}
            <div className="absolute top-0 left-0 right-0 z-50 flex items-center justify-between p-3 bg-gradient-to-b from-black/80 to-transparent md:from-black/60 md:to-black/60 md:backdrop-blur-md transition-opacity duration-200 opacity-100 md:opacity-0 md:group-hover:opacity-100 md:focus-within:opacity-100">
                <div className="flex-1 min-w-0 mr-4">
                    {isEditing ? (
                        <div className="flex items-center gap-2">
                            <Input
                                value={name}
                                onChange={e => setName(e.target.value)}
                                className="h-8 text-sm bg-white/10 border-white/20 text-white placeholder:text-white/50 focus-visible:ring-1 focus-visible:ring-white/50 min-w-[100px]"
                                autoFocus
                                onKeyDown={e => {
                                    if (e.key === "Enter") handleSave()
                                    if (e.key === "Escape") setIsEditing(false)
                                }}
                                onClick={(e) => e.stopPropagation()}
                            />
                            <Button size="icon" variant="ghost" className="h-8 w-8 text-green-400 hover:text-green-300 hover:bg-white/10 shrink-0" onClick={(e) => { e.stopPropagation(); handleSave() }} disabled={saving}>
                                {saving ? <Loader2Icon className="h-4 w-4 animate-spin" /> : <CheckIcon className="h-4 w-4" />}
                            </Button>
                            <Button size="icon" variant="ghost" className="h-8 w-8 text-white/70 hover:text-white hover:bg-white/10 shrink-0" onClick={(e) => { e.stopPropagation(); setIsEditing(false) }}>
                                <XIcon className="h-4 w-4" />
                            </Button>
                        </div>
                    ) : (
                        <div className="flex items-center gap-2 group/title cursor-pointer p-1 rounded hover:bg-white/10 transition-colors max-w-full" onClick={(e) => { e.stopPropagation(); setIsEditing(true) }}>
                            <h2 className="text-white font-medium truncate text-sm sm:text-base select-none">
                                {name}
                            </h2>
                            <PencilIcon className="h-3 w-3 text-white/50 opacity-0 group-hover/title:opacity-100 transition-opacity shrink-0" />
                        </div>
                    )}
                </div>

                <div className="flex items-center gap-1 shrink-0">
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="text-white/90 hover:text-white hover:bg-white/20 rounded-full h-8 w-8">
                                <MoreVerticalIcon className="h-4 w-4" />
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={onDownload}>
                                <DownloadIcon className="mr-2 h-4 w-4" /> Download
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={onDelete} className="text-destructive">
                                <TrashIcon className="mr-2 h-4 w-4" /> Delete
                            </DropdownMenuItem>
                        </DropdownMenuContent>
                    </DropdownMenu>
                    <Button variant="ghost" size="icon" className="text-white/90 hover:text-white hover:bg-white/20 rounded-full h-8 w-8" onClick={onClose}>
                        <XIcon className="h-5 w-5" />
                    </Button>
                </div>
            </div>

            {/* Image Container */}
            <div className="relative flex items-center justify-center bg-black/20 min-w-[200px] min-h-[200px] max-w-full max-h-full">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                    src={asset.url}
                    alt={asset.name}
                    className="max-w-full max-h-[85vh] w-auto h-auto object-contain block"
                />
            </div>
        </div>
    )
}

interface PhotoGalleryProps {
    projectId: string
    initialDate?: string
}

export function PhotoGallery({ projectId, initialDate }: PhotoGalleryProps) {
    const [assets, setAssets] = React.useState<Asset[]>([])
    const [loading, setLoading] = React.useState(true)
    const [selectedAsset, setSelectedAsset] = React.useState<Asset | null>(null)
    const [deleteConfirmAsset, setDeleteConfirmAsset] = React.useState<Asset | null>(null)
    const scrollRef = React.useRef<HTMLDivElement>(null)
    const [activeDate, setActiveDate] = React.useState<string>(formatDateToString(new Date()))

    // Fetch assets
    const fetchAssets = React.useCallback(async () => {
        setLoading(true)
        const result = await getProjectPhotos(projectId)
        if (result.success && result.data) {
            setAssets(result.data)
        } else {
            console.error("Failed to load photos", result.error)
        }
        setLoading(false)
    }, [projectId])

    React.useEffect(() => {
        fetchAssets()

        // Listen for upload events to refresh gallery
        const handleRefresh = () => fetchAssets()
        window.addEventListener("project-photo-uploaded", handleRefresh)

        return () => {
            window.removeEventListener("project-photo-uploaded", handleRefresh)
        }
    }, [fetchAssets])

    // Group assets by date
    const groupedAssets = React.useMemo(() => {
        const groups: Record<string, Asset[]> = {}
        assets.forEach(asset => {
            const dateKey = asset.date ?? asset.createdAt.split("T")[0]
            if (!groups[dateKey]) {
                groups[dateKey] = []
            }
            groups[dateKey].push(asset)
        })
        return groups
    }, [assets])

    // External initialDate effect
    React.useEffect(() => {
        if (initialDate && !loading) {
            setActiveDate(initialDate)
        }
    }, [initialDate, loading])

    const handleDelete = (asset: Asset) => {
        // Open confirmation dialog
        setDeleteConfirmAsset(asset)
    }

    const confirmDelete = async () => {
        if (!deleteConfirmAsset) return
        const asset = deleteConfirmAsset
        setDeleteConfirmAsset(null)

        // Optimistic update
        setAssets(prev => prev.filter(a => a.id !== asset.id))
        if (selectedAsset?.id === asset.id) setSelectedAsset(null)

        const result = await deleteAsset(asset.id)
        if (!result.success) {
            toast.error("Failed to delete photo")
            fetchAssets() // Revert
        } else {
            toast.success("Photo deleted")
        }
    }

    const handleDownload = async (asset: Asset) => {
        try {
            // Determine proper file extension from MIME type
            const getExtension = (mimeType: string | undefined): string => {
                if (!mimeType) return 'jpg'
                const mimeToExt: Record<string, string> = {
                    'image/jpeg': 'jpg',
                    'image/jpg': 'jpg',
                    'image/png': 'png',
                    'image/gif': 'gif',
                    'image/webp': 'webp',
                    'image/heic': 'heic',
                    'image/heif': 'heif',
                    'image/svg+xml': 'svg',
                    'image/bmp': 'bmp',
                    'image/tiff': 'tiff',
                }
                return mimeToExt[mimeType.toLowerCase()] || 'jpg'
            }

            // Build proper filename with extension
            const buildFilename = (name: string | undefined, mimeType: string | undefined): string => {
                const extension = getExtension(mimeType)
                let filename = name || `photo-${Date.now()}`
                // Remove any existing extension if present
                filename = filename.replace(/\.[^/.]+$/, '')
                return `${filename}.${extension}`
            }

            let url = asset.url

            // If Google Drive file, use the download API
            if (asset.driveFileId && !asset.driveFileId.startsWith("mock-")) {
                url = `/api/google/download/${asset.driveFileId}`
            }

            // Fetch the file as blob
            const response = await fetch(url)
            if (!response.ok) throw new Error('Download failed')

            const blob = await response.blob()
            const filename = buildFilename(asset.name, asset.type || blob.type)

            // Create download link with blob
            const blobUrl = URL.createObjectURL(blob)
            const link = document.createElement('a')
            link.href = blobUrl
            link.download = filename
            document.body.appendChild(link)
            link.click()
            document.body.removeChild(link)
            URL.revokeObjectURL(blobUrl)

            toast.success(`Downloaded ${filename}`)
        } catch (error) {
            console.error('Download error:', error)
            toast.error('Failed to download image')
        }
    }

    const [calendarOpen, setCalendarOpen] = React.useState(false)

    // Get all dates that have photos for calendar modifiers
    const datesWithPhotos = React.useMemo(() => {
        return Object.keys(groupedAssets).filter(date => groupedAssets[date]?.length > 0)
    }, [groupedAssets])

    if (loading) {
        return (
            <div className="flex items-center justify-center p-12 text-muted-foreground">
                <Loader2Icon className="mr-2 h-4 w-4 animate-spin" />
                Loading photos...
            </div>
        )
    }

    const activeAssets = groupedAssets[activeDate] || []
    const isToday = isSameLocalDay(localDateFromString(activeDate), new Date())

    return (
        <div className="flex flex-col h-full bg-background rounded-lg border overflow-hidden">
            {/* Date Selector Dropdown */}
            <div className="flex items-center justify-between p-3 border-b bg-muted/30">
                <Popover open={calendarOpen} onOpenChange={setCalendarOpen}>
                    <PopoverTrigger asChild>
                        <Button
                            variant="outline"
                            className={cn(
                                "justify-start text-left font-normal gap-2",
                                !activeDate && "text-muted-foreground"
                            )}
                        >
                            <CalendarIcon className="h-4 w-4" />
                            <span>
                                {isToday
                                    ? "Today"
                                    : formatDisplayDate(localDateFromString(activeDate))}
                            </span>
                            <ChevronDown className="h-4 w-4 ml-auto opacity-50" />
                        </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                        <SimpleCalendar
                            selected={localDateFromString(activeDate)}
                            onSelect={(date) => {
                                setActiveDate(formatDateToString(date))
                                setCalendarOpen(false)
                            }}
                            highlightedDates={datesWithPhotos.map(d => localDateFromString(d))}
                        />
                    </PopoverContent>
                </Popover>

                <span className="text-xs font-medium bg-muted px-2 py-1 rounded-md text-muted-foreground">
                    {activeAssets.length} Photos
                </span>
            </div>

            {/* Main Content Area - Filtered by Active Date */}
            <ScrollArea className="flex-1" ref={scrollRef}>
                <div className="p-4 pb-12 min-h-[300px]">

                    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                        {/* Always show upload card */}
                        <div
                            className={cn(
                                "flex flex-col items-center justify-center text-muted-foreground border-2 border-dashed rounded-md hover:bg-muted/50 cursor-pointer transition-colors group animate-in fade-in aspect-square",
                                activeAssets.length === 0 && "col-span-full aspect-auto py-16"
                            )}
                            onClick={() => window.dispatchEvent(new CustomEvent("agent-request-photo", { detail: { projectId } }))}
                        >
                            <div className="bg-muted p-3 rounded-full mb-2 group-hover:bg-background transition-colors shadow-sm">
                                <UploadIcon className="h-5 w-5 text-primary" />
                            </div>
                            <h4 className="font-medium text-sm text-foreground">
                                {activeAssets.length === 0 ? "No photos yet" : "Add Photo"}
                            </h4>
                            <p className="text-[10px] max-w-[120px] text-center mt-0.5 line-clamp-2">
                                {activeAssets.length === 0
                                    ? `Click to add photos for ${formatShortDate(localDateFromString(activeDate))}`
                                    : "Upload more"}
                            </p>
                        </div>

                        {activeAssets.map(asset => (
                            <div
                                key={asset.id}
                                className="group relative aspect-square bg-muted rounded-md overflow-hidden cursor-pointer border border-border/50 hover:border-primary/50 transition-colors shadow-sm"
                                onClick={() => setSelectedAsset(asset)}
                            >
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img
                                    src={asset.thumbnailUrl || asset.url}
                                    alt={asset.name}
                                    className="w-full h-full object-cover transition-transform group-hover:scale-105"
                                    loading="lazy"
                                />
                                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors" />
                            </div>
                        ))}
                    </div>
                </div>
            </ScrollArea>


            {/* Fullscreen View */}
            <Dialog open={!!selectedAsset} onOpenChange={(o) => !o && setSelectedAsset(null)}>
                <DialogContent className="w-auto h-auto !max-w-[95vw] max-h-[95vh] p-0 border-none bg-transparent shadow-none outline-none">
                    <DialogTitle className="sr-only">Photo Preview</DialogTitle>
                    {selectedAsset && (
                        <PhotoPreviewContent
                            asset={selectedAsset}
                            onClose={() => setSelectedAsset(null)}
                            onDelete={() => handleDelete(selectedAsset)}
                            onDownload={() => handleDownload(selectedAsset)}
                        />
                    )}
                </DialogContent>
            </Dialog>

            {/* Delete Confirmation Dialog */}
            <AlertDialog open={!!deleteConfirmAsset} onOpenChange={(open) => !open && setDeleteConfirmAsset(null)}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Delete Photo</AlertDialogTitle>
                        <AlertDialogDescription>
                            Are you sure you want to delete this photo? This action cannot be undone.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={confirmDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                            Delete
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    )
}
