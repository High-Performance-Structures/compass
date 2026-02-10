import {
  sqliteTable,
  text,
  integer,
  real,
} from "drizzle-orm/sqlite-core"

// Auth and user management tables
export const users = sqliteTable("users", {
  id: text("id").primaryKey(), // workos user id
  email: text("email").notNull().unique(),
  firstName: text("first_name"),
  lastName: text("last_name"),
  displayName: text("display_name"),
  avatarUrl: text("avatar_url"),
  role: text("role").notNull().default("office"), // admin, office, field, client
  googleEmail: text("google_email"), // override for google workspace impersonation
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  lastLoginAt: text("last_login_at"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
})

export const organizations = sqliteTable("organizations", {
  id: text("id").primaryKey(), // workos org id
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  type: text("type").notNull(), // "internal" or "client"
  logoUrl: text("logo_url"),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
})

export const organizationMembers = sqliteTable("organization_members", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  role: text("role").notNull(),
  joinedAt: text("joined_at").notNull(),
})

export const teams = sqliteTable("teams", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description"),
  createdAt: text("created_at").notNull(),
})

export const teamMembers = sqliteTable("team_members", {
  id: text("id").primaryKey(),
  teamId: text("team_id")
    .notNull()
    .references(() => teams.id, { onDelete: "cascade" }),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  joinedAt: text("joined_at").notNull(),
})

export const groups = sqliteTable("groups", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description"),
  color: text("color"), // hex color for badges
  createdAt: text("created_at").notNull(),
})

export const groupMembers = sqliteTable("group_members", {
  id: text("id").primaryKey(),
  groupId: text("group_id")
    .notNull()
    .references(() => groups.id, { onDelete: "cascade" }),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  joinedAt: text("joined_at").notNull(),
})

export const projects = sqliteTable("projects", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  status: text("status").notNull().default("OPEN"),
  address: text("address"),
  clientName: text("client_name"),
  projectManager: text("project_manager"),
  organizationId: text("organization_id").references(() => organizations.id),
  netsuiteJobId: text("netsuite_job_id"),
  createdAt: text("created_at").notNull(),
})

export const projectMembers = sqliteTable("project_members", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  role: text("role").notNull(),
  assignedAt: text("assigned_at").notNull(),
})

export const dailyLogs = sqliteTable("daily_logs", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  date: text("date").notNull(),
  notes: text("notes"),
  weather: text("weather"),
  createdBy: text("created_by"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at"),
})

export const projectAssets = sqliteTable("project_assets", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  dailyLogId: text("daily_log_id").references(() => dailyLogs.id, {
    onDelete: "set null",
  }),
  type: text("type").notNull(), // IMAGE, VIDEO, DOCUMENT
  url: text("url").notNull(),
  thumbnailUrl: text("thumbnail_url"),
  driveFileId: text("drive_file_id"),
  name: text("name"),
  uploadedBy: text("uploaded_by").references(() => users.id),
  createdAt: text("created_at").notNull(),
})

export const scheduleTasks = sqliteTable("schedule_tasks", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  startDate: text("start_date").notNull(),
  workdays: integer("workdays").notNull(),
  endDateCalculated: text("end_date_calculated").notNull(),
  phase: text("phase").notNull(),
  status: text("status").notNull().default("PENDING"),
  isCriticalPath: integer("is_critical_path", { mode: "boolean" })
    .notNull()
    .default(false),
  isMilestone: integer("is_milestone", { mode: "boolean" })
    .notNull()
    .default(false),
  percentComplete: integer("percent_complete").notNull().default(0),
  assignedTo: text("assigned_to"),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
})

export const taskDependencies = sqliteTable("task_dependencies", {
  id: text("id").primaryKey(),
  predecessorId: text("predecessor_id")
    .notNull()
    .references(() => scheduleTasks.id, { onDelete: "cascade" }),
  successorId: text("successor_id")
    .notNull()
    .references(() => scheduleTasks.id, { onDelete: "cascade" }),
  type: text("type").notNull().default("FS"),
  lagDays: integer("lag_days").notNull().default(0),
})

export const workdayExceptions = sqliteTable("workday_exceptions", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  startDate: text("start_date").notNull(),
  endDate: text("end_date").notNull(),
  type: text("type").notNull().default("non_working"),
  category: text("category").notNull().default("company_holiday"),
  recurrence: text("recurrence").notNull().default("one_time"),
  notes: text("notes"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
})

export const scheduleBaselines = sqliteTable("schedule_baselines", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  snapshotData: text("snapshot_data").notNull(),
  createdAt: text("created_at").notNull(),
})

export const customers = sqliteTable("customers", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  company: text("company"),
  email: text("email"),
  phone: text("phone"),
  address: text("address"),
  notes: text("notes"),
  netsuiteId: text("netsuite_id"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at"),
})

export const vendors = sqliteTable("vendors", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  category: text("category").notNull().default("Subcontractor"),
  email: text("email"),
  phone: text("phone"),
  address: text("address"),
  netsuiteId: text("netsuite_id"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at"),
})

