import {
  IconFolder,
  IconFileText,
  IconTable,
  IconPhoto,
  IconVideo,
  IconFileTypePdf,
  IconCode,
  IconFileZip,
  IconMusic,
  IconFile,
} from "@tabler/icons-react"
import type { FileType } from "@/lib/files-data"
import { cn } from "@/lib/utils"

const iconMap: Record<FileType, { icon: typeof IconFile; color: string }> = {
  folder: { icon: IconFolder, color: "text-amber-500" },
  document: { icon: IconFileText, color: "text-blue-500" },
  spreadsheet: { icon: IconTable, color: "text-green-600" },
  image: { icon: IconPhoto, color: "text-[#6f471f]" },
  video: { icon: IconVideo, color: "text-red-500" },
  pdf: { icon: IconFileTypePdf, color: "text-red-600" },
  code: { icon: IconCode, color: "text-emerald-500" },
  archive: { icon: IconFileZip, color: "text-orange-500" },
  audio: { icon: IconMusic, color: "text-pink-500" },
  unknown: { icon: IconFile, color: "text-muted-foreground" },
}

export function FileIcon({
  type,
  className,
  size = 20,
}: {
  type: FileType
  className?: string
  size?: number
}) {
  const { icon: Icon, color } = iconMap[type]
  return <Icon size={size} className={cn(color, className)} />
}
