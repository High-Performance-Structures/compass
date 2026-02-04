import { getSignUpUrl } from "@workos-inc/authkit-nextjs";
import { redirect } from "next/navigation";

export default async function SignupPage() {
  const signUpUrl = await getSignUpUrl();
  redirect(signUpUrl);
}
