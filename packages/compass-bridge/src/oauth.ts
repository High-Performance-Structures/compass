// OAuth login via pi-ai's Anthropic provider
import { loginAnthropic } from "@mariozechner/pi-ai"

export interface LoginOptions {
  readonly manual?: boolean
}

// pi-ai credential shape
export interface OAuthResult {
  readonly access: string
  readonly refresh: string
  readonly expires: number
}

export async function login(
  options?: LoginOptions,
): Promise<OAuthResult> {
  const result = await loginAnthropic(
    (url) => {
      console.log("\nopen this URL in your browser:\n")
      console.log(url)

      // try to open browser automatically
      try {
        const platform = process.platform
        const cmd =
          platform === "darwin"
            ? "open"
            : platform === "win32"
              ? "start"
              : "xdg-open"
        Bun.spawn([cmd, url], {
          stdout: "ignore",
          stderr: "ignore",
        })
      } catch {
        // user can open manually
      }
    },
    async () => {
      console.log(
        "\nafter authorizing, paste the code below.",
      )
      process.stdout.write("\nauthorization code: ")
      for await (const line of console) {
        return line.trim()
      }
      return ""
    },
  )

  return {
    access: result.access,
    refresh: result.refresh,
    expires: result.expires,
  }
}
