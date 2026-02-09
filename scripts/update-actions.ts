#!/usr/bin/env bun
/**
 * Batch update action files to use universal database
 * 
 * This script updates all action files that import from @opennextjs/cloudflare
 * to use the local database adapter instead.
 */

import { readdirSync, readFileSync, writeFileSync, statSync } from "fs"
import { join } from "path"

const actionsDir = join(process.cwd(), "src", "app", "actions")

// Get all TypeScript files in the actions directory
const files = readdirSync(actionsDir)
  .filter(f => f.endsWith(".ts"))
  .map(f => join(actionsDir, f))

let updatedCount = 0
let skippedCount = 0

for (const filePath of files) {
  const content = readFileSync(filePath, "utf-8")
  
  // Check if file imports from @opennextjs/cloudflare
  if (!content.includes('from "@opennextjs/cloudflare"')) {
    skippedCount++
    continue
  }
  
  console.log(`Updating: ${filePath}`)
  
  // Replace imports
  let newContent = content
    .replace(/import \{ getCloudflareContext \} from "@opennextjs\/cloudflare"\n/g, "")
    .replace(/import \{ getDb \} from "@\/db"\n/g, 'import { getDb } from "@/lib/db-universal"\n')
  
  // Replace usage patterns
  // Pattern 1: const { env } = await getCloudflareContext()\n  const db = getDb(env.DB)
  newContent = newContent.replace(
    /const \{ env \} = await getCloudflareContext\(\)\s*\n\s*const db = getDb\(env\.DB\)/g,
    "const db = await getDb()"
  )
  
  // Pattern 2: const { env } = await getCloudflareContext()\n  if (!env?.DB) ...
  newContent = newContent.replace(
    /const \{ env \} = await getCloudflareContext\(\)\s*\n\s*if \(!env\?\.DB\) return \[\]/g,
    ""
  )
  
  // Pattern 3: Just remove getCloudflareContext calls
  newContent = newContent.replace(
    /const \{ env \} = await getCloudflareContext\(\)\s*\n/g,
    ""
  )
  
  // Pattern 4: Handle other env usages
  newContent = newContent.replace(
    /env\.DB/g,
    "db"
  )
  
  // Pattern 5: Handle env?.DB
  newContent = newContent.replace(
    /env\?\.DB/g,
    "db"
  )
  
  // Clean up empty lines
  newContent = newContent.replace(/\n{3,}/g, "\n\n")
  
  writeFileSync(filePath, newContent)
  updatedCount++
}

console.log(`\n✅ Updated ${updatedCount} files`)
console.log(`⏭️  Skipped ${skippedCount} files (no Cloudflare imports)`)
console.log("\nNext steps:")
console.log("1. Review the changes: git diff")
console.log("2. Clear cache: rm -rf .next")
console.log("3. Start dev server: BYPASS_AUTH=true bun dev")