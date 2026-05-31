#!/usr/bin/env node
import Database from "better-sqlite3"

const DB_PATH = process.env.LOCAL_DB_PATH || "local.db"
const ORG_ID = "c608238b-7e19-4179-a658-f2849c549656"
const NOW = new Date().toISOString()

function idPart(value) {
  return value
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60)
}

function ensureTables(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS project_contacts (
      id text PRIMARY KEY NOT NULL,
      project_id text NOT NULL REFERENCES projects(id) ON DELETE cascade,
      contact_type text NOT NULL,
      source_system text DEFAULT 'compass' NOT NULL,
      source_record_id text,
      source_entity_type text DEFAULT 'manual' NOT NULL,
      source_entity_id text,
      display_name text NOT NULL,
      company_name text,
      role text,
      trade text,
      csi_division text,
      csi_division_name text,
      primary_cost_code text,
      email text,
      phone text,
      notes text,
      owner_portal_visible integer DEFAULT false NOT NULL,
      sub_vendor_portal_visible integer DEFAULT false NOT NULL,
      internal_visible integer DEFAULT true NOT NULL,
      primary_contact integer DEFAULT false NOT NULL,
      active integer DEFAULT true NOT NULL,
      sort_order integer DEFAULT 0 NOT NULL,
      sync_status text DEFAULT 'synced' NOT NULL,
      last_synced_at text,
      created_at text NOT NULL,
      updated_at text NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_project_contacts_project
      ON project_contacts(project_id);
    CREATE INDEX IF NOT EXISTS idx_project_contacts_type
      ON project_contacts(project_id, contact_type);
    CREATE INDEX IF NOT EXISTS idx_project_contacts_source
      ON project_contacts(source_system, source_record_id);
    CREATE INDEX IF NOT EXISTS idx_project_contacts_visibility
      ON project_contacts(
        project_id,
        owner_portal_visible,
        sub_vendor_portal_visible,
        internal_visible
      );
  `)

  const columns = db
    .prepare("PRAGMA table_info(project_contacts)")
    .all()
    .map((column) => column.name)

  const addColumn = (name, definition) => {
    if (!columns.includes(name)) {
      db.exec(`ALTER TABLE project_contacts ADD COLUMN ${name} ${definition}`)
    }
  }

  addColumn("csi_division", "text")
  addColumn("csi_division_name", "text")
  addColumn("primary_cost_code", "text")

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_project_contacts_csi
      ON project_contacts(project_id, csi_division);
  `)
}

function vendorCategory(type) {
  if (type === "supplier") return "Supplier"
  if (type === "subcontractor") return "Subcontractor"
  return "Project Contact"
}

function upsertVendor(db, contact) {
  if (!["supplier", "subcontractor"].includes(contact.contactType)) return null

  const vendorId = `vendor-${idPart(contact.companyName || contact.displayName)}`
  db.prepare(`
    INSERT INTO vendors (
      id, name, category, email, phone, address, netsuite_id,
      organization_id, created_at, updated_at
    ) VALUES (
      @id, @name, @category, @email, @phone, NULL, NULL,
      @organizationId, @createdAt, @updatedAt
    )
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      category = excluded.category,
      email = COALESCE(excluded.email, vendors.email),
      phone = COALESCE(excluded.phone, vendors.phone),
      organization_id = excluded.organization_id,
      updated_at = excluded.updated_at
  `).run({
    id: vendorId,
    name: contact.companyName || contact.displayName,
    category: vendorCategory(contact.contactType),
    email: contact.email ?? null,
    phone: contact.phone ?? null,
    organizationId: ORG_ID,
    createdAt: NOW,
    updatedAt: NOW,
  })

  return vendorId
}

