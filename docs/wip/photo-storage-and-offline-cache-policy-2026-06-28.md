# Photo Storage and Offline Cache Policy

Last updated: 2026-06-28

Compass should not become a second permanent file store for project photos. Google Drive remains the durable source of truth for HPS project files and images unless a later architecture decision explicitly changes that.

## Source of Truth

Project photos and documents should live in Google Drive. Compass stores metadata, provenance, project relationships, review state, visibility decisions, and sync state.

The primary photo metadata record is `daily_log_photos`. It should identify the source image through fields such as:

- `source_system`
- `source_external_id`
- `drive_file_id`
- `drive_url`
- `thumbnail_url`
- `upload_status`
- `review_status`
- `owner_visible`
- `sub_vendor_visible`
- `public_shareable`
- `schedule_phase_override`

D1 should not store original image bytes.

## Display Path

Owners, subcontractors, and staff should view approved photos through Compass-controlled routes and UI, not raw Google Drive folder access. A stored `drive_file_id` may be fetched through a Compass API route that checks Compass auth and permissions before retrieving the file from Google Drive.

## Disposable Thumbnail Cache

Compass may keep thumbnail caches for performance and offline usability. Those caches are disposable and must be derived from the source-of-truth pointer.

A thumbnail cache entry should always carry provenance:

- source provider, such as `google_drive`, `telegram`, `compass_upload`, or `buildertrend_archive`
- source file ID or external ID
- source modified timestamp or content hash when available
- source mime type
- thumbnail mime type
- generated size
- generated timestamp
- last accessed timestamp
- cache version

If the source pointer, source modified timestamp, source hash, or cache version changes, the thumbnail is stale and can be regenerated.

## Desktop and Offline

For the desktop app, local SQLite may store small generated thumbnails as a cache, or store cache metadata with thumbnail bytes in a local app-data file. Either approach is acceptable as long as the cache is bounded, disposable, and keyed by source provenance.

The desktop app should not permanently sync thumbnail bytes back to Cloud D1. Cloud D1 should continue to store only metadata and pointers. Offline uploads should first live in a local outbound queue; once online, Compass uploads the original file to Google Drive, writes the source pointer to Cloud D1, and then may discard the local original unless the user marked it for offline availability.

## Cache Rules

- Originals are stored in Google Drive.
- Cloud D1 stores pointers and business metadata only.
- Local desktop cache may store thumbnails for speed and offline viewing.
- Local desktop originals are temporary upload queue items unless explicitly retained for offline use.
- Cache eviction must never delete the Drive source file or D1 metadata.
- Regenerating thumbnails from source should be safe at any time.

