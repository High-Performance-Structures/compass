import { ClientRedirect } from "@/components/client-redirect"

export default function VendorsRedirect(): React.ReactElement {
  return <ClientRedirect href={"/dashboard/contacts?tab=vendors"} />
}
