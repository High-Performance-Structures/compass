// Which Worker version answered a request, and the Worker's name. Used by
// /api/deployment-version so open tabs can stay on their own version during an
// update (src/lib/deployment/update-window.ts). Optional because local
// development runs without them.
interface CloudflareEnv {
  CF_VERSION_METADATA?: WorkerVersionMetadata
  COMPASS_WORKER_NAME?: string
}
