// Render real preview components against isolated read-only action boundaries.
import { build } from "esbuild"
import postcss from "postcss"
import tailwind from "@tailwindcss/postcss"
import { chromium } from "playwright"
import { createServer } from "node:http"
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import assert from "node:assert/strict"

const root = process.cwd()
const output = await mkdtemp(path.join(tmpdir(), "compass-person-preview-"))
const mocks = {
  "next/link": `import React from 'react';export default function Link({href,children,...props}){return React.createElement('a',{...props,href,onClick(e){e.preventDefault();history.pushState(null,'',href)}},children)}`,

  "next/navigation": `export function usePathname(){return location.pathname} export function useSearchParams(){return new URLSearchParams(location.search)}`,
  "@/app/actions/project-correspondence": `
    export async function getCorrespondenceDetail(projectId,id){
      const viewer = new URLSearchParams(location.search).get('previewAs') || 'owner-a';
      if(id!=='conversation-'+viewer) return {success:false,error:'Conversation not found.'};
      return {success:true,data:{conversation:{id,subject:viewer+' project email'},participantVersion:1,hasEarlier:false,draft:null,messages:[{id:'message-'+viewer,sequence:1,source:'email',authorName:'Project staff',authorUserId:'staff-a',sentAt:'2026-10-24T12:00:00Z',body:'Authorized message for '+viewer,recipients:[{name:viewer,kind:'to'}],emailBcc:[],emailDeliveryStatus:'sent',attachments:[{id:'file-'+viewer,name:'Approved plan.pdf',size:100,contentType:'application/pdf',available:true}],editedAt:null,retractedAt:null,delivery:'saved',canEdit:false,readReceipts:[]}]}};
    }
    export async function searchCorrespondence(projectId,query){const viewer=new URLSearchParams(location.search).get('previewAs')||'owner-a';return {success:true,data:{hits:query.includes('absent')?[]:[{conversationId:'conversation-'+viewer}],hasMore:false}}}
  `,
}
const aliases = {}
for (const [name, source] of Object.entries(mocks)) {
  const file = path.join(output, `mock-${Object.keys(aliases).length}.mjs`)
  await writeFile(file, source)
  aliases[name] = file
}
await build({entryPoints:[path.join(root,"__tests__/fixtures/project-audience-person-preview.tsx")],outfile:path.join(output,"app.js"),bundle:true,nodePaths:[path.join(root,"node_modules")],platform:"browser",format:"esm",jsx:"automatic",alias:aliases,define:{"process.env.NODE_ENV":'"production"'}})
const css = await postcss([tailwind()]).process(await readFile(path.join(root,"src/app/globals.css"),"utf8"),{from:path.join(root,"src/app/globals.css")})
await writeFile(path.join(output,"app.css"),css.css)
const server = createServer(async (req,res) => {
  if(req.url?.startsWith('/app.js')){res.setHeader('content-type','application/javascript');res.end(await readFile(path.join(output,'app.js')));return}
  if(req.url?.startsWith('/app.css')){res.setHeader('content-type','text/css');res.end(await readFile(path.join(output,'app.css')));return}
  res.setHeader('content-type','text/html');res.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>')
})
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
const address=server.address();if(!address||typeof address==='string')throw new Error('Missing address')
const origin=`http://127.0.0.1:${address.port}`
const browser = await chromium.launch({headless:true})
try {
  const page = await browser.newPage({viewport:{width:1280,height:900}})
  const errors=[];page.on('pageerror',error=>errors.push(error.message))
  await page.goto(`${origin}/preview/projects/legacy-a/owner?previewAs=owner-a`)
  await page.getByRole('button',{name:/owner-a project email/}).click()
  await page.getByText('Authorized message for owner-a',{exact:true}).waitFor()
  assert.equal(await page.getByRole('button',{name:/Send|Edit|Retract|Retry failed/}).count(),0)
  const download=page.getByRole('link',{name:'Download Approved plan.pdf'})
  const href=await download.getAttribute('href');assert.ok(href?.includes('previewAs=owner-a'));assert.ok(href?.includes('previewProject=project-a'))
  await page.getByRole('combobox',{name:'Preview as person'}).click()
  await page.getByPlaceholder('Search people or companies').fill('Second client')
  await page.getByRole('option',{name:/Owner B/}).click()
  await page.waitForURL(/previewAs=owner-b/)
  assert.equal(await page.getByText('Authorized message for owner-a',{exact:true}).count(),0)
  await page.getByRole('button',{name:/owner-b project email/}).click()
  await page.getByText('Authorized message for owner-b',{exact:true}).waitFor()
  await page.getByRole('link',{name:'Schedule',exact:true}).click()
  await page.waitForURL(/owner\/schedule\?previewAs=owner-b/)
  for(const width of [1280,390]){
    await page.setViewportSize({width,height:900})
    await page.getByRole('button',{name:/owner-b project email/}).click()
    await page.getByText('Authorized message for owner-b',{exact:true}).waitFor()
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth),false,`horizontal overflow at ${width}`)
    if(process.env.PREVIEW_SCREENSHOTS)await page.screenshot({path:path.join(process.env.PREVIEW_SCREENSHOTS,`person-preview-${width}.png`),fullPage:true})
  }
  await page.getByRole('textbox',{name:"Search this person's messages"}).fill('absent')
  await page.getByText('No messages visible to this person.').waitFor()
  assert.deepEqual(errors,[])
  console.log('Person preview browser checks passed: selection, stale-content clearing, scoped navigation/download, read-only messages, search, desktop/mobile layout.')
} finally {await browser.close();await new Promise(resolve=>server.close(resolve));await rm(output,{recursive:true,force:true})}
