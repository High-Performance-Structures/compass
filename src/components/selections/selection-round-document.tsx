import type * as React from "react"

import { ProjectBrandContactDetails } from "@/components/projects/project-brand-contact-details"
import { ProjectBrandLogo } from "@/components/projects/project-brand-logo"
import type { RoundSigner } from "@/lib/domain/selections/round-signing"
import { formatCents, formatDate } from "@/lib/format"
import { projectInternalPhotoUrl } from "@/lib/photo-sources"
import type { ProjectBrand } from "@/lib/project-branding"
import type { RoundDocument } from "@/lib/selections/round-document"

/*
 * The selections round document the owner reviews and signs: one row per
 * selection (room, photo, chosen choice, supplier link, owner price, over or
 * under the allowance), the round total against the allowance, the change
 * order or variance that difference becomes, and a signature page laid out
 * like the estimate's so Foxit's signature fields land on the lines.
 */

export type RoundChangeOrderSummary = {
  readonly number: string
  readonly recordType: "change_order" | "variance"
  readonly amountCents: number
  readonly lines: readonly { readonly costCode: string | null; readonly description: string; readonly amountCents: number | null }[]
}

function Delta({ cents }: { readonly cents: number | null }): React.ReactElement {
  if (cents === null) return <span>—</span>
  if (cents === 0) return <span>On allowance</span>
  return (
    <span className="font-semibold">
      {formatCents(Math.abs(cents))} {cents > 0 ? "over" : "under"}
    </span>
  )
}

