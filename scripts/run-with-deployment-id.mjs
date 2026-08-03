import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";

const [command, ...args] = process.argv.slice(2);

if (!command) {
    console.error("Usage: run-with-deployment-id <command> [...args]");
    process.exit(1);
}

// A unique build identifier lets Next.js detect an open browser tab whose
// client bundle belongs to an older Compass deployment.
const deploymentId =
    process.env.NEXT_DEPLOYMENT_ID ??
    process.env.WORKERS_CI_BUILD_UUID ??
    (process.env.GITHUB_RUN_ID
        ? `${process.env.GITHUB_RUN_ID}-${process.env.GITHUB_RUN_ATTEMPT ?? "1"}`
        : undefined) ??
    randomUUID();

const child = spawn(command, args, {
    env: {
        ...process.env,
        NEXT_DEPLOYMENT_ID: deploymentId,
    },
    stdio: "inherit",
});

child.on("error", (error) => {
    console.error(`Unable to start ${command}:`, error);
    process.exit(1);
});

child.on("exit", (code, signal) => {
    if (signal) {
        process.kill(process.pid, signal);
        return;
    }

    process.exit(code ?? 1);
});
