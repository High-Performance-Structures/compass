import { redirect } from "next/navigation"

export default function CustomersRedirect(): never {
  redirect("/dashboard/contacts?tab=customers")
}
