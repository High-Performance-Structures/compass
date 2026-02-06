/**
 * json-render Component Catalog for Compass
 *
 * Defines the components the agent can render as dynamic UI.
 * Each component maps to an existing shadcn/ui component or
 * Compass-specific component wrapper.
 */

import { z } from "zod"

// Shared schemas
const ActionSchema = z.object({
  type: z.string(),
  payload: z.record(z.string(), z.unknown()).optional(),
})

// Data display components
export const DataTableSchema = z.object({
  type: z.literal("DataTable"),
  props: z.object({
    columns: z.array(
      z.object({
        key: z.string(),
        header: z.string(),
        format: z.enum(["text", "currency", "date", "badge"]).optional(),
      })
    ),
    data: z.array(z.record(z.string(), z.unknown())),
    onRowClick: ActionSchema.optional(),
  }),
})

export const CardSchema = z.object({
  type: z.literal("Card"),
  props: z.object({
    title: z.string(),
    description: z.string().optional(),
    children: z.array(z.unknown()).optional(),
    footer: z.string().optional(),
  }),
})

export const BadgeSchema = z.object({
  type: z.literal("Badge"),
  props: z.object({
    label: z.string(),
    variant: z
      .enum(["default", "secondary", "destructive", "outline"])
      .optional(),
  }),
})

export const StatCardSchema = z.object({
  type: z.literal("StatCard"),
  props: z.object({
    title: z.string(),
    value: z.union([z.string(), z.number()]),
    change: z.number().optional(),
    changeLabel: z.string().optional(),
    icon: z.string().optional(),
  }),
})

// Action components
export const ButtonSchema = z.object({
  type: z.literal("Button"),
  props: z.object({
    label: z.string(),
    action: ActionSchema,
    variant: z
      .enum(["default", "secondary", "destructive", "outline", "ghost", "link"])
      .optional(),
    size: z.enum(["default", "sm", "lg", "icon"]).optional(),
  }),
})

export const ButtonGroupSchema = z.object({
  type: z.literal("ButtonGroup"),
  props: z.object({
    buttons: z.array(ButtonSchema.shape.props),
  }),
})

// Chart components
export const BarChartSchema = z.object({
  type: z.literal("BarChart"),
  props: z.object({
    data: z.array(z.record(z.string(), z.union([z.string(), z.number()]))),
    xKey: z.string(),
    yKey: z.string(),
    height: z.number().optional(),
  }),
})

export const LineChartSchema = z.object({
  type: z.literal("LineChart"),
  props: z.object({
    data: z.array(z.record(z.string(), z.union([z.string(), z.number()]))),
    xKey: z.string(),
    yKey: z.string(),
    height: z.number().optional(),
  }),
})

export const PieChartSchema = z.object({
  type: z.literal("PieChart"),
  props: z.object({
    data: z.array(
      z.object({
        name: z.string(),
        value: z.number(),
        color: z.string().optional(),
      })
    ),
    height: z.number().optional(),
  }),
})

// Domain-specific components
export const InvoiceTableSchema = z.object({
  type: z.literal("InvoiceTable"),
  props: z.object({
    invoices: z.array(
      z.object({
        id: z.string(),
        number: z.string(),
        customer: z.string(),
        amount: z.number(),
        dueDate: z.string(),
        status: z.enum(["draft", "sent", "paid", "overdue"]),
      })
    ),
    onRowClick: ActionSchema.optional(),
  }),
})

export const CustomerCardSchema = z.object({
  type: z.literal("CustomerCard"),
  props: z.object({
    customer: z.object({
      id: z.string(),
      name: z.string(),
      company: z.string().optional(),
      email: z.string().optional(),
      phone: z.string().optional(),
    }),
    actions: z.array(ActionSchema).optional(),
  }),
})

export const VendorCardSchema = z.object({
  type: z.literal("VendorCard"),
  props: z.object({
    vendor: z.object({
      id: z.string(),
      name: z.string(),
      category: z.string(),
      email: z.string().optional(),
      phone: z.string().optional(),
    }),
    actions: z.array(ActionSchema).optional(),
  }),
})

export const SchedulePreviewSchema = z.object({
  type: z.literal("SchedulePreview"),
  props: z.object({
    projectId: z.string(),
    projectName: z.string(),
    tasks: z.array(
      z.object({
        id: z.string(),
        title: z.string(),
        startDate: z.string(),
        endDate: z.string(),
        phase: z.string(),
        status: z.string(),
        percentComplete: z.number(),
        isCriticalPath: z.boolean().optional(),
      })
    ),
    onTaskClick: ActionSchema.optional(),
  }),
})

