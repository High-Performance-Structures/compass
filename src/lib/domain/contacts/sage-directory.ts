/*
 * Where each Sage-linked directory kind lives in Compass. store.ts builds its
 * Sage bridge writes from this map; people are scoped through their parent
 * company.
 */

export type SageDirectoryKind = "client_company" | "vendor_company" | "client_person" | "vendor_person" | "employee"
export const SAGE_DIRECTORY: Readonly<Record<SageDirectoryKind, {
  readonly table: string; readonly sageId: string; readonly number: string; readonly synced: boolean; readonly parent?: string
}>> = {
  client_company: { table: "customers", sageId: "sage_client_id", number: "sage_client_number", synced: false },
  vendor_company: { table: "vendors", sageId: "sage_vendor_id", number: "sage_vendor_number", synced: true },
  employee: { table: "internal_contacts", sageId: "sage_employee_id", number: "sage_employee_number", synced: true },
  client_person: { table: "customer_contacts", sageId: "sage_contact_id", number: "sage_line_number", synced: true,
    parent: "customer_id IN (SELECT id FROM customers WHERE organization_id = ? AND sage_client_id = ?)" },
  vendor_person: { table: "vendor_contacts", sageId: "sage_contact_id", number: "sage_line_number", synced: false,
    parent: "vendor_id IN (SELECT id FROM vendors WHERE organization_id = ? AND sage_vendor_id = ?)" },
}
