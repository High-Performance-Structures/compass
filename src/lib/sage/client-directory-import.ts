export type SageClientDirectoryRecord = {
  readonly clientNumber: string
  readonly name: string
}

export type StableSageClientDirectory = {
  readonly clients: readonly SageClientDirectoryRecord[]
  readonly conflictingClientNumbers: readonly string[]
}

function cleanText(value: string): string {
  return value.trim()
}

function sqlLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`
}

export function stableSageClientDirectory(
  records: readonly SageClientDirectoryRecord[]
): StableSageClientDirectory {
  const namesByNumber = new Map<string, Map<string, string>>()
  for (const record of records) {
    const clientNumber = cleanText(record.clientNumber)
    const name = cleanText(record.name)
    if (!clientNumber || !name) continue
    const normalizedName = name.toLocaleLowerCase("en-US")
    const names = namesByNumber.get(clientNumber) ?? new Map<string, string>()
    names.set(normalizedName, name)
    namesByNumber.set(clientNumber, names)
  }

  const clients: SageClientDirectoryRecord[] = []
  const conflictingClientNumbers: string[] = []
  for (const [clientNumber, names] of namesByNumber) {
    if (names.size !== 1) {
      conflictingClientNumbers.push(clientNumber)
      continue
    }
    const name = names.values().next().value
    if (!name) continue
    clients.push({ clientNumber, name })
  }

  return {
    clients: clients.sort((left, right) =>
      left.name.localeCompare(right.name, "en-US")
    ),
    conflictingClientNumbers: conflictingClientNumbers.sort(),
  }
}

function sageClientValues(
  clients: readonly SageClientDirectoryRecord[]
): string {
  return clients
    .map(
      (client) =>
        `(${sqlLiteral(client.clientNumber)}, ${sqlLiteral(client.name)})`
    )
    .join(",\n    ")
}

export function buildSageClientDirectoryImportSql(input: {
  readonly organizationId: string
  readonly records: readonly SageClientDirectoryRecord[]
}): string {
  const organizationId = cleanText(input.organizationId)
  if (!organizationId) throw new Error("Organization ID is required.")

  const stable = stableSageClientDirectory(input.records)
  if (stable.clients.length === 0) {
    throw new Error("The Sage export did not contain any stable client records.")
  }
  const values = sageClientValues(stable.clients)
  const organization = sqlLiteral(organizationId)

  return `-- Generated Sage client directory candidates (${stable.clients.length} stable records).
-- A name is never sufficient evidence to link an existing Compass customer.
-- Number-only candidates are not verified Sage links and require reviewed reconciliation.
WITH sage_clients(client_number, name) AS (
  VALUES
    ${values}
)
INSERT OR IGNORE INTO customers (
  id, name, company, email, phone, address, notes, netsuite_id,
  sage_client_id, sage_client_number, sage_client_status_id,
  buildertrend_contact_id, relationship_type,
  organization_id, created_at, updated_at
)
SELECT
  'sage-customer-' || ${organization} || '-' || sc.client_number,
  sc.name,
  NULL,
  NULL,
  NULL,
  NULL,
  'Unverified Sage-number candidate. Reconcile the exact Sage ID and Compass customer before use; this import grants no portal access.',
  NULL,
  NULL,
  sc.client_number,
  NULL,
  NULL,
  'client',
  ${organization},
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM sage_clients sc
WHERE NOT EXISTS (
  SELECT 1
  FROM customers c
  WHERE c.organization_id = ${organization}
    AND c.sage_client_number = sc.client_number
);
`
}