export const ProjectSummarySchema = z.object({
  type: z.literal("ProjectSummary"),
  props: z.object({
    project: z.object({
      id: z.string(),
      name: z.string(),
      status: z.string(),
      address: z.string().optional(),
      clientName: z.string().optional(),
      projectManager: z.string().optional(),
    }),
    stats: z
      .object({
        tasksTotal: z.number(),
        tasksComplete: z.number(),
        daysRemaining: z.number().optional(),
        budgetUsed: z.number().optional(),
      })
      .optional(),
    actions: z.array(ActionSchema).optional(),
  }),
})

// Layout components
export const GridSchema = z.object({
  type: z.literal("Grid"),
  props: z.object({
    columns: z.number().min(1).max(4),
    gap: z.number().optional(),
    children: z.array(z.unknown()),
  }),
})

export const StackSchema = z.object({
  type: z.literal("Stack"),
  props: z.object({
    direction: z.enum(["horizontal", "vertical"]).optional(),
    gap: z.number().optional(),
    children: z.array(z.unknown()),
  }),
})

// Union of all component schemas
export const ComponentSchema = z.discriminatedUnion("type", [
  DataTableSchema,
  CardSchema,
  BadgeSchema,
  StatCardSchema,
  ButtonSchema,
  ButtonGroupSchema,
  BarChartSchema,
  LineChartSchema,
  PieChartSchema,
  InvoiceTableSchema,
  CustomerCardSchema,
  VendorCardSchema,
  SchedulePreviewSchema,
  ProjectSummarySchema,
  GridSchema,
  StackSchema,
])

export type ComponentSpec = z.infer<typeof ComponentSchema>
export type ComponentType = ComponentSpec["type"]

// Catalog for agent reference
export const componentCatalog = {
  DataTable: {
    description:
      "Display tabular data with sortable columns. Best for lists of items.",
    example: {
      type: "DataTable",
      props: {
        columns: [
          { key: "name", header: "Name" },
          { key: "status", header: "Status", format: "badge" },
        ],
        data: [{ name: "Item 1", status: "active" }],
      },
    },
  },
  Card: {
    description: "A container for related information with optional title.",
    example: {
      type: "Card",
      props: { title: "Summary", description: "Key metrics at a glance" },
    },
  },
  Badge: {
    description: "Small label for status or category indication.",
    example: {
      type: "Badge",
      props: { label: "Active", variant: "default" },
    },
  },
  StatCard: {
    description: "Display a single metric with optional trend indicator.",
    example: {
      type: "StatCard",
      props: { title: "Revenue", value: "$12,500", change: 12 },
    },
  },
  Button: {
    description: "Clickable action button.",
    example: {
      type: "Button",
      props: {
        label: "View Details",
        action: { type: "NAVIGATE_TO", payload: { path: "/details" } },
      },
    },
  },
  BarChart: {
    description: "Vertical bar chart for comparing values.",
    example: {
      type: "BarChart",
      props: {
        data: [
          { month: "Jan", sales: 100 },
          { month: "Feb", sales: 150 },
        ],
        xKey: "month",
        yKey: "sales",
      },
    },
  },
  InvoiceTable: {
    description: "Specialized table for displaying invoices with status.",
    example: {
      type: "InvoiceTable",
      props: {
        invoices: [
          {
            id: "1",
            number: "INV-001",
            customer: "Acme",
            amount: 5000,
            dueDate: "2024-01-15",
            status: "overdue",
          },
        ],
      },
    },
  },
  CustomerCard: {
    description: "Display customer information in a card format.",
    example: {
      type: "CustomerCard",
      props: {
        customer: { id: "1", name: "John Doe", company: "Acme Corp" },
      },
    },
  },
  SchedulePreview: {
    description: "Preview of project schedule tasks.",
    example: {
      type: "SchedulePreview",
      props: {
        projectId: "1",
        projectName: "Highland Park",
        tasks: [
          {
            id: "t1",
            title: "Foundation",
            startDate: "2024-01-01",
            endDate: "2024-01-15",
            phase: "Foundation",
            status: "complete",
            percentComplete: 100,
          },
        ],
      },
    },
  },
  ProjectSummary: {
    description: "Overview card for a project with key stats.",
    example: {
      type: "ProjectSummary",
      props: {
        project: { id: "1", name: "Highland Park", status: "OPEN" },
        stats: { tasksTotal: 24, tasksComplete: 12 },
      },
    },
  },
  Grid: {
    description: "Grid layout for arranging multiple components.",
    example: {
      type: "Grid",
      props: { columns: 2, children: [] },
    },
  },
  Stack: {
    description: "Stack layout for vertical or horizontal arrangement.",
    example: {
      type: "Stack",
      props: { direction: "vertical", children: [] },
    },
  },
} as const

export type CatalogKey = keyof typeof componentCatalog

// Helper to generate component catalog description for agent prompts
export function getComponentCatalogPrompt(): string {
  return Object.entries(componentCatalog)
    .map(([name, info]) => `- ${name}: ${info.description}`)
    .join("\n")
}
