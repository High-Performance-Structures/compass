// netsuite API response types

export interface NetSuiteListResponse<T = NetSuiteRecord> {
  links: NetSuiteLink[]
  count: number
  hasMore: boolean
  totalResults?: number
  items: T[]
  offset: number
}

export interface NetSuiteLink {
  rel: string
  href: string
}

export interface NetSuiteRecord {
  id: string
  links?: NetSuiteLink[]
  [key: string]: unknown
}

// core record types we care about

export interface NetSuiteCustomer extends NetSuiteRecord {
  companyName: string
  email?: string
  phone?: string
  entityId: string
  isInactive: boolean
  dateCreated: string
  lastModifiedDate: string
  subsidiary?: { id: string; refName: string }
  defaultAddress?: string
  terms?: { id: string; refName: string }
}

export interface NetSuiteVendor extends NetSuiteRecord {
  companyName: string
  email?: string
  phone?: string
  entityId: string
  isInactive: boolean
  category?: { id: string; refName: string }
  dateCreated: string
  lastModifiedDate: string
  defaultAddress?: string
}

export interface NetSuiteJob extends NetSuiteRecord {
  entityId: string
  companyName: string
  parent?: { id: string; refName: string }
  jobStatus?: { id: string; refName: string }
  startDate?: string
  projectedEndDate?: string
  dateCreated: string
  lastModifiedDate: string
}

export interface NetSuiteInvoice extends NetSuiteRecord {
  tranId: string
  entity: { id: string; refName: string }
  tranDate: string
  dueDate?: string
  status: { id: string; refName: string }
  total: number
  amountRemaining: number
  memo?: string
  job?: { id: string; refName: string }
  lastModifiedDate: string
  item?: { items: NetSuiteLineItem[] }
}

export interface NetSuiteVendorBill extends NetSuiteRecord {
  tranId: string
  entity: { id: string; refName: string }
  tranDate: string
  dueDate?: string
  status: { id: string; refName: string }
  total: number
  amountRemaining: number
  memo?: string
  job?: { id: string; refName: string }
  lastModifiedDate: string
  item?: { items: NetSuiteLineItem[] }
}

export interface NetSuiteLineItem {
  line: number
  item: { id: string; refName: string }
  quantity: number
  rate: number
  amount: number
  description?: string
}

export interface NetSuitePayment extends NetSuiteRecord {
  tranId: string
  entity: { id: string; refName: string }
  tranDate: string
  total: number
  paymentMethod?: { id: string; refName: string }
  memo?: string
  lastModifiedDate: string
}

// suiteql response shape
export interface SuiteQLResponse {
  links: NetSuiteLink[]
  count: number
  hasMore: boolean
  totalResults?: number
  items: Record<string, unknown>[]
  offset: number
}

// request options
export interface NetSuiteRequestOptions {
  fields?: string[]
  query?: string
  limit?: number
  offset?: number
  expandSubResources?: boolean
}

export type SyncDirection = "pull" | "push"
export type SyncStatus =
  | "synced"
  | "pending_push"
  | "conflict"
  | "error"

export type ConflictStrategy =
  | "newest_wins"
  | "remote_wins"
  | "local_wins"
  | "manual"
