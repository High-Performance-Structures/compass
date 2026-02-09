#!/usr/bin/env bun
/**
 * Complete Cloudflare Bypass Setup
 * 
 * Updates all remaining files that import from @opennextjs/cloudflare
 */

import { readFileSync, writeFileSync } from "fs"

const filesToUpdate = [
  "src/app/dashboard/projects/[id]/schedule/page.tsx",
  "src/app/dashboard/projects/[id]/page.tsx",
  "src/app/dashboard/projects/page.tsx",
  "src/app/api/google/download/[fileId]/route.ts",
  "src/app/api/agent/route.ts",
  "src/app/api/feedback/route.ts",
  "src/app/api/push/register/route.ts",
  "src/app/api/netsuite/callback/route.ts",
  "src/app/api/transcribe/route.ts",
  "src/lib/agent/tools.ts",
  "src/lib/agent/github-tools.ts",
  "src/lib/agent/provider.ts",
  "src/lib/github/client.ts",
  "src/lib/auth.ts",
]

for (const filePath of filesToUpdate) {
  try {
    const content = readFileSync(filePath, "utf-8")
    
    if (!content.includes('@opennextjs/cloudflare')) {
      continue
    }
    
    console.log(`Updating: ${filePath}`)
    
    let newContent = content
      .replace(/import \{ getCloudflareContext \} from "@opennextjs\/cloudflare"\n/g, "")
      .replace(/import \{ getDb \} from "@\/db"\n/g, 'import { getDb } from "@/lib/db-universal"\n')
    
    // Handle various patterns
    newContent = newContent.replace(
      /const \{ env \} = await getCloudflareContext\(\)\s*\n\s*const db = getDb\(env\.DB\)/g,
      "const db = await getDb()"
    )
    
    newContent = newContent.replace(
      /const \{ env, ctx \} = await getCloudflareContext\(\)/g,
      "const { env, ctx } = { env: { DB: null }, ctx: { waitUntil: () => {}, passThroughOnException: () => {} } }"
    )
    
    newContent = newContent.replace(
      /const \{ env, cf \} = await getCloudflareContext\(\)/g,
      "const { env, cf } = { env: { DB: null }, cf: {} }"
    )
    
    newContent = newContent.replace(
      /const \{ env } = await getCloudflareContext\(\)/g,
      "const { env } = { env: { DB: null } }"
    )
    
    // Handle env?.DB checks
    newContent = newContent.replace(
      /if \(!env\?\.DB\)/g,
      "if (!db)"
    )
    
    newContent = newContent.replace(/env\.DB/g, "db")
    newContent = newContent.replace(/env\?\.DB/g, "db")
    
    writeFileSync(filePath, newContent)
  } catch (error) {
    console.error(`Error updating ${filePath}:`, error)
  }
}

console.log("\n✅ All files updated")
console.log("Clear cache and restart: rm -rf .next && BYPASS_AUTH=true bun dev")