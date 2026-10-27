// Browser proof with the real contact cards, invite dialog, and toast UI.
// Server actions are isolated: this script never grants access or sends email.
import { build } from "esbuild"
import postcss from "postcss"
import tailwind from "@tailwindcss/postcss"
import { chromium } from "playwright"
import assert from "node:assert/strict"
import { createServer } from "node:http"
import { mkdtemp, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

const root = process.cwd()
const output = await mkdtemp(path.join(tmpdir(), "compass-invitation-recovery-"))
const file = (name) => path.join(output, name)
await writeFile(file("actions.ts"), `
export async function sendProjectAccessInvitation(input) {
  window.lastInvitationInput = input;
  window.emailState = 'retrying';
  return {success:true,accessStatus:'invited',warning:"Project access is prepared. The welcome email is queued and will retry automatically after the email provider's cooldown. You do not need to resend the invitation."};
}`)
await writeFile(file("navigation.ts"), `export function useRouter(){return {refresh(){window.renderContacts()},push(){}}}`)
await writeFile(file("link.tsx"), `import React from 'react';export default function Link(p){return <a {...p}/>}`)
await writeFile(file("editor.tsx"), `export function ProjectContactEditor(){return null};export function ProjectContactInviteLauncher(){return null}`)
await writeFile(file("entry.tsx"), `
import React from 'react';import {createRoot} from 'react-dom/client';import {Toaster} from 'sonner';
import {ProjectContactsDirectory} from '@/components/projects/project-contacts-panel';
const app=createRoot(document.getElementById('root'));
window.emailState=new URLSearchParams(location.search).get('state')??'failed';
window.renderContacts=()=>{
  const contact={id:'contact',contactType:'owner',sourceSystem:'manual',sourceRecordId:null,sourceEntityType:'customer_contact',sourceEntityId:'person',customerId:'customer',customerContactId:'person',vendorId:null,vendorContactId:null,internalContactId:null,displayName:'Alex Morgan',companyName:null,role:null,trade:null,csiDivision:null,csiDivisionName:null,primaryCostCode:null,email:'alex@example.test',phone:null,address:null,notes:null,ownerPortalVisible:true,subVendorPortalVisible:false,internalVisible:true,primaryContact:true,active:true,syncStatus:'manual',lastSyncedAt:null,accessStatus:new URLSearchParams(location.search).get('access')??'pending',compassAccountStatus:new URLSearchParams(location.search).get('access')==='active'?'active':'not_registered',identityManagedByActiveUser:false,welcomeEmail:{status:window.emailState,nextAttemptAt:null}};
  const summary={audience:'internal',allContacts:[contact],historicalContacts:[],csiGroups:[]};
  app.render(<><ProjectContactsDirectory projectId="project" projectLabel="Cedar Ridge Residence" summary={summary}/><Toaster/></>);
};window.renderContacts();`)
await build({ entryPoints: [file("entry.tsx")], outfile: file("app.js"), bundle: true, platform: "browser", format: "iife", jsx: "automatic",
  tsconfig: path.join(root, "tsconfig.json"), nodePaths: [path.join(root, "node_modules")], define: { "process.env.NODE_ENV": '"development"' },
  plugins: [{ name: "isolated-boundaries", setup(b) {
    b.onResolve({ filter: /^@\/app\/actions\/project-access-invitations$/ }, () => ({ path: file("actions.ts") }))
    b.onResolve({ filter: /^@\/components\/projects\/(project-contact-management|project-contact-invite-launcher)$/ }, () => ({ path: file("editor.tsx") }))
    b.onResolve({ filter: /^next\/navigation$/ }, () => ({ path: file("navigation.ts") }))
    b.onResolve({ filter: /^next\/link$/ }, () => ({ path: file("link.tsx") }))
  }}],
})
const css = await postcss([tailwind({ base: root })]).process('@import "./src/app/globals.css";', { from: path.join(root, "fixture.css") })
await writeFile(file("app.css"), css.css)
const server = createServer(async (req,res) => {
  const name = req.url === "/app.js" ? "app.js" : req.url === "/app.css" ? "app.css" : null
  res.setHeader("content-type", name?.endsWith("js") ? "text/javascript" : name ? "text/css" : "text/html")
  res.end(name ? await readFile(file(name)) : '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"></head><body style="padding:24px"><div id="root"></div><script src="/app.js"></script></body></html>')
})
await new Promise((resolve) => server.listen(0,"127.0.0.1",resolve))
const address = server.address()
if (!address || typeof address === "string") throw Error("Fixture server unavailable")
const browser = await chromium.launch({headless:true})
try {
  const page = await browser.newPage({ viewport:{width:1100,height:780} })
  const errors=[];page.on("pageerror", e=>{errors.push(e.message);console.error("Browser error:",e.message)})
  const url=`http://127.0.0.1:${address.port}`
  await page.goto(url)
  await page.getByText("Welcome email failed.",{exact:false}).waitFor()
  await page.getByRole("button",{name:"Resend invitation",exact:true}).click()
  await page.getByLabel("Email subject").fill("Your Compass project welcome")
  await page.getByRole("button",{name:"Resend Invitation and Welcome",exact:true}).click()
  await page.getByText("Welcome email queued. Compass will retry automatically.",{exact:true}).waitFor()
  await page.getByText("Project access is prepared. The welcome email is queued",{exact:false}).waitFor()
  await page.getByRole("button",{name:"Resend invitation",exact:true}).waitFor({state:"visible"})
  assert.equal(await page.evaluate(()=>window.lastInvitationInput.subject),"Your Compass project welcome")
  assert.equal(await page.getByText("Compass invitation and welcome email resent",{exact:true}).count(),0)
  await page.screenshot({path:file("queued-desktop.png"),fullPage:true})
  for (const [state, phrase] of [["unknown","Welcome email delivery unconfirmed."],["cancelled","Welcome email cancelled."],["sent","Awaiting acceptance"]]) {
    await page.goto(`${url}?state=${state}`)
    await page.getByText(phrase,{exact:false}).waitFor()
  }
  await page.goto(`${url}?state=failed&access=active`)
  await page.getByRole("button",{name:"Resend welcome email",exact:true}).click()
  await page.getByRole("button",{name:"Resend Welcome",exact:true}).click()
  await page.getByText("Welcome email queued. Compass will retry automatically.",{exact:true}).waitFor()
  assert.equal(await page.evaluate(()=>window.lastInvitationInput.intent),"resend_welcome")
  await page.setViewportSize({width:390,height:844})
  await page.goto(`${url}?state=failed`)
  await page.getByText("Welcome email failed.",{exact:false}).waitFor()
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth),false)
  await page.screenshot({path:file("failed-mobile.png"),fullPage:true})
  assert.deepEqual(errors,[])
  console.log(JSON.stringify({success:true,proofs:["queued warning, saved recipient/subject, and no false sent toast","queued status keeps staff correction available","failed, unknown, cancelled, and sent states","active-account welcome-only recovery","mobile layout without horizontal overflow"],output}))
} finally {
  await browser.close()
  await new Promise((resolve)=>server.close(resolve))
}
