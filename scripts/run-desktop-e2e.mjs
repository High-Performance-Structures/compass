import { spawnSync } from "node:child_process"

// Reuse the Bun executable that launched this script. Spawning `bunx.cmd`
// directly is unreliable on Windows GitHub runners because it is a shell shim.
const command = process.execPath
const args = [
	"x",
	"playwright",
	"test",
	"--project=desktop-chromium",
	...process.argv.slice(2),
]

const result = spawnSync(command, args, {
	env: {
		...process.env,
		ELECTRON: "true",
		// Keep local runs from covering the screen; CI and anyone debugging
		// visually (COMPASS_E2E_VISIBLE_WINDOWS=true) get normal windows.
		...(!process.env.CI && process.env.COMPASS_E2E_VISIBLE_WINDOWS !== "true"
			? { COMPASS_E2E_INVISIBLE_WINDOWS: "true" }
			: {}),
	},
	stdio: "inherit",
})

if (result.error) {
	console.error(result.error.message)
	process.exit(1)
}

process.exit(result.status ?? 1)
