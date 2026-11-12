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

  // Pins today's behaviour (issue #1329): only the first project row counts,
  // so the order the database returns decides between owner and vendor.
  it("takes the first project role when a person has several", () => {
    const base = { orgMemberships: [clientOfCompany], preferredOrgId: null, accountRole: "guest" }
    expect(resolveSessionRole({ ...base, projectRoles: ["owner", "subcontractor"] }).role).toBe("client")
    expect(resolveSessionRole({ ...base, projectRoles: ["subcontractor", "owner"] }).role).toBe("subcontractor")
  })
})