function upsertCustomer(db, projectId, name) {
  const customerId = projectId === "proj-o-170-loomis" ? "cust-o-170" : "cust-o-202"
  db.prepare(`
    INSERT INTO customers (
      id, name, company, email, phone, address, notes, netsuite_id,
      organization_id, created_at, updated_at
    ) VALUES (
      @id, @name, NULL, NULL, NULL, NULL, NULL, NULL,
      @organizationId, @createdAt, @updatedAt
    )
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      organization_id = excluded.organization_id,
      updated_at = excluded.updated_at
  `).run({
    id: customerId,
    name,
    organizationId: ORG_ID,
    createdAt: NOW,
    updatedAt: NOW,
  })

  return customerId
}

function contact({
  projectId,
  contactType,
  displayName,
  companyName = null,
  role = null,
  trade = null,
  csiDivision = null,
  csiDivisionName = null,
  primaryCostCode = null,
  sourceSystem = "compass_seed",
  sourceRecordId = null,
  sourceEntityType = "manual",
  sourceEntityId = null,
  ownerPortalVisible = false,
  subVendorPortalVisible = false,
  internalVisible = true,
  primaryContact = false,
  notes = null,
  sortOrder,
}) {
  return {
    id: `project-contact-${idPart(projectId)}-${idPart(contactType)}-${idPart(displayName)}`,
    projectId,
    contactType,
    sourceSystem,
    sourceRecordId,
    sourceEntityType,
    sourceEntityId,
    displayName,
    companyName,
    role,
    trade,
    csiDivision,
    csiDivisionName,
    primaryCostCode,
    email: null,
    phone: null,
    notes,
    ownerPortalVisible,
    subVendorPortalVisible,
    internalVisible,
    primaryContact,
    active: true,
    sortOrder,
  }
}

const csiScopes = {
  "Alpen Windows": ["08", "Openings", "08 50 00"],
  "Alpine Construction Services": [
    "07",
    "Thermal and Moisture Protection",
    "07 21 00",
  ],
  "Best Drywall LLC": ["09", "Finishes", "09 20 00"],
  "Builder's FirstSource - Lumber": [
    "06",
    "Wood, Plastics, and Composites",
    "06 10 00",
  ],
  "Clearview Distributors": ["08", "Openings", "08 00 00"],
  "DMS Building Components Inc": [
    "06",
    "Wood, Plastics, and Composites",
    "06 17 00",
  ],
  EnergyLogic: ["01", "General Requirements", "01 45 00"],
  "Fox Excavation": ["31", "Earthwork", "31 00 00"],
  "GP Framing LLC": ["06", "Wood, Plastics, and Composites", "06 10 00"],
  "Groninger Concrete & Landscaping": ["03", "Concrete", "03 30 00"],
  "Kent Glass LLC": ["08", "Openings", "08 80 00"],
  "Method Electrical": ["26", "Electrical", "26 00 00"],
  "Midwest Garage Door COS LLC": ["08", "Openings", "08 36 00"],
  "Rawson Roofing": ["07", "Thermal and Moisture Protection", "07 30 00"],
  "RTB Properties LLC": ["01", "General Requirements", "01 50 00"],
  "Summit Concrete": ["03", "Concrete", "03 39 00"],
  "Ted's Plumbing & Hydronics": ["22", "Plumbing", "22 00 00"],
  "WeBuild Vocational Trade School": ["01", "General Requirements", "01 50 00"],
  "Western Fireplace Supply": ["10", "Specialties", "10 31 00"],
  "White Cap - Colorado Springs": ["03", "Concrete", "03 15 00"],
}

function csiFor(name) {
  const scope = csiScopes[name]
  if (!scope) return { csiDivision: null, csiDivisionName: null, primaryCostCode: null }

  return {
    csiDivision: scope[0],
    csiDivisionName: scope[1],
    primaryCostCode: scope[2],
  }
}

