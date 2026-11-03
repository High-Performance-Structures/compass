import Link from "next/link"
import type { BracingInventory } from "@/app/actions/nutech-bracing"
import { Badge } from "@/components/ui/badge"
import { formatDate } from "@/lib/format"
import { cn } from "@/lib/utils"

function dateLabel(value: string | null): string {
  return formatDate(value, "short", "No date")
}

/**
 * The bracing whiteboard: rentals reserved or out on jobs, when they are due
 * back, and what is left on the shelf by item and size.
 */
export function BracingInventoryPanel({ inventory }: { readonly inventory: BracingInventory }): React.ReactElement {
  const today = new Date().toISOString().slice(0, 10)
  return (
    <section aria-labelledby="bracing-inventory" className="space-y-3">
      <div className="border-y py-3">
        <h2 id="bracing-inventory" className="text-sm font-semibold">Bracing</h2>
        <p className="mt-1 text-sm text-muted-foreground">Rentals reserved or out on jobs, and what is left to rent.</p>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-lg border bg-background">
          {inventory.rentalsOut.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">No bracing out or reserved.</p>
          ) : (
            <ul className="divide-y">
              {inventory.rentalsOut.map((rental) => {
                const late = rental.status === "out" && rental.expectedReturnOn !== null && rental.expectedReturnOn < today
                return (
                  <li key={rental.rentalId}>
                    <Link
                      href={`/dashboard/projects/${encodeURIComponent(rental.projectId)}/nutech#nutech-bracing`}
                      className="flex flex-wrap items-center gap-2 px-4 py-3 text-sm transition-colors hover:bg-accent"
                    >
                      <span className="min-w-0 flex-1 truncate font-medium">{rental.projectNumber ?? rental.projectName}</span>
                      <Badge variant={rental.status === "out" ? "default" : "outline"}>{rental.status === "out" ? "Out" : "Reserved"}</Badge>
                      <span className="tabular-nums text-muted-foreground">{rental.braces} braces</span>
                      <span className={cn("tabular-nums", late ? "font-semibold text-destructive" : "text-muted-foreground")}>
                        {late ? "Overdue since " : "Back "}
                        {dateLabel(rental.expectedReturnOn)}
                      </span>
                    </Link>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
        <div className="rounded-lg border bg-background p-4">
          {inventory.ownedConfigured ? (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground">
                  <th className="pb-2 font-medium">Item</th>
                  <th className="pb-2 font-medium">Size</th>
                  <th className="pb-2 text-right font-medium">Owned</th>
                  <th className="pb-2 text-right font-medium">Out</th>
                  <th className="pb-2 text-right font-medium">Available</th>
                </tr>
              </thead>
              <tbody>
                {inventory.availability.map((row) => (
                  <tr key={`${row.itemKey}-${row.size}`} className="border-t">
                    <td className="py-1.5">{row.label}</td>
                    <td className="py-1.5 text-muted-foreground">{row.size || "—"}</td>
                    <td className="py-1.5 text-right tabular-nums">{row.owned}</td>
                    <td className="py-1.5 text-right tabular-nums">{row.out}</td>
                    <td className={cn("py-1.5 text-right font-medium tabular-nums", row.available < 0 && "text-destructive")}>{row.available}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="text-sm text-muted-foreground">
              Enter how much bracing you own in{" "}
              <Link href="/dashboard/settings?section=workflows&workflow=bracing-rentals" className="underline">
                Settings → Workflows → Bracing rentals
              </Link>{" "}
              to see what is available.
            </p>
          )}
        </div>
      </div>
    </section>
  )
}
