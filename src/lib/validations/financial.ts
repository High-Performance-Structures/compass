import { z } from "zod"
import { uuidSchema, nonEmptyString, dateStringSchema, currencySchema } from "./common"

// --- Customer ---

export const createCustomerSchema = z.object({
  name: nonEmptyString.max(200, "Customer name must be 200 characters or less"),
  email: z.string().email("Please enter a valid email address").optional(),
  phone: z.string().max(50, "Phone number must be 50 characters or less").optional(),
  address: z.string().max(500, "Address must be 500 characters or less").optional(),
  netsuiteId: z.string().optional(),
})

export type CreateCustomerInput = z.infer<typeof createCustomerSchema>

export const updateCustomerSchema = z.object({
  id: uuidSchema,
  name: nonEmptyString.max(200, "Customer name must be 200 characters or less").optional(),
  email: z.string().email("Please enter a valid email address").optional(),
  phone: z.string().max(50, "Phone number must be 50 characters or less").optional(),
  address: z.string().max(500, "Address must be 500 characters or less").optional(),
})

export type UpdateCustomerInput = z.infer<typeof updateCustomerSchema>

export const deleteCustomerSchema = z.object({
  id: uuidSchema,
})

export type DeleteCustomerInput = z.infer<typeof deleteCustomerSchema>

// --- Vendor ---

export const createVendorSchema = z.object({
  name: nonEmptyString.max(200, "Vendor name must be 200 characters or less"),
  email: z.string().email("Please enter a valid email address").optional(),
  phone: z.string().max(50, "Phone number must be 50 characters or less").optional(),
  address: z.string().max(500, "Address must be 500 characters or less").optional(),
  netsuiteId: z.string().optional(),
})

export type CreateVendorInput = z.infer<typeof createVendorSchema>

export const updateVendorSchema = z.object({
  id: uuidSchema,
  name: nonEmptyString.max(200, "Vendor name must be 200 characters or less").optional(),
  email: z.string().email("Please enter a valid email address").optional(),
  phone: z.string().max(50, "Phone number must be 50 characters or less").optional(),
  address: z.string().max(500, "Address must be 500 characters or less").optional(),
})

export type UpdateVendorInput = z.infer<typeof updateVendorSchema>

export const deleteVendorSchema = z.object({
  id: uuidSchema,
})

export type DeleteVendorInput = z.infer<typeof deleteVendorSchema>

// --- Invoice ---

export const createInvoiceSchema = z.object({
  customerId: uuidSchema,
  projectId: uuidSchema.optional(),
  invoiceNumber: nonEmptyString.max(50, "Invoice number must be 50 characters or less"),
  amount: currencySchema,
  dueDate: dateStringSchema,
  description: z.string().max(1000, "Description must be 1000 characters or less").optional(),
})

export type CreateInvoiceInput = z.infer<typeof createInvoiceSchema>

export const updateInvoiceSchema = z.object({
  id: uuidSchema,
  amount: currencySchema.optional(),
  dueDate: dateStringSchema.optional(),
  description: z.string().max(1000, "Description must be 1000 characters or less").optional(),
  status: z.enum(["draft", "sent", "paid", "overdue", "cancelled"]).optional(),
})

export type UpdateInvoiceInput = z.infer<typeof updateInvoiceSchema>

export const deleteInvoiceSchema = z.object({
  id: uuidSchema,
})

export type DeleteInvoiceInput = z.infer<typeof deleteInvoiceSchema>

// --- Vendor Bill ---

export const createVendorBillSchema = z.object({
  vendorId: uuidSchema,
  projectId: uuidSchema.optional(),
  billNumber: nonEmptyString.max(50, "Bill number must be 50 characters or less"),
  amount: currencySchema,
  dueDate: dateStringSchema,
  description: z.string().max(1000, "Description must be 1000 characters or less").optional(),
})

export type CreateVendorBillInput = z.infer<typeof createVendorBillSchema>

export const updateVendorBillSchema = z.object({
  id: uuidSchema,
  amount: currencySchema.optional(),
  dueDate: dateStringSchema.optional(),
  description: z.string().max(1000, "Description must be 1000 characters or less").optional(),
  status: z.enum(["pending", "approved", "paid", "cancelled"]).optional(),
})

export type UpdateVendorBillInput = z.infer<typeof updateVendorBillSchema>

export const deleteVendorBillSchema = z.object({
  id: uuidSchema,
})

export type DeleteVendorBillInput = z.infer<typeof deleteVendorBillSchema>

// --- Payment ---

export const createPaymentSchema = z.object({
  vendorBillId: uuidSchema.optional(),
  invoiceId: uuidSchema.optional(),
  amount: currencySchema,
  paymentDate: dateStringSchema,
  paymentMethod: z.enum(["check", "ach", "wire", "credit_card", "cash", "other"]).optional(),
  referenceNumber: z.string().max(100, "Reference number must be 100 characters or less").optional(),
})

export type CreatePaymentInput = z.infer<typeof createPaymentSchema>

export const updatePaymentSchema = z.object({
  id: uuidSchema,
  amount: currencySchema.optional(),
  paymentDate: dateStringSchema.optional(),
  paymentMethod: z.enum(["check", "ach", "wire", "credit_card", "cash", "other"]).optional(),
  referenceNumber: z.string().max(100, "Reference number must be 100 characters or less").optional(),
})

export type UpdatePaymentInput = z.infer<typeof updatePaymentSchema>

export const deletePaymentSchema = z.object({
  id: uuidSchema,
})

export type DeletePaymentInput = z.infer<typeof deletePaymentSchema>

// --- Credit Memo ---

export const createCreditMemoSchema = z.object({
  customerId: uuidSchema,
  invoiceId: uuidSchema.optional(),
  amount: currencySchema,
  reason: z.string().max(500, "Reason must be 500 characters or less").optional(),
})

export type CreateCreditMemoInput = z.infer<typeof createCreditMemoSchema>

export const updateCreditMemoSchema = z.object({
  id: uuidSchema,
  amount: currencySchema.optional(),
  reason: z.string().max(500, "Reason must be 500 characters or less").optional(),
  status: z.enum(["pending", "applied", "cancelled"]).optional(),
})

export type UpdateCreditMemoInput = z.infer<typeof updateCreditMemoSchema>

export const deleteCreditMemoSchema = z.object({
  id: uuidSchema,
})

export type DeleteCreditMemoInput = z.infer<typeof deleteCreditMemoSchema>
