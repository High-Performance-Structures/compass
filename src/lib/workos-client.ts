import { WorkOS } from "@workos-inc/node";

let workosClient: WorkOS | null = null;

export function getWorkOSClient(): WorkOS | null {
  const isConfigured =
    process.env.WORKOS_API_KEY &&
    process.env.WORKOS_CLIENT_ID &&
    !process.env.WORKOS_API_KEY.includes("placeholder");

  if (!isConfigured) {
    return null; // dev mode
  }

  if (!workosClient) {
    workosClient = new WorkOS(process.env.WORKOS_API_KEY!);
  }

  return workosClient;
}

// error mapping helper
export function mapWorkOSError(error: unknown): string {
  const err = error as { code?: string };
  if (err.code === "invalid_credentials")
    return "Invalid email or password";
  if (err.code === "expired_code") return "Code expired. Request a new one.";
  if (err.code === "user_exists") return "Email already registered";
  if (err.code === "invalid_code") return "Invalid code. Please try again.";
  if (err.code === "user_not_found") return "No account found with this email";
  return "An error occurred. Please try again.";
}
