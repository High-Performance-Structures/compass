// The private bucket holding Help tutorial videos. Optional because local
// development and test environments run without it; the video route then
// reports every video as unavailable.
interface CloudflareEnv {
  HELP_VIDEOS?: R2Bucket
}
