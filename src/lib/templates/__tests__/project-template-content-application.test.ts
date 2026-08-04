import { describe, expect, it } from "vitest"

import { buildProjectTemplateContentApplication } from "../project-template-content-application"

describe("buildProjectTemplateContentApplication", () => {
  it("materializes Buildertrend tasks, selections, and bid packages without department data", () => {
    let sequence = 0
    const result = buildProjectTemplateContentApplication({
      applicationId: "application-1",
      nextId: () => `created-${++sequence}`,
      items: [
        {
          id: "content-parent",
          moduleType: "tasks",
          sourceItemId: "task-parent",
          parentSourceItemId: null,
          title: "Drywall QC Inspection",
          category: null,
          description: null,
          sortOrder: 1,
          payloadJson: null,
        },
        {
          id: "content-child",
          moduleType: "tasks",
          sourceItemId: "task-child",
          parentSourceItemId: "task-parent",
          title: "Check corner bead",
          category: null,
          description: null,
          sortOrder: 2,
          payloadJson: null,
        },
        {
          id: "content-selection",
          moduleType: "selections",
          sourceItemId: "selection-1",
          parentSourceItemId: null,
          title: "Texture",
          category: "09 29 00 - Gypsum Wallboard",
          description: null,
          sortOrder: 3,
          payloadJson: JSON.stringify({
            location: "Interior",
            status: "Unreleased",
            choices: [{ title: "Hand Trowel" }, { title: "Knockdown" }],
            attachments: [{ fileName: "Drywall Finish Specs.pdf" }],
          }),
        },
        {
          id: "content-bid",
          moduleType: "bid_packages",
          sourceItemId: "bid-1",
          parentSourceItemId: null,
          title: "Drywall bid",
          category: null,
          description: "Scope of work",
          sortOrder: 4,
          payloadJson: JSON.stringify({
            lineItems: [
              { costCode: "09 29 00 - Gypsum Wallboard", quantity: 1 },
            ],
          }),
        },
      ],
    })

    expect(result.todos).toHaveLength(1)
    expect(result.todos[0]).toMatchObject({
      title: "Drywall QC Inspection",
      description: "Checklist:\n☐ Check corner bead",
      sourceRecordId: "application-1:content-parent",
    })
    expect(JSON.parse(result.todos[0]?.sourcePayloadJson ?? "{}")).toMatchObject({
      checklistItems: [
        {
          templateContentItemId: "content-child",
          sourceItemId: "task-child",
          title: "Check corner bead",
        },
      ],
    })
    expect(result.selections).toEqual([
      expect.objectContaining({
        roomName: "Interior",
        category: "09 29 00 - Gypsum Wallboard",
        costCode: "09 29 00",
        status: "needed",
        notes:
          "Template choices:\n- Hand Trowel\n- Knockdown\n\n" +
          "Template attachment references:\n- Drywall Finish Specs.pdf",
      }),
    ])
    expect(result.bidPackages).toEqual([
      expect.objectContaining({
        title: "Drywall bid",
        description: "Scope of work",
        costCode: "09 29 00",
      }),
    ])
    expect(JSON.stringify(result)).not.toContain("department")
  })

  it("keeps imported selections internal until staff chooses project visibility", () => {
    const result = buildProjectTemplateContentApplication({
      applicationId: "application-2",
      nextId: () => "created-selection",
      items: [
        {
          id: "selection-content",
          moduleType: "selections",
          sourceItemId: "selection-source",
          parentSourceItemId: null,
          title: "Window Wrap Options",
          category: null,
          description: null,
          sortOrder: 0,
          payloadJson: JSON.stringify({ requireClientSelection: true }),
        },
      ],
    })

    expect(result.selections).toEqual([
      expect.objectContaining({
        roomName: "Whole Project",
        category: "Uncategorized",
        status: "needed",
      }),
    ])
  })

  it("fails before application when captured reusable content is malformed", () => {
    expect(() =>
      buildProjectTemplateContentApplication({
        applicationId: "application-3",
        nextId: () => "created-bid",
        items: [
          {
            id: "bid-content",
            moduleType: "bid_packages",
            sourceItemId: "bid-source",
            parentSourceItemId: null,
            title: "Bid package",
            category: null,
            description: null,
            sortOrder: 0,
            payloadJson: "not-json",
          },
        ],
      })
    ).toThrow("Template content has an invalid captured payload.")
  })

  it("fails instead of materializing a checklist item without its task", () => {
    expect(() =>
      buildProjectTemplateContentApplication({
        applicationId: "application-4",
        nextId: () => "created-task",
        items: [
          {
            id: "orphan-content",
            moduleType: "tasks",
            sourceItemId: "orphan-source",
            parentSourceItemId: "missing-parent",
            title: "Orphan checklist item",
            category: null,
            description: null,
            sortOrder: 0,
            payloadJson: null,
          },
        ],
      })
    ).toThrow("Template checklist item references a missing parent task.")
  })
})
