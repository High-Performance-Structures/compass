"use client"

import { useParams, useSearchParams } from "next/navigation"
import { PhotoGallery } from "@/components/projects/photo-gallery"

export default function ProjectPhotosPage() {
    const params = useParams()
    const searchParams = useSearchParams()
    const projectId = params.id as string
    const date = searchParams.get("date") ?? undefined

    return (
        <div className="flex flex-col h-full space-y-6 p-6">
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-2xl font-bold tracking-tight">Project Photos</h2>
                    <p className="text-muted-foreground">
                        Manage daily logs and project gallery.
                    </p>
                </div>
            </div>

            <PhotoGallery projectId={projectId} initialDate={date} />
        </div>
    )
}
