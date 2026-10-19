import { IconEye } from "@tabler/icons-react"

import { Button } from "@/components/ui/button"
import { printPreviewHref, type PrintDocumentLink } from "@/lib/print/print-documents"
import { cn } from "@/lib/utils"

/** Opens a document's Print Preview in a new tab. */
export function PrintPreviewButton({
  link,
  size = "sm",
  variant = "outline",
  className,
}: {
  readonly link: PrintDocumentLink
  readonly size?: "sm" | "default"
  readonly variant?: "outline" | "ghost" | "default"
  readonly className?: string
}): React.ReactElement {
  return (
    <Button asChild size={size} variant={variant} className={cn("print:hidden", className)}>
      <a href={printPreviewHref(link)} target="_blank" rel="noopener">
        <IconEye className="size-4" />
        Print Preview
      </a>
    </Button>
  )
}
