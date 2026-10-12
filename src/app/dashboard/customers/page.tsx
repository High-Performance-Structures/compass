import { ClientRedirect } from "@/components/client-redirect"

export default function CustomersRedirect(): React.ReactElement {
  return <ClientRedirect href={"/dashboard/contacts?tab=customers"} />
}