const sharedInternal = [
  {
    displayName: "High Performance Structures Inc.",
    companyName: "High Performance Structures Inc.",
    role: "Internal team",
  },
  {
    displayName: "Open Range Construction",
    companyName: "Open Range Construction",
    role: "Internal department",
  },
  {
    displayName: "Nu-Tech Systems",
    companyName: "Nu-Tech Systems",
    role: "Internal department - ICF sales and bracing rental",
  },
  {
    displayName: "Martine Vogel",
    companyName: "High Performance Structures",
    role: "Admin-owner",
    primaryContact: true,
  },
  {
    displayName: "Daniel Vogel",
    companyName: "High Performance Structures",
    role: "Project Manager / Field production",
  },
  {
    displayName: "Sarah Cowman",
    companyName: "High Performance Structures",
    role: "Senior Field Crew",
  },
  {
    displayName: "Stanley Platt",
    companyName: "High Performance Structures",
    role: "Field Superintendent",
  },
  {
    displayName: "Sylvi Vogel",
    companyName: "High Performance Structures",
    role: "Architectural Designer / Design & Print",
  },
  {
    displayName: "Cassandra Rodriguez-V",
    companyName: "High Performance Structures",
    role: "Project Administrator / Accounting Coordinator",
  },
  {
    displayName: "Wesley Jones",
    companyName: "High Performance Structures",
    role: "Assistant Project Manager",
  },
  {
    displayName: "Rebekah Jones",
    companyName: "High Performance Structures",
    role: "Office Manager / Business Development",
  },
  {
    displayName: "Isabel Araguz",
    companyName: "High Performance Structures",
    role: "Field Crew",
  },
]

const projectSeeds = [
  {
    projectId: "proj-o-170-loomis",
    ownerName: "Travis and Tanis Loomis",
    subcontractors: [
      ["Ted's Plumbing & Hydronics", "Plumbing"],
      ["Groninger Concrete & Landscaping", "Concrete / flatwork"],
      ["Method Electrical", "Electrical"],
      ["EnergyLogic", "Energy rating / inspections"],
    ],
    suppliers: [
      ["Builder's FirstSource - Lumber", "Lumber"],
      ["White Cap - Colorado Springs", "Concrete supplies"],
      ["WeBuild Vocational Trade School", "Site / trade support"],
    ],
  },
  {
    projectId: "proj-o-202-loeffler",
    ownerName: "Alan and Deborah Loeffler",
    subcontractors: [
      ["Fox Excavation", "Excavation / septic"],
      ["GP Framing LLC", "Framing"],
      ["Ted's Plumbing & Hydronics", "Plumbing"],
      ["Method Electrical", "Electrical"],
      ["Alpine Construction Services", "Insulation"],
      ["Rawson Roofing", "Roofing"],
      ["Kent Glass LLC", "Glass / glazing"],
      ["Best Drywall LLC", "Drywall"],
      ["Groninger Concrete & Landscaping", "Concrete / landscaping"],
      ["Summit Concrete", "Concrete pumping"],
      ["RTB Properties LLC", "Site support"],
    ],
    suppliers: [
      ["Builder's FirstSource - Lumber", "Lumber"],
      ["White Cap - Colorado Springs", "Concrete supplies"],
      ["DMS Building Components Inc", "Building components"],
      ["Clearview Distributors", "Estimating / supplier"],
      ["Western Fireplace Supply", "Fireplace"],
      ["Midwest Garage Door COS LLC", "Garage doors"],
      ["Alpen Windows", "Windows"],
    ],
  },
]

