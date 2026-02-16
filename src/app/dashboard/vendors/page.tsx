import { redirect } from "next/navigation"

export default function VendorsRedirect(): never {
  redirect("/dashboard/contacts?tab=vendors")
}
