"use client"

import { IconPlus, IconTrash } from "@tabler/icons-react"

import type { ProjectEstimateSummary, ProjectEstimateWorkspace } from "@/app/actions/project-estimates"
import { ProjectEstimateSignerPicker } from "@/components/projects/project-estimate-signer-picker"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

import { SignatureRequiredMark } from "./signature-required-mark"
import type { EstimateHeaderState } from "./use-estimate-header-state"

/** The "Contract signers" area of the estimate header form. */
export function EstimateSignersFields({
  estimate,
  workspace,
  header,
  editable,
}: {
  readonly estimate: ProjectEstimateSummary
  readonly workspace: ProjectEstimateWorkspace
  readonly header: EstimateHeaderState
  readonly editable: boolean
}): React.ReactElement {
  const {
    clientSigners,
    setClientSigners,
    companySigner,
    setCompanySigner,
    companySignerInitials,
    setCompanySignerInitials,
  } = header
  return (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <div className="border-t pt-4 md:col-span-2 xl:col-span-4">
            <p className="mt-1 text-xs text-muted-foreground">
              Choose a project contact or type a name. These details are
              included in the prepared signature package. Add every client or
              owner who must sign. Reference initials identify the signer in
              Compass; Foxit requires each signer to provide their own initials
              in the assigned fields.
            </p>
          </div>
            <div className="space-y-3 md:col-span-2">
              <div className="flex items-center justify-between gap-3">
                <Label>
                  Client / owner signers
                  <SignatureRequiredMark />
                </Label>
                {editable && clientSigners.length < 10 && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      setClientSigners([
                        ...clientSigners,
                        {
                          contactId: null,
                          name: "",
                          title: "",
                          email: "",
                          initials: "",
                        },
                      ])
                    }
                  >
                    <IconPlus className="size-4" />
                    Add signer
                  </Button>
                )}
              </div>
              {clientSigners.length === 0 && (
              <p className="text-xs text-muted-foreground">Add at least one client or owner signer.</p>
            )}
              {clientSigners.map((signer, index) => (
                <div
                  key={`${estimate.id}-client-signer-${index}`}
                  className="space-y-3 border-t pt-3"
                >
                  <div className="flex items-end gap-2">
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <Label htmlFor={`clientSignerName-${index}`}>
                      Signer {index + 1}<SignatureRequiredMark />
                    </Label>
                    <ProjectEstimateSignerPicker
                      id={`clientSignerName-${index}`}
                      value={signer}
                      options={workspace.signerContacts}
                      onValueChange={(value) =>
                        setClientSigners(clientSigners.map((item, itemIndex) =>
                          itemIndex === index
                            ? { ...value, initials: item.initials }
                            : item
                        ))
                      }
                      placeholder="Choose client signer or type a name..."
                      disabled={!editable}
                    />
                  </div>
                  {editable && (
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      aria-label={`Remove client signer ${index + 1}`}
                      onClick={() =>
                        setClientSigners(clientSigners.filter((_, itemIndex) => itemIndex !== index))
                      }
                    >
                      <IconTrash className="size-4" />
                    </Button>
                  )}
                </div>
                  <div className="grid gap-3 sm:grid-cols-[1fr_1.4fr_.55fr]">
                    <div className="space-y-1.5">
                    <Label htmlFor={`clientSignerTitle-${index}`}>Title</Label>
                    <Input id={`clientSignerTitle-${index}`} value={signer.title} disabled={!editable} onChange={(event) => setClientSigners(clientSigners.map((item, itemIndex) => itemIndex === index ? { ...item, title: event.target.value } : item))} />
                  </div>
                    <div className="space-y-1.5">
                    <Label htmlFor={`clientSignerEmail-${index}`}>
                      Email<SignatureRequiredMark />
                    </Label>
                    <Input id={`clientSignerEmail-${index}`} type="email" value={signer.email} disabled={!editable} onChange={(event) => setClientSigners(clientSigners.map((item, itemIndex) => itemIndex === index ? { ...item, email: event.target.value } : item))} />
                  </div>
                    <div className="space-y-1.5">
                      <Label htmlFor={`clientSignerInitials-${index}`}>
                        Reference initials
                      </Label>
                      <Input
                        id={`clientSignerInitials-${index}`}
                        maxLength={6}
                        value={signer.initials}
                        disabled={!editable}
                        onChange={(event) =>
                          setClientSigners(
                            clientSigners.map((item, itemIndex) =>
                              itemIndex === index
                                ? {
                                    ...item,
                                    initials: event.target.value.toUpperCase(),
                                  }
                                : item
                            )
                          )
                        }
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <div className="space-y-3 md:col-span-2">
            <div className="space-y-1.5">
              <Label htmlFor="companySignerName">
                Company representative<SignatureRequiredMark />
              </Label>
              <ProjectEstimateSignerPicker
                id="companySignerName"
                value={companySigner}
                options={workspace.signerContacts}
                onValueChange={setCompanySigner}
                placeholder="Choose company representative or type a name..."
                disabled={!editable}
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-[1fr_1.4fr_.55fr]">
              <div className="space-y-1.5">
                <Label htmlFor="companySignerTitle">
                  Title<SignatureRequiredMark />
                </Label>
                <Input
                  id="companySignerTitle"
                  value={companySigner.title}
                  onChange={(event) =>
                    setCompanySigner({
                      ...companySigner,
                      title: event.target.value,
                    })
                  }
                  disabled={!editable}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="companySignerEmail">
                  Email<SignatureRequiredMark />
                </Label>
                <Input
                  id="companySignerEmail"
                  type="email"
                  value={companySigner.email}
                  onChange={(event) =>
                    setCompanySigner({
                      ...companySigner,
                      email: event.target.value,
                    })
                  }
                  disabled={!editable}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="companySignerInitials">Reference initials</Label>
                <Input
                  id="companySignerInitials"
                  maxLength={6}
                  value={companySignerInitials}
                  onChange={(event) =>
                    setCompanySignerInitials(event.target.value.toUpperCase())
                  }
                  disabled={!editable}
                />
              </div>
            </div>
          </div>
          </div>
  )
}