function buildProjectContacts(db, seed) {
  const customerId = upsertCustomer(db, seed.projectId, seed.ownerName)
  const contacts = [
    contact({
      projectId: seed.projectId,
      contactType: "owner",
      displayName: seed.ownerName,
      role: "Owner",
      sourceEntityType: "customer",
      sourceEntityId: customerId,
      ownerPortalVisible: true,
      primaryContact: true,
      sortOrder: 10,
    }),
  ]

  for (const [index, internal] of sharedInternal.entries()) {
    contacts.push(
      contact({
        projectId: seed.projectId,
        contactType: "internal",
        displayName: internal.displayName,
        companyName: internal.companyName,
        role: internal.role,
        sourceEntityType: "user_or_staff",
        ownerPortalVisible: internal.primaryContact === true,
        subVendorPortalVisible: true,
        primaryContact: internal.primaryContact === true,
        sortOrder: 100 + index,
      })
    )
  }

  for (const [index, [name, trade]] of seed.subcontractors.entries()) {
    const row = contact({
      projectId: seed.projectId,
      contactType: "subcontractor",
      displayName: name,
      companyName: name,
      role: "Subcontractor",
      trade,
      ...csiFor(name),
      sourceSystem: "buildertrend_sage_seed",
      sourceRecordId: `${seed.projectId}:sub:${idPart(name)}`,
      sourceEntityType: "vendor",
      subVendorPortalVisible: true,
      sortOrder: 200 + index,
    })
    contacts.push({ ...row, sourceEntityId: upsertVendor(db, row) })
  }

  for (const [index, [name, trade]] of seed.suppliers.entries()) {
    const row = contact({
      projectId: seed.projectId,
      contactType: "supplier",
      displayName: name,
      companyName: name,
      role: "Supplier",
      trade,
      ...csiFor(name),
      sourceSystem: "buildertrend_sage_seed",
      sourceRecordId: `${seed.projectId}:supplier:${idPart(name)}`,
      sourceEntityType: "vendor",
      subVendorPortalVisible: true,
      sortOrder: 400 + index,
    })
    contacts.push({ ...row, sourceEntityId: upsertVendor(db, row) })
  }

  return contacts
}

function insertContacts(db, projectId, contacts) {
  const project = db
    .prepare("SELECT id FROM projects WHERE id = ?")
    .get(projectId)
  if (!project) {
    throw new Error(`Project not found in local Compass DB: ${projectId}`)
  }

  db.prepare("DELETE FROM project_contacts WHERE project_id = ?").run(projectId)

  const insert = db.prepare(`
    INSERT INTO project_contacts (
      id, project_id, contact_type, source_system, source_record_id,
      source_entity_type, source_entity_id, display_name, company_name,
      role, trade, csi_division, csi_division_name, primary_cost_code,
      email, phone, notes, owner_portal_visible,
      sub_vendor_portal_visible, internal_visible, primary_contact,
      active, sort_order, sync_status, last_synced_at, created_at, updated_at
    ) VALUES (
      @id, @projectId, @contactType, @sourceSystem, @sourceRecordId,
      @sourceEntityType, @sourceEntityId, @displayName, @companyName,
      @role, @trade, @csiDivision, @csiDivisionName, @primaryCostCode,
      @email, @phone, @notes, @ownerPortalVisible,
      @subVendorPortalVisible, @internalVisible, @primaryContact,
      @active, @sortOrder, 'synced', @lastSyncedAt, @createdAt, @updatedAt
    )
  `)

  for (const row of contacts) {
    insert.run({
      ...row,
      ownerPortalVisible: row.ownerPortalVisible ? 1 : 0,
      subVendorPortalVisible: row.subVendorPortalVisible ? 1 : 0,
      internalVisible: row.internalVisible ? 1 : 0,
      primaryContact: row.primaryContact ? 1 : 0,
      active: row.active ? 1 : 0,
      lastSyncedAt: NOW,
      createdAt: NOW,
      updatedAt: NOW,
    })
  }

  return { projectId, contactCount: contacts.length }
}

const db = new Database(DB_PATH)
db.pragma("foreign_keys = ON")
ensureTables(db)

const run = db.transaction(() =>
  projectSeeds.map((seed) =>
    insertContacts(db, seed.projectId, buildProjectContacts(db, seed))
  )
)

const results = run()
console.log(JSON.stringify({ dbPath: DB_PATH, results }, null, 2))
