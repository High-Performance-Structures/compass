import { describe, expect, it } from "vitest"

import { resolveSessionRole, type SessionOrgMembership } from "../session-role"

const company: SessionOrgMembership = { orgId: "org-hps", orgName: "HPS", orgType: "internal", memberRole: "office" }
const otherCompany: SessionOrgMembership = { orgId: "org-demo", orgName: "Demo", orgType: "internal", memberRole: "admin" }
const clientOfCompany: SessionOrgMembership = { ...company, memberRole: "client" }
const vendorOrg: SessionOrgMembership = { orgId: "org-vendor", orgName: "Vendor Co", orgType: "external", memberRole: "admin" }

describe("resolveSessionRole", () => {
  it("gives staff their organization role, even with outside project memberships", () => {
    expect(
      resolveSessionRole({ orgMemberships: [company], preferredOrgId: null, projectRoles: ["owner"], accountRole: "guest" }),
    ).toEqual({ role: "office", activeOrg: company })
  })

  it("uses the cookie's organization when the person belongs to it, else the first", () => {
    const base = { orgMemberships: [company, otherCompany], projectRoles: [], accountRole: "guest" }
    expect(resolveSessionRole({ ...base, preferredOrgId: "org-demo" })).toEqual({ role: "admin", activeOrg: otherCompany })
    expect(resolveSessionRole({ ...base, preferredOrgId: "org-gone" })).toEqual({ role: "office", activeOrg: company })
    expect(resolveSessionRole({ ...base, preferredOrgId: null })).toEqual({ role: "office", activeOrg: company })
  })

  it("gives an invited owner the client role in the company that invited them", () => {
    expect(
      resolveSessionRole({
        orgMemberships: [vendorOrg, clientOfCompany],
        preferredOrgId: "org-vendor",
        projectRoles: ["owner"],
        accountRole: "guest",
      }),
    ).toEqual({ role: "client", activeOrg: clientOfCompany })
  })

  it("keeps vendor roles and falls back to the default organization", () => {
    expect(
      resolveSessionRole({ orgMemberships: [vendorOrg], preferredOrgId: null, projectRoles: ["subcontractor"], accountRole: "guest" }),
    ).toEqual({ role: "subcontractor", activeOrg: vendorOrg })
  })

  it("falls back to users.role with no memberships at all", () => {
    expect(resolveSessionRole({ orgMemberships: [], preferredOrgId: null, projectRoles: [], accountRole: "guest" })).toEqual({
      role: "guest",
      activeOrg: null,
    })
  })

  // Issue #1329: a vendor who hires the company for their own job is an owner
  // there but stays in their vendor role, whatever order the rows come in.
  it("lets vendor roles win over the owner role in any order", () => {
    const base = { orgMemberships: [vendorOrg], preferredOrgId: null, accountRole: "guest" }
    expect(resolveSessionRole({ ...base, projectRoles: ["owner", "subcontractor"] }).role).toBe("subcontractor")
    expect(resolveSessionRole({ ...base, projectRoles: ["subcontractor", "owner"] }).role).toBe("subcontractor")
    expect(resolveSessionRole({ ...base, projectRoles: ["client", "supplier"] }).role).toBe("supplier")
  })

  it("ranks owner over guest", () => {
    const base = { orgMemberships: [clientOfCompany], preferredOrgId: null, accountRole: "guest" }
    expect(resolveSessionRole({ ...base, projectRoles: ["guest", "owner"] }).role).toBe("client")
  })

  it("ranks subcontractor over supplier over guest", () => {
    const base = { orgMemberships: [vendorOrg], preferredOrgId: null, accountRole: "guest" }
    expect(resolveSessionRole({ ...base, projectRoles: ["guest", "supplier", "subcontractor"] }).role).toBe("subcontractor")
    expect(resolveSessionRole({ ...base, projectRoles: ["guest", "supplier"] }).role).toBe("supplier")
  })

  it("ignores project roles that are not outside roles", () => {
    expect(
      resolveSessionRole({ orgMemberships: [vendorOrg], preferredOrgId: null, projectRoles: ["office", "supplier"], accountRole: "guest" }).role,
    ).toBe("supplier")
  })
})
