import { getSignInUrl } from "@workos-inc/authkit-nextjs";
import { redirect } from "next/navigation";

export default async function LoginPage() {
  const signInUrl = await getSignInUrl();
  redirect(signInUrl);
}
