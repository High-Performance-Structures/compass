// safe local command execution

const DEFAULT_TIMEOUT = 30_000

const BLOCKED_PATTERNS: ReadonlyArray<RegExp> = [
  /\brm\s+-rf\s+[\/~]/i,
  /\bdd\s+/i,
  /\bmkfs\b/i,
  /\bformat\b/i,
  /\b:\(\)\s*\{/,
  /\bchmod\s+-R\s+777/i,
  /\bchown\s+-R/i,
  />\s*\/dev\/sd/i,
  /\bcurl\b.*\|\s*sh/i,
  /\bwget\b.*\|\s*sh/i,
]

function isBlockedCommand(command: string): boolean {
  return BLOCKED_PATTERNS.some((p) => p.test(command))
}

export async function runCommand(
  command: string,
  cwd?: string,
  timeout = DEFAULT_TIMEOUT,
): Promise<
  | {
      stdout: string
      stderr: string
      exitCode: number
    }
  | { error: string }
> {
  if (isBlockedCommand(command)) {
    return {
      error:
        "command blocked: matches a restricted pattern",
    }
  }

  try {
    const proc = Bun.spawn(["sh", "-c", command], {
      cwd: cwd ?? process.cwd(),
      stdout: "pipe",
      stderr: "pipe",
    })

    // timeout handling
    const timer = setTimeout(() => {
      proc.kill()
    }, timeout)

    const stdout = await new Response(
      proc.stdout,
    ).text()
    const stderr = await new Response(
      proc.stderr,
    ).text()
    const exitCode = await proc.exited

    clearTimeout(timer)

    return {
      stdout: stdout.slice(0, 50_000),
      stderr: stderr.slice(0, 10_000),
      exitCode,
    }
  } catch (err) {
    const msg =
      err instanceof Error
        ? err.message
        : "unknown error"
    return { error: `command failed: ${msg}` }
  }
}
