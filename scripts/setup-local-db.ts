#!/usr/bin/env bun
/**
 * Initialize local development database
 * 
 * This script sets up a local SQLite database for development,
 * bypassing the need for Cloudflare D1 and authentication.
 * 
 * Usage: bun run setup-local-db
 */

import { Database } from "bun:sqlite"
import path from "path"
import fs from "fs"

console.log("🚀 Setting up local development database...")

try {
  // Check if we should reset
  const shouldReset = process.argv.includes("--reset")
  
  // Database file path
  const DB_PATH = path.join(process.cwd(), ".local", "dev.db")
  
  // Ensure .local directory exists
  const localDir = path.dirname(DB_PATH)
  if (!fs.existsSync(localDir)) {
    fs.mkdirSync(localDir, { recursive: true })
  }
  
  if (shouldReset && fs.existsSync(DB_PATH)) {
    console.log("🗑️  Resetting existing database...")
    fs.unlinkSync(DB_PATH)
  }
  
  // Initialize database
  console.log("📦 Initializing local SQLite database...")
  const db = new Database(DB_PATH)
  db.exec("PRAGMA journal_mode = WAL")
  db.exec("PRAGMA foreign_keys = ON")
  
  // Read and execute schema files
  const drizzleDir = path.join(process.cwd(), "drizzle")
  
  if (fs.existsSync(drizzleDir)) {
    console.log("📋 Applying schema migrations...")
    
    // Get all SQL migration files and sort them
    const migrationFiles = fs.readdirSync(drizzleDir)
      .filter(f => f.endsWith(".sql") && !f.includes("seed"))
      .sort()
    
    for (const file of migrationFiles) {
      const filePath = path.join(drizzleDir, file)
      const sql = fs.readFileSync(filePath, "utf-8")
      
      console.log(`  Applying: ${file}`)
      
      // Split SQL into individual statements
      const statements = sql.split(";").filter(s => s.trim())
      
      for (const statement of statements) {
        try {
          db.exec(statement)
        } catch (error: any) {
          // Ignore "table already exists" errors
          if (!error.message?.includes("already exists")) {
            console.warn(`    Warning: ${error.message}`)
          }
        }
      }
    }
    
    console.log("✅ Schema migrations applied successfully")
    
    // Apply seed data
    const seedsDir = path.join(process.cwd(), "seeds")
    if (fs.existsSync(seedsDir)) {
      console.log("🌱 Applying seed data...")
      
      const seedFiles = fs.readdirSync(seedsDir)
        .filter(f => f.endsWith(".sql"))
        .sort()
      
      for (const file of seedFiles) {
        const filePath = path.join(seedsDir, file)
        const sql = fs.readFileSync(filePath, "utf-8")
        
        console.log(`  Seeding: ${file}`)
        
        try {
          db.exec(sql)
        } catch (error: any) {
          console.warn(`    Warning: ${error.message}`)
        }
      }
      
      console.log("✅ Seed data applied successfully")
    }
  }
  
  db.close()
  
  console.log("\n✨ Local database setup complete!")
  console.log("📍 Database location: .local/dev.db")
  console.log("\nYou can now run: bun dev")
  console.log("The app will use local SQLite instead of Cloudflare D1")
  
} catch (error) {
  console.error("❌ Failed to setup local database:", error)
  process.exit(1)
}