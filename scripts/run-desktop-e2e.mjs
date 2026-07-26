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
	},
	stdio: "inherit",
})

if (result.error) {
	console.error(result.error.message)
	process.exit(1)
}

process.exit(result.status ?? 1)
