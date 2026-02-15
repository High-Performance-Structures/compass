// Type definitions for memory provider
// Separate file to avoid bundling better-sqlite3

export interface MemoryProviderConfig {
  // Optional: seed data for testing
  seedData?: {
    tables: string[]
    data: Record<string, unknown>[]
  }[]
}
