import type {
  AudienceScheduleItem,
  ProjectAudiencePreview,
} from "@/app/actions/project-audience-preview"
import type { AudienceDashboardFinancials } from "@/lib/project-audience-dashboard"

export function dashboardScheduleItem(
  overrides: Partial<AudienceScheduleItem> = {}
): AudienceScheduleItem {
  return {
    id: "framing",
    title: "Framing review",
    startDate: "2026-09-08",
    endDate: "2026-09-10",
    workdays: 3,
    status: "scheduled",
    phase: "Framing",
    displayColor: null,
    assignedTo: "Alex Larson",
    percentComplete: 0,
    isMilestone: false,
    confirmationRequired: true,
    confirmationStatus: "pending",
    viewerCanConfirm: true,
    proposedStartDate: null,
    proposedWorkdays: null,
    proposalNote: null,
    proposalSubmittedAt: null,
    assignees: [],
    ...overrides,
  }
}

export function dashboardFixture(
  audience: "owner" | "sub_vendor" = "owner"
): ProjectAudiencePreview {
  return {
    audience,
    viewerIsInternal: false,
    viewer: {
      id: "viewer",
      name: "Alex Larson",
      email: "alex@example.com",
      avatarUrl: null,
      sidebarPhotoUrl: null,
    },
    projectOptions: [
      {
        id: "cedar",
        name: "Cedar Ridge Residence",
        projectNumber: "O-123",
        status: "OPEN",
      },
      {
        id: "meadow",
        name: "Meadow House",
        projectNumber: "O-124",
        status: "OPEN",
      },
    ],
    project: {
      id: "cedar",
      name: "Cedar Ridge Residence",
      projectNumber: "O-123",
      textPhoneNumber: "+15555550123",
      address: "100 Cedar Lane",
      clientName: "Larson",
      projectManager: "Jordan Miller",
      ownerScheduleView: "items",
      warrantyEnabled: true,
    },
    ownerUpdates:
      audience === "owner"
        ? [
            {
              id: "update-1",
              title: "Exterior walls are complete",
              updateDate: "2026-09-04",
              summary: "This week’s project progress.",
              publishedAt: "2026-09-04T12:00:00Z",
            },
          ]
        : [],
    photos: ["photo-1", "photo-2"].map((id) => ({
      id,
      fileName: `${id}.jpg`,
      driveFileId: null,
      thumbnailUrl: `/api/projects/cedar/photos/${id}?audience=${audience}`,
      caption: "Exterior wall progress",
      capturedAt: null,
      photoDate: "2026-09-04",
      schedulePhase: "Framing",
      schedulePhaseConfidence: 100,
      schedulePhaseReason: "Selected",
    })),
    documents: [],
    schedulePublicationAvailable: true,
    scheduleItems: [dashboardScheduleItem()],
    operations:
      audience === "sub_vendor"
        ? [
            {
              id: "po-1",
              sourceRecordType: "purchase_order",
              sourceRecordNumber: "PO-021",
              title: "Framing materials",
              description: null,
              status: "sent",
              priority: "normal",
              assigneeName: "Alex Larson",
              companyName: "Cedar Supply",
              startDate: null,
              dueDate: "2026-09-10",
              amount: 1000,
              acknowledgement: null,
              latestVendorStatus: null,
            },
          ]
        : [],
    rfis: [
      {
        id: "rfi-1",
        rfiNumber: "RFI-027",
        subject: "Beam connection detail",
        question: "Confirm connection detail.",
        answer: "Use the published detail.",
        status: "answered",
        priority: "normal",
        requesterName: "Alex Larson",
        assignedToName: "Jordan Miller",
        companyName: null,
        dueDate: "2026-09-09",
        submittedAt: "2026-09-04T12:00:00Z",
        answeredAt: "2026-09-08T12:00:00Z",
      },
    ],
    rfqs:
      audience === "sub_vendor"
        ? [
            {
              id: "quote-1",
              number: "RFQ-008",
              title: "Roof material pricing",
              description: null,
              status: "sent",
              priority: "normal",
              companyName: "Cedar Supply",
              vendorCategory: "Supply",
              dueDate: "2026-09-09",
              amount: null,
              scopeItems: [],
              documentLinks: [],
              vendorResponse: null,
            },
          ]
        : [],
    messageChannels: [
      {
        id: "channel-1",
        name: "Project conversation",
        description: null,
        isPrivate: true,
      },
    ],
    contacts: [
      {
        id: "contact-1",
        userId: "manager",
        contactType: "staff",
        displayName: "Jordan Miller",
        companyName: "HPS",
        role: "Project manager",
        trade: null,
        csiDivision: null,
        csiDivisionName: null,
        email: "jordan@example.com",
        phone: "+15555550124",
        primaryContact: true,
      },
    ],
  }
}

export function dashboardFinancials(): AudienceDashboardFinancials {
  return {
    changeOrders: [
      {
        id: "co-1",
        title: "Kitchen window change",
        changeOrderNumber: "CO-014",
        status: "approved_for_owner",
        canEdit: false,
      },
    ],
    applications: [
      { id: "app-1", applicationNumber: "05", periodTo: "2026-09-01" },
    ],
  }
}
