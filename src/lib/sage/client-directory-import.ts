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

  return `-- Generated Sage client directory import (${stable.clients.length} stable records).
-- Exact one-to-one names are linked. Ambiguous names are inserted separately for review.
WITH sage_clients(client_number, name) AS (
  VALUES
    ${values}
),
possible_matches AS (
  SELECT sc.client_number, c.id AS customer_id
  FROM sage_clients sc
  INNER JOIN customers c
    ON c.organization_id = ${organization}
   AND lower(trim(c.name)) = lower(trim(sc.name))
   AND (
     c.sage_client_number IS NULL
     OR trim(c.sage_client_number) = ''
     OR trim(c.sage_client_number) = sc.client_number
   )
),
source_unique_matches AS (
  SELECT client_number, MIN(customer_id) AS customer_id
  FROM possible_matches
  GROUP BY client_number
  HAVING COUNT(DISTINCT customer_id) = 1
),
one_to_one_matches AS (
  SELECT MIN(client_number) AS client_number, customer_id
  FROM source_unique_matches
  GROUP BY customer_id
  HAVING COUNT(DISTINCT client_number) = 1
)
UPDATE customers
SET
  sage_client_number = (
    SELECT match.client_number
    FROM one_to_one_matches match
    WHERE match.customer_id = customers.id
  ),
  relationship_type = 'client',
  updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE id IN (SELECT customer_id FROM one_to_one_matches);

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
  'Imported from the Sage client directory. Portal access is not granted by this import.',
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
