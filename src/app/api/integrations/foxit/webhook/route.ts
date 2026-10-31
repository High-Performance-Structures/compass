import { and, eq, isNull, ne } from "drizzle-orm"

import { getDb } from "@/db"
import { contractPackets } from "@/db/schema-contracts"
import { projectEstimates } from "@/db/schema-estimates"
import { projects } from "@/db/schema"
import { readEstimateMode } from "@/lib/estimates/numbering"
import { changeOrderExecutionFromEstimate, estimateSupersedeConditions } from "@/lib/change-orders/estimate-execution"
import { projectDepartment } from "@/lib/project-branding"
import { getCloudflareContext } from "@/lib/db"
import { rebuildProjectContractBudget } from "@/lib/financials/contract-budget-store"
import { verifyFoxitWebhook } from "@/lib/foxit/esign"
import {
  supersedeOtherContractEstimatesStatement,
  updateEstimates,
  updateEstimatesStatement,
} from "@/lib/domain/estimates/store"
import { completePhaseProposal } from "@/lib/estimates/phase-proposals"
import { contractVersionBaseline } from "@/lib/change-orders/contract-version-acceptance"
import { announceEsignOutcome } from "@/lib/esign/announce"
import { findTradeLetterByEnvelope } from "@/lib/trade-letters/server"
import { handleTradeLetterEvent } from "@/lib/trade-letters/webhook"

function objectValue(value: unknown): object | null {
  return value && typeof value === "object" ? value : null
}

function nestedString(value: unknown, keys: readonly string[]): string | null {
  const object = objectValue(value)
  if (!object) return null
  for (const key of keys) {
    const item = Reflect.get(object, key)
    if (typeof item === "string" || typeof item === "number") return String(item)
  }
  for (const key of ["folder", "data", "payload", "eventData"]) {
    const nested = Reflect.get(object, key)
    const found = nestedString(nested, keys)
    if (found) return found
  }
  return null
}

