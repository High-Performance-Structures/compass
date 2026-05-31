import Image from "next/image"

import { Card, CardContent } from "@/components/ui/card"
import { Toaster } from "@/components/ui/sonner"

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-muted/30">
      <div className="w-full max-w-md">
        {/* logo */}
        <div className="mb-8 text-center">
          <Image
            src="/department-logos/hps-h-green.svg"
            alt="High Performance Structures"
            width={56}
            height={56}
            className="mx-auto mb-3 size-14 rounded-md object-contain"
            priority
            unoptimized
          />
          <h1 className="text-2xl font-bold text-primary">Compass</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Construction Project Management
          </p>
        </div>

        {/* auth card */}
        <Card className="border-border">
          <CardContent className="p-6">{children}</CardContent>
        </Card>

        {/* footer */}
        <p className="text-center text-xs text-muted-foreground mt-4">
          High Performance Structures
        </p>
      </div>
      <Toaster position="bottom-right" />
    </div>
  )
}
