import {
  customerContacts,
  customers,
  internalContacts,
  users,
  vendorContacts,
  vendors,
} from "@/db/schema"

// Drizzle uses the first selected column to detect an absent nullable join.
// The ID must precede optional email, phone, and account-link fields.
export const projectContactInvitationDirectorySelection = {
  customer: {
    id: customers.id,
    email: customers.email,
    phone: customers.phone,
    address: customers.address,
  },
  customerContact: {
    id: customerContacts.id,
    userId: customerContacts.userId,
    email: customerContacts.email,
    phone: customerContacts.phone,
  },
  vendor: {
    id: vendors.id,
    email: vendors.email,
    phone: vendors.phone,
    address: vendors.address,
  },
  vendorContact: {
    id: vendorContacts.id,
    userId: vendorContacts.userId,
    email: vendorContacts.email,
    phone: vendorContacts.phone,
  },
  teamMember: {
    id: users.id,
    email: users.email,
    phone: users.phone,
  },
  internalPerson: {
    id: internalContacts.id,
    userId: internalContacts.userId,
    email: internalContacts.email,
    phone: internalContacts.phone,
  },
}
