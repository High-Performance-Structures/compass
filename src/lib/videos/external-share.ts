export function projectVideoDailyLogShareUrl(input: {
  readonly projectId: string
  readonly videoId: string
}): string {
  return `https://compass.openrangeconstruction.ltd/api/projects/${encodeURIComponent(input.projectId)}/videos/${encodeURIComponent(input.videoId)}`
}
