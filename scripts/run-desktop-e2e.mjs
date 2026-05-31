import { spawnSync } from "node:child_process"

const command = process.platform === "win32" ? "bunx.cmd" : "bunx"
const args = ["playwright", "test", "--project=desktop-chromium", ...process.argv.slice(2)]

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