export function SelectionRoundDocument({
  brand,
  projectId,
  project,
  roundName,
  document,
  treatmentLabel,
  changeOrder,
  signers,
}: {
  readonly brand: ProjectBrand
  readonly projectId: string
  readonly project: { readonly name: string; readonly projectNumber: string | null; readonly clientName: string | null; readonly address: string | null }
  readonly roundName: string
  readonly document: RoundDocument
  /** What the difference becomes, in words ("Change order", "Variance"), or null when on allowance. */
  readonly treatmentLabel: string | null
  /** The change order or variance in this signing, once it exists. */
  readonly changeOrder: RoundChangeOrderSummary | null
  readonly signers: readonly RoundSigner[]
}): React.ReactElement {
  const lines = document.toSign.length > 0 ? document.toSign : document.lines
  return (
    <>
      <header className="flex items-start justify-between gap-6 border-b-2 border-black pb-4">
        <div className="flex items-center gap-3">
          <ProjectBrandLogo brand={brand} size={64} className="h-16 w-16 shrink-0 object-contain" />
          <div>
            <p className="text-sm font-bold uppercase">{brand.companyName}</p>
            <ProjectBrandContactDetails brand={brand} />
          </div>
        </div>
        <div className="text-right">
          <h1 className="text-xl font-bold">{roundName} Selection Phase</h1>
          <p className="mt-1 text-sm">{project.projectNumber ? `${project.projectNumber} · ${project.name}` : project.name}</p>
          {project.clientName && <p className="text-sm">Prepared for {project.clientName}</p>}
          {project.address && <p className="whitespace-pre-line text-xs">{project.address}</p>}
        </div>
      </header>

      <table className="mt-5 w-full border-collapse text-xs">
        <thead>
          <tr className="border-b-2 border-black text-left">
            <th className="py-1 pr-2">Room</th>
            <th className="py-1 pr-2">Item</th>
            <th className="py-1 pr-2">Photo</th>
            <th className="py-1 pr-2">Your choice</th>
            <th className="py-1 pr-2 text-right">Price</th>
            <th className="py-1 pr-2 text-right">Allowance</th>
            <th className="py-1 text-right">Over / under</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((line) => (
            <tr key={line.selectionId} className="break-inside-avoid border-b border-report-rule align-top">
              <td className="py-2 pr-2">{line.roomName}</td>
              <td className="py-2 pr-2 font-semibold">{line.selectionName}</td>
              <td className="py-2 pr-2">
                {line.photoId ? (
                  // eslint-disable-next-line @next/next/no-img-element -- project photo served by the photos route
                  <img src={projectInternalPhotoUrl(projectId, line.photoId)} alt="" className="h-14 w-14 object-cover" />
                ) : null}
              </td>
              <td className="py-2 pr-2">
                <p className="font-medium">{line.choiceTitle ?? "Not chosen"}</p>
                {line.choiceDescription && <p className="text-xs">{line.choiceDescription}</p>}
                {line.linkUrl && (
                  <p className="text-xs break-all">
                    {line.linkSite ?? "Supplier page"}: {line.linkUrl}
                  </p>
                )}
                {line.pickedBy && <p className="text-xs text-report-secondary">{line.pickedBy}</p>}
              </td>
              <td className="py-2 pr-2 text-right tabular-nums">{line.ownerPriceCents === null ? "—" : formatCents(line.ownerPriceCents)}</td>
              <td className="py-2 pr-2 text-right tabular-nums">{line.allowanceCents === null ? "None" : formatCents(line.allowanceCents)}</td>
              <td className="py-2 text-right tabular-nums">
                <Delta cents={line.deltaCents} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <section className="mt-4 break-inside-avoid border-2 border-black p-3 text-sm">
        <div className="flex justify-between">
          <span>Allowance for these selections</span>
          <span className="tabular-nums">{formatCents(document.allowanceCents)}</span>
        </div>
        <div className="flex justify-between">
          <span>Your selections (prices include the builder fee)</span>
          <span className="tabular-nums">{formatCents(document.ownerTotalCents)}</span>
        </div>
        <div className="mt-1 flex justify-between border-t border-black pt-1 font-bold">
          <span>{document.deltaCents === 0 ? "On allowance" : document.deltaCents > 0 ? "Over the allowance" : "Under the allowance"}</span>
          <span className="tabular-nums">{formatCents(Math.abs(document.deltaCents))}</span>
        </div>
        {treatmentLabel && (
          <p className="mt-2 text-xs">
            {changeOrder
              ? `${treatmentLabel} ${changeOrder.number} for ${formatCents(changeOrder.amountCents)} records this difference and is part of what you sign below.`
              : `This difference becomes a ${treatmentLabel.toLowerCase()} when the selections are sent for signature.`}
          </p>
        )}
        {changeOrder && changeOrder.lines.length > 0 && (
          <table className="mt-2 w-full text-xs">
            <tbody>
              {changeOrder.lines.map((line, index) => (
                <tr key={`${line.costCode ?? ""}-${index}`}>
                  <td className="pr-2">{line.costCode}</td>
                  <td className="pr-2">{line.description}</td>
                  <td className="text-right tabular-nums">{line.amountCents === null ? "" : formatCents(line.amountCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="selection-round-signature-page break-inside-avoid pt-2">
        <h2 className="border-b pb-1 text-sm font-bold uppercase tracking-wide">Owner approval</h2>
        <p className="mt-2 text-xs text-report-secondary">
          By signing, you approve the selections above in the {roundName} Selection Phase{changeOrder ? ` and ${changeOrder.number}` : ""}. Dated {formatDate(new Date().toISOString())}.
        </p>
        <div className="mt-5 grid grid-cols-2 gap-x-10 gap-y-5 text-sm">
          {(signers.length > 0 ? signers : [{ name: "Owner", email: "" }]).map((signer, index) => (
            <div key={`${signer.email}-${index}`} className="break-inside-avoid">
              <p className="font-semibold">Owner {index + 1}</p>
              <div className="mt-7 border-b border-black" />
              <p className="mt-1 text-xs">Signature</p>
              <p className="mt-2 font-medium">{signer.name}</p>
              <div className="mt-4 border-b border-black" />
              <p className="mt-1 text-xs">Date</p>
            </div>
          ))}
        </div>
      </section>
    </>
  )
}