export type Project = typeof projects.$inferSelect
export type ScheduleTask = typeof scheduleTasks.$inferSelect
export type NewScheduleTask = typeof scheduleTasks.$inferInsert
export type TaskDependency = typeof taskDependencies.$inferSelect
export type NewTaskDependency = typeof taskDependencies.$inferInsert
export type WorkdayException = typeof workdayExceptions.$inferSelect
export type NewWorkdayException = typeof workdayExceptions.$inferInsert
export type ScheduleBaseline = typeof scheduleBaselines.$inferSelect
export type NewScheduleBaseline = typeof scheduleBaselines.$inferInsert
export type Customer = typeof customers.$inferSelect
export type NewCustomer = typeof customers.$inferInsert
export const feedback = sqliteTable("feedback", {
  id: text("id").primaryKey(),
  type: text("type").notNull(),
  message: text("message").notNull(),
  name: text("name"),
  email: text("email"),
  pageUrl: text("page_url"),
  userAgent: text("user_agent"),
  viewportWidth: integer("viewport_width"),
  viewportHeight: integer("viewport_height"),
  ipHash: text("ip_hash"),
  githubIssueUrl: text("github_issue_url"),
  createdAt: text("created_at").notNull(),
})

export type Vendor = typeof vendors.$inferSelect
export type NewVendor = typeof vendors.$inferInsert
export type Feedback = typeof feedback.$inferSelect
export type NewFeedback = typeof feedback.$inferInsert

// Auth and user management types
export type User = typeof users.$inferSelect
export type NewUser = typeof users.$inferInsert
export type Organization = typeof organizations.$inferSelect
export type NewOrganization = typeof organizations.$inferInsert
export type OrganizationMember = typeof organizationMembers.$inferSelect
export type NewOrganizationMember = typeof organizationMembers.$inferInsert
export type Team = typeof teams.$inferSelect
export type NewTeam = typeof teams.$inferInsert
export type TeamMember = typeof teamMembers.$inferSelect
export type NewTeamMember = typeof teamMembers.$inferInsert
export type Group = typeof groups.$inferSelect
export type NewGroup = typeof groups.$inferInsert
export type GroupMember = typeof groupMembers.$inferSelect
export type NewGroupMember = typeof groupMembers.$inferInsert
export type ProjectMember = typeof projectMembers.$inferSelect
export type NewProjectMember = typeof projectMembers.$inferInsert

// Agent memory tables for ElizaOS
export const agentConversations = sqliteTable("agent_conversations", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  title: text("title"),
  lastMessageAt: text("last_message_at").notNull(),
  createdAt: text("created_at").notNull(),
})

export const agentMemories = sqliteTable("agent_memories", {
  id: text("id").primaryKey(),
  conversationId: text("conversation_id")
    .notNull()
    .references(() => agentConversations.id, { onDelete: "cascade" }),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  role: text("role").notNull(), // "user" | "assistant"
  content: text("content").notNull(),
  embedding: text("embedding"), // JSON array of floats for vector search
  metadata: text("metadata"), // JSON object for action results, ui specs, etc.
  createdAt: text("created_at").notNull(),
})

export type AgentConversation = typeof agentConversations.$inferSelect
export type NewAgentConversation = typeof agentConversations.$inferInsert
export type AgentMemory = typeof agentMemories.$inferSelect
export type NewAgentMemory = typeof agentMemories.$inferInsert

// Feedback interview table for UX research
export const feedbackInterviews = sqliteTable("feedback_interviews", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id),
  userName: text("user_name").notNull(),
  userRole: text("user_role").notNull(),
  responses: text("responses").notNull(),
  summary: text("summary").notNull(),
  painPoints: text("pain_points"),
  featureRequests: text("feature_requests"),
  overallSentiment: text("overall_sentiment").notNull(),
  githubIssueUrl: text("github_issue_url"),
  conversationId: text("conversation_id"),
  createdAt: text("created_at").notNull(),
})

export type FeedbackInterview = typeof feedbackInterviews.$inferSelect
export type NewFeedbackInterview = typeof feedbackInterviews.$inferInsert

// Slab persistent memory
export const slabMemories = sqliteTable("slab_memories", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  content: text("content").notNull(),
  memoryType: text("memory_type").notNull(), // preference | workflow | fact | decision
  tags: text("tags"), // comma-separated, lowercase
  importance: real("importance").notNull().default(0.7),
  pinned: integer("pinned", { mode: "boolean" }).notNull().default(false),
  accessCount: integer("access_count").notNull().default(0),
  lastAccessedAt: text("last_accessed_at"),
  createdAt: text("created_at").notNull(),
})

export type SlabMemory = typeof slabMemories.$inferSelect
export type NewSlabMemory = typeof slabMemories.$inferInsert

// Push notification tokens for native app
export const pushTokens = sqliteTable("push_tokens", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  token: text("token").notNull(),
  platform: text("platform").notNull(), // "ios" | "android"
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
})

export type PushToken = typeof pushTokens.$inferSelect
export type NewPushToken = typeof pushTokens.$inferInsert
