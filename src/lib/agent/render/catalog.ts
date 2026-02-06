import { defineCatalog } from "@json-render/core"
import { schema } from "@json-render/react/schema"
import { z } from "zod"

export const compassCatalog = defineCatalog(schema, {
  components: {
    // Layout
    Card: {
      props: z.object({
        title: z.string().nullable(),
        description: z.string().nullable(),
        maxWidth: z
          .enum(["sm", "md", "lg", "full"])
          .nullable(),
        centered: z.boolean().nullable(),
      }),
      slots: ["default"],
      description:
        "Container card for content sections. " +
        "Use as root for dashboards.",
    },

    Stack: {
      props: z.object({
        direction: z
          .enum(["horizontal", "vertical"])
          .nullable(),
        gap: z.enum(["none", "sm", "md", "lg"]).nullable(),
        align: z
          .enum(["start", "center", "end", "stretch"])
          .nullable(),
        justify: z
          .enum([
            "start",
            "center",
            "end",
            "between",
            "around",
          ])
          .nullable(),
      }),
      slots: ["default"],
      description: "Flex container for layouts",
    },

    Grid: {
      props: z.object({
        columns: z
          .union([
            z.literal(1),
            z.literal(2),
            z.literal(3),
            z.literal(4),
          ])
          .nullable(),
        gap: z.enum(["sm", "md", "lg"]).nullable(),
      }),
      slots: ["default"],
      description: "Grid layout (1-4 columns)",
    },

    Divider: {
      props: z.object({}),
      description: "Horizontal separator line",
    },

    // Typography
    Heading: {
      props: z.object({
        text: z.string(),
        level: z
          .enum(["h1", "h2", "h3", "h4"])
          .nullable(),
      }),
      description: "Heading text (h1-h4)",
    },

    Text: {
      props: z.object({
        text: z.string(),
        variant: z
          .enum(["body", "caption", "muted"])
          .nullable(),
      }),
      description: "Paragraph text",
    },

    // Form Inputs
    Input: {
      props: z.object({
        label: z.string(),
        name: z.string(),
        type: z
          .enum(["text", "email", "password", "number"])
          .nullable(),
        placeholder: z.string().nullable(),
      }),
      description: "Text input field",
    },

    Textarea: {
      props: z.object({
        label: z.string(),
        name: z.string(),
        placeholder: z.string().nullable(),
        rows: z.number().nullable(),
      }),
      description: "Multi-line text input",
    },

    Select: {
      props: z.object({
        label: z.string(),
        name: z.string(),
        options: z.array(z.string()),
        placeholder: z.string().nullable(),
      }),
      description: "Dropdown select input",
    },

    Checkbox: {
      props: z.object({
        label: z.string(),
        name: z.string(),
        checked: z.boolean().nullable(),
      }),
      description: "Checkbox input",
    },

    Radio: {
      props: z.object({
        label: z.string(),
        name: z.string(),
        options: z.array(z.string()),
      }),
      description: "Radio button group",
    },

    Switch: {
      props: z.object({
        label: z.string(),
        name: z.string(),
        checked: z.boolean().nullable(),
      }),
      description: "Toggle switch input",
    },

    // Actions
    Button: {
      props: z.object({
        label: z.string(),
        variant: z
          .enum(["primary", "secondary", "danger"])
          .nullable(),
        action: z.string().nullable(),
        actionParams: z
          .record(z.string(), z.unknown())
          .nullable(),
      }),
      description:
        "Clickable button. Use action for " +
        "action name, actionParams for parameters.",
    },

    Link: {
      props: z.object({
        label: z.string(),
        href: z.string(),
      }),
      description: "Anchor link",
    },

    // Data Display
    Image: {
      props: z.object({
        alt: z.string(),
        width: z.number().nullable(),
        height: z.number().nullable(),
      }),
      description: "Placeholder image",
    },

    Avatar: {
      props: z.object({
        src: z.string().nullable(),
        name: z.string(),
        size: z.enum(["sm", "md", "lg"]).nullable(),
      }),
      description: "User avatar with fallback initials",
    },

    Badge: {
      props: z.object({
        text: z.string(),
        variant: z
          .enum(["default", "success", "warning", "danger"])
          .nullable(),
      }),
      description: "Status badge",
    },

    Alert: {
      props: z.object({
        title: z.string(),
        message: z.string().nullable(),
        type: z
          .enum(["info", "success", "warning", "error"])
          .nullable(),
      }),
      description: "Alert banner",
    },

    Progress: {
      props: z.object({
        value: z.number(),
        max: z.number().nullable(),
        label: z.string().nullable(),
      }),
      description: "Progress bar (value 0-100)",
    },

    Rating: {
      props: z.object({
        value: z.number(),
        max: z.number().nullable(),
        label: z.string().nullable(),
      }),
      description: "Star rating display",
    },

    // Charts
    BarGraph: {
      props: z.object({
        title: z.string().nullable(),
        data: z.array(
          z.object({
            label: z.string(),
            value: z.number(),
          })
        ),
      }),
      description: "Vertical bar chart",
    },

    LineGraph: {
      props: z.object({
        title: z.string().nullable(),
        data: z.array(
          z.object({
            label: z.string(),
            value: z.number(),
          })
        ),
      }),
      description: "Line chart with points",
    },

    // Compass-specific
    StatCard: {
      props: z.object({
        title: z.string(),
        value: z.union([z.string(), z.number()]),
        change: z.number().nullable(),
        changeLabel: z.string().nullable(),
      }),
      description:
        "Single metric with optional trend indicator",
    },

    DataTable: {
      props: z.object({
        columns: z.array(
          z.object({
            key: z.string(),
            header: z.string(),
            format: z
              .enum(["text", "currency", "date", "badge"])
              .nullable(),
          })
        ),
        data: z.array(
          z.record(z.string(), z.unknown())
        ),
      }),
      description:
        "Tabular data display with columns. " +
        "Best for lists of records.",
    },

    InvoiceTable: {
      props: z.object({
        invoices: z.array(
          z.object({
            id: z.string(),
            number: z.string(),
            customer: z.string(),
            amount: z.number(),
            dueDate: z.string(),
            status: z.enum([
              "draft",
              "sent",
              "paid",
              "overdue",
            ]),
          })
        ),
      }),
      description:
        "Specialized table for invoices with status badges",
    },

    ProjectSummary: {
      props: z.object({
        name: z.string(),
        status: z.string(),
        address: z.string().nullable(),
        clientName: z.string().nullable(),
        tasksTotal: z.number().nullable(),
        tasksComplete: z.number().nullable(),
        daysRemaining: z.number().nullable(),
      }),
      description: "Project overview with key stats",
    },

    SchedulePreview: {
      props: z.object({
        projectName: z.string(),
        tasks: z.array(
          z.object({
            title: z.string(),
            startDate: z.string(),
            endDate: z.string(),
            phase: z.string(),
            status: z.string(),
            percentComplete: z.number(),
          })
        ),
      }),
      description: "Preview of project schedule tasks",
    },
  },

  actions: {
    navigateTo: {
      params: z.object({
        path: z.string(),
      }),
      description: "Navigate to a compass page",
    },

    viewRecord: {
      params: z.object({
        type: z.string(),
        id: z.string(),
      }),
      description: "Open a record detail view",
    },

    buttonClick: {
      params: z.object({
        message: z.string().nullable(),
      }),
      description: "Generic button click with toast",
    },

    formSubmit: {
      params: z.object({
        formName: z.string().nullable(),
      }),
      description: "Submit form data",
    },

    exportData: {
      params: z.object({
        format: z.string().nullable(),
      }),
      description: "Trigger data export",
    },
  },
})