export async function POST(request: Request): Promise<Response> {
  const { env } = await getCloudflareContext()
  const signature = (new URL(request.url).searchParams.get("signature") ?? "")
    .replaceAll(" ", "+")
  const body = new Uint8Array(await request.arrayBuffer())
  if (
    !env.FOXIT_ESIGN_WEBHOOK_SECRET ||
    !signature ||
    !(await verifyFoxitWebhook({
      secret: env.FOXIT_ESIGN_WEBHOOK_SECRET,
      body,
      signature,
    }))
  ) {
    return Response.json({ success: false, error: "Invalid signature." }, { status: 401 })
  }

  let payload: unknown
  try {
    payload = JSON.parse(new TextDecoder().decode(body))
  } catch {
    return Response.json({ success: false, error: "Invalid JSON." }, { status: 400 })
  }
  const event = nestedString(payload, ["event_name", "event", "eventType", "type"])
  const envelopeId = nestedString(payload, ["folderId", "folder_id", "envelopeId"])
  if (!event || !envelopeId) {
    return Response.json({ success: true, ignored: true })
  }
  const db = getDb(env.DB)
  const letter = await findTradeLetterByEnvelope(db, envelopeId)
  if (letter) return handleTradeLetterEvent({ db, env, letter, event })
  const packetRows = await db
    .select()
    .from(contractPackets)
    .where(eq(contractPackets.foxitEnvelopeId, envelopeId))
    .limit(1)
  const packet = packetRows[0]
  if (packet) {
    const now = new Date().toISOString()
    const linkedEstimate = await db
      .select()
      .from(projectEstimates)
      .where(eq(projectEstimates.id, packet.estimateId))
      .get()
    if (!linkedEstimate) {
      return Response.json(
        { success: false, error: "Linked estimate not found." },
        { status: 500 }
      )
    }
    if (event === "folder_sent") {
      if (packet.status === "draft" || packet.status === "internal_review") {
        await db.batch([
          db
            .update(contractPackets)
            .set({
              status: "signature_pending",
              foxitStatus: "sent",
              signatureRequestedAt: now,
              sourceHash: packet.preparedSourceHash,
              foxitEmbeddedSessionUrl: null,
              updatedAt: now,
            })
            .where(eq(contractPackets.id, packet.id)),
          updateEstimatesStatement(db, eq(projectEstimates.id, linkedEstimate.id), {
            status: "signature_pending",
            foxitStatus: "included_in_contract_packet",
            signatureRequestedAt: now,
            updatedAt: now,
          }),
        ])
      }
      return Response.json({ success: true })
    }

    if (event === "folder_cancelled" || event === "folder_declined") {
      const outcome = event === "folder_declined" ? "declined" : "cancelled"
      await db
        .update(contractPackets)
        .set({ foxitStatus: outcome, updatedAt: now })
        .where(eq(contractPackets.id, packet.id))
        .run()
      if (packet.foxitStatus !== outcome) {
        await announceEsignOutcome({
          db,
          projectId: packet.projectId,
          kind: "contract",
          outcome,
          recordId: packet.id,
          number: packet.packetNumber,
          title: packet.title,
          changeOrderId: null,
          sentBy: packet.createdBy,
        })
      }
      return Response.json({ success: true })
    }

    if (
      event !== "folder_executed" ||
      (packet.status !== "signature_pending" && packet.status !== "executed")
    ) {
      return Response.json({ success: true, ignored: true })
    }

    if (packet.status === "signature_pending") {
      const signedUrl = `/api/integrations/foxit/envelopes/${encodeURIComponent(envelopeId)}/document`
      // A packet for a newer contract version keeps its signed document and
      // waits until staff accept that version on the estimate page.
      const project = await db
        .select({ organizationId: projects.organizationId, projectNumber: projects.projectNumber })
        .from(projects)
        .where(eq(projects.id, packet.projectId))
        .get()
      const packetMode = await readEstimateMode(
        db,
        project?.organizationId ?? null,
        projectDepartment({ projectId: packet.projectId, projectNumber: project?.projectNumber ?? null }),
      )
      if (await contractVersionBaseline(db, linkedEstimate, packetMode)) {
        if (packet.foxitStatus !== "completed") {
          await db
            .update(contractPackets)
            .set({ foxitStatus: "completed", signaturePackageUrl: signedUrl, signedAt: now, updatedAt: now })
            .where(eq(contractPackets.id, packet.id))
            .run()
          await announceEsignOutcome({
            db,
            projectId: packet.projectId,
            kind: "contract",
            outcome: "signed",
            recordId: packet.id,
            number: packet.packetNumber,
            title: packet.title,
            changeOrderId: null,
            sentBy: packet.createdBy,
          })
        }
        return Response.json({ success: true, awaitingContractChoice: true })
      }
      await db.batch([
        db
          .update(contractPackets)
          .set({ status: "superseded", updatedAt: now })
          .where(
            and(
              eq(contractPackets.projectId, packet.projectId),
              eq(contractPackets.status, "executed"),
              ne(contractPackets.id, packet.id)
            )
          ),
        supersedeOtherContractEstimatesStatement(db, linkedEstimate.projectId, linkedEstimate.id, now),
        db
          .update(contractPackets)
          .set({
            status: "executed",
            foxitStatus: "completed",
            signaturePackageUrl: signedUrl,
            signedAt: now,
            acceptanceMethod: "foxit",
            acceptanceEvidenceLabel: "Completed Foxit contract packet",
            acceptanceRecordedByName: "Foxit eSign",
            acceptedAt: now,
            acceptedBy: packet.createdBy,
            updatedAt: now,
          })
          .where(eq(contractPackets.id, packet.id)),
        updateEstimatesStatement(db, eq(projectEstimates.id, linkedEstimate.id), {
          status: "accepted",
          foxitStatus: "completed_in_contract_packet",
          signaturePackageUrl: signedUrl,
          signedAt: now,
          acceptanceMethod: "foxit_contract_packet",
          acceptanceEvidenceLabel: "Completed Foxit contract packet",
          acceptanceRecordedByName: "Foxit eSign",
          acceptedAt: now,
          acceptedBy: packet.createdBy,
          sageStatus: "ready",
          updatedAt: now,
        }),
      ])
      await announceEsignOutcome({
        db,
        projectId: packet.projectId,
        kind: "contract",
        outcome: "signed",
        recordId: packet.id,
        number: packet.packetNumber,
        title: packet.title,
        changeOrderId: null,
        sentBy: packet.createdBy,
      })
    }
    const budget = await rebuildProjectContractBudget({
      db,
      projectId: packet.projectId,
      actorUserId: packet.createdBy,
    })
    if (!budget.success) {
      return Response.json({ success: false, error: budget.error }, { status: 500 })
    }
    return Response.json({ success: true })
  }

  const rows = await db
    .select()
    .from(projectEstimates)
    .where(eq(projectEstimates.foxitEnvelopeId, envelopeId))
    .limit(1)
  const estimate = rows[0]
  if (!estimate) return Response.json({ success: true, ignored: true })

  const now = new Date().toISOString()
  if (event === "folder_sent") {
    if (estimate.status === "draft" || estimate.status === "internal_review") {
      await updateEstimates(db, eq(projectEstimates.id, estimate.id), {
        status: "signature_pending",
        foxitStatus: "sent",
        signatureRequestedAt: now,
        sourceHash: estimate.foxitPreparedSourceHash,
        foxitEmbeddedSessionUrl: null,
        updatedAt: now,
      })
    }
    return Response.json({ success: true })
  }

  if (event === "folder_cancelled" || event === "folder_declined") {
    const outcome = event === "folder_declined" ? "declined" : "cancelled"
    await updateEstimates(db, eq(projectEstimates.id, estimate.id), { foxitStatus: outcome, updatedAt: now })
    if (estimate.foxitStatus !== outcome) {
      await announceEsignOutcome({
        db,
        projectId: estimate.projectId,
        kind: "estimate",
        outcome,
        recordId: estimate.id,
        number: estimate.estimateNumber,
        title: estimate.title,
        changeOrderId: estimate.changeOrderId,
        sentBy: estimate.createdBy,
      })
    }
    return Response.json({ success: true })
  }

  if (
    event !== "folder_executed" ||
    (estimate.status !== "signature_pending" && estimate.status !== "accepted")
  ) {
    return Response.json({ success: true, ignored: true })
  }

  // Departments with several estimates per job only replace an older
  // version of the same estimate and don't build a contract budget.
  const project = await db
    .select({ organizationId: projects.organizationId, projectNumber: projects.projectNumber })
    .from(projects)
    .where(eq(projects.id, estimate.projectId))
    .get()
  const mode = await readEstimateMode(
    db,
    project?.organizationId ?? null,
    projectDepartment({ projectId: estimate.projectId, projectNumber: project?.projectNumber ?? null }),
  )
  if (estimate.status === "signature_pending") {
    const signedDocumentUrl = `/api/integrations/foxit/envelopes/${encodeURIComponent(envelopeId)}/document`
    // A newer version of an accepted contract waits for staff to choose
    // whether it replaces the contract or becomes a change order.
    if (await contractVersionBaseline(db, estimate, mode)) {
      if (estimate.foxitStatus !== "completed") {
        await updateEstimates(db, eq(projectEstimates.id, estimate.id), {
          foxitStatus: "completed",
          signaturePackageUrl: signedDocumentUrl,
          signedAt: now,
          updatedAt: now,
        })
        await announceEsignOutcome({
          db,
          projectId: estimate.projectId,
          kind: "estimate",
          outcome: "signed",
          recordId: estimate.id,
          number: estimate.estimateNumber,
          title: estimate.title,
          changeOrderId: estimate.changeOrderId,
          sentBy: estimate.createdBy,
        })
      }
      return Response.json({ success: true, awaitingContractChoice: true })
    }
    // A signed change-order estimate executes its change order in the same batch.
    const changeOrderExecution = estimate.changeOrderId
      ? await changeOrderExecutionFromEstimate({
          db,
          estimate,
          signedAt: now,
          evidenceUrl: signedDocumentUrl,
          evidenceLabel: "Completed Foxit estimate",
          actor: { id: estimate.createdBy, name: "Foxit eSign", role: "system" },
          now,
        })
      : []
    await db.batch([
      updateEstimatesStatement(db, and(...estimateSupersedeConditions(estimate, mode)), {
        status: "superseded",
        updatedAt: now,
      }),
      updateEstimatesStatement(db, eq(projectEstimates.id, estimate.id), {
        status: "accepted",
        foxitStatus: "completed",
        signaturePackageUrl: `/api/integrations/foxit/envelopes/${encodeURIComponent(envelopeId)}/document`,
        signedAt: now,
        acceptanceMethod: "foxit",
        acceptanceEvidenceLabel: "Completed Foxit estimate",
        acceptanceRecordedByName: "Foxit eSign",
        acceptedAt: now,
        acceptedBy: estimate.createdBy,
        sageStatus: "ready",
        updatedAt: now,
      }),
      ...changeOrderExecution,
    ])
    await announceEsignOutcome({
      db,
      projectId: estimate.projectId,
      kind: "estimate",
      outcome: "signed",
      recordId: estimate.id,
      number: estimate.estimateNumber,
      title: estimate.title,
      changeOrderId: estimate.changeOrderId,
      sentBy: estimate.createdBy,
    })
  }
  if (estimate.phaseProposalId) {
    // A phase estimate sets up its family phase instead of a contract budget.
    const phase = await completePhaseProposal({
      db,
      estimate: { ...estimate, signedAt: estimate.signedAt ?? now },
      actor: { id: estimate.createdBy, name: "Foxit eSign", role: "system" },
      now,
    })
    if (!phase.success) return Response.json({ success: false, error: phase.error }, { status: 500 })
    return Response.json({ success: true })
  }
  if (mode === "multiple") return Response.json({ success: true })
  const budget = await rebuildProjectContractBudget({
    db,
    projectId: estimate.projectId,
    actorUserId: estimate.createdBy,
  })
  if (!budget.success) {
    return Response.json({ success: false, error: budget.error }, { status: 500 })
  }
  return Response.json({ success: true })
}
