// tool registry -- routes tool calls to compass (remote) or local handlers

import type { BridgeConfig } from "../config"
import { executeCompassTool } from "./compass"
import {
  readLocalFile,
  writeLocalFile,
  listLocalDirectory,
  searchLocalFiles,
} from "./filesystem"
import { runCommand } from "./terminal"

interface ToolCallResult {
  readonly success: boolean
  readonly result?: unknown
  readonly error?: string
}

// compass tools are discovered at registration time
let compassToolNames = new Set<string>()

export function setCompassTools(
  names: ReadonlyArray<string>,
): void {
  compassToolNames = new Set(names)
}

// local tool definitions for the Anthropic API
export const localToolDefinitions = [
  {
    name: "readFile",
    description:
      "Read the contents of a file on the user's machine.",
    input_schema: {
      type: "object" as const,
      properties: {
        path: {
          type: "string",
          description: "Absolute or relative file path",
        },
      },
      required: ["path"],
    },
  },
  {
    name: "writeFile",
    description:
      "Write content to a file on the user's machine.",
    input_schema: {
      type: "object" as const,
      properties: {
        path: {
          type: "string",
          description: "Absolute or relative file path",
        },
        content: {
          type: "string",
          description: "File content to write",
        },
      },
      required: ["path", "content"],
    },
  },
  {
    name: "listDirectory",
    description:
      "List files and directories in a path.",
    input_schema: {
      type: "object" as const,
      properties: {
        path: {
          type: "string",
          description: "Directory path to list",
        },
      },
      required: ["path"],
    },
  },
  {
    name: "searchFiles",
    description:
      "Search for files matching a glob pattern.",
    input_schema: {
      type: "object" as const,
      properties: {
        directory: {
          type: "string",
          description: "Root directory to search from",
        },
        pattern: {
          type: "string",
          description:
            "Glob pattern (e.g. '**/*.ts')",
        },
        maxResults: {
          type: "number",
          description:
            "Maximum results to return (default 50)",
        },
      },
      required: ["directory", "pattern"],
    },
  },
  {
    name: "runCommand",
    description:
      "Execute a shell command on the user's machine. " +
      "Use for git, npm, build tools, etc.",
    input_schema: {
      type: "object" as const,
      properties: {
        command: {
          type: "string",
          description: "Shell command to execute",
        },
        cwd: {
          type: "string",
          description: "Working directory (optional)",
        },
      },
      required: ["command"],
    },
  },
]

const LOCAL_TOOL_NAMES = new Set(
  localToolDefinitions.map((t) => t.name),
)

export async function executeTool(
  config: BridgeConfig,
  toolName: string,
  args: Record<string, unknown>,
): Promise<ToolCallResult> {
  // check local tools first
  if (LOCAL_TOOL_NAMES.has(toolName)) {
    return executeLocalTool(toolName, args)
  }

  // fall back to compass tools
  if (compassToolNames.has(toolName)) {
    return executeCompassTool(config, toolName, args)
  }

  return {
    success: false,
    error: `unknown tool: ${toolName}`,
  }
}

function getString(
  args: Record<string, unknown>,
  key: string,
): string | undefined {
  const v = args[key]
  return typeof v === "string" ? v : undefined
}

function getNumber(
  args: Record<string, unknown>,
  key: string,
): number | undefined {
  const v = args[key]
  return typeof v === "number" ? v : undefined
}

async function executeLocalTool(
  toolName: string,
  args: Record<string, unknown>,
): Promise<ToolCallResult> {
  switch (toolName) {
    case "readFile": {
      const path = getString(args, "path")
      if (!path) {
        return { success: false, error: "path required" }
      }
      const result = await readLocalFile(path)
      if ("error" in result) {
        return { success: false, error: result.error }
      }
      return { success: true, result }
    }
    case "writeFile": {
      const path = getString(args, "path")
      const content = getString(args, "content")
      if (!path || content === undefined) {
        return {
          success: false,
          error: "path and content required",
        }
      }
      const result = await writeLocalFile(path, content)
      if ("error" in result) {
        return { success: false, error: result.error }
      }
      return { success: true, result }
    }
    case "listDirectory": {
      const path = getString(args, "path")
      if (!path) {
        return { success: false, error: "path required" }
      }
      const result = await listLocalDirectory(path)
      if ("error" in result) {
        return { success: false, error: result.error }
      }
      return { success: true, result }
    }
    case "searchFiles": {
      const directory = getString(args, "directory")
      const pattern = getString(args, "pattern")
      if (!directory || !pattern) {
        return {
          success: false,
          error: "directory and pattern required",
        }
      }
      const maxResults =
        getNumber(args, "maxResults") ?? 50
      const result = await searchLocalFiles(
        directory,
        pattern,
        maxResults,
      )
      if ("error" in result) {
        return { success: false, error: result.error }
      }
      return { success: true, result }
    }
    case "runCommand": {
      const command = getString(args, "command")
      if (!command) {
        return {
          success: false,
          error: "command required",
        }
      }
      const cwd = getString(args, "cwd")
      const result = await runCommand(command, cwd)
      if ("error" in result) {
        return { success: false, error: result.error }
      }
      return { success: true, result }
    }
    default:
      return {
        success: false,
        error: `unknown local tool: ${toolName}`,
      }
  }
}
