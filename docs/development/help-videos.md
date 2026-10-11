# Help Tutorial Videos

Short tutorial videos appear under Help guide sections. Each is a scripted
Playwright walkthrough recorded against a local, fictional "Compass Developer"
workspace, so it can be re-recorded whenever the screens change and never shows
real customer data.

## How it fits together

- `src/lib/help/videos.ts` lists each video and the section topic ID it belongs
  to. Guide Markdown is not edited.
- `/api/help/videos/<id>` streams `<id>.mp4` from the private `HELP_VIDEOS` R2
  bucket. It applies the same effective guide access as the Help pages, so a
  person only receives videos for guides they can read. Unknown and forbidden
  videos both return 404.
- `HelpArticle` renders guides that have videos section by section and places
  each player under its section.

## Recording

1. Create and seed an isolated database:

   ```bash
   LOCAL_DB_PATH=.help-videos/compass.db node scripts/init-local-db.mjs
   ```

2. Start Compass without WorkOS so the local developer sign-in is used:

   ```bash
   env -u WORKOS_API_KEY -u WORKOS_CLIENT_ID LOCAL_DB_PATH=.help-videos/compass.db \
     node node_modules/next/dist/bin/next dev --webpack -p 3107
   ```

3. Record all clips, or name specific ones:

   ```bash
   node scripts/help-videos/record.mjs [clip-id ...]
   ```

   The recorder re-seeds the workspace before each clip
   (`scripts/help-videos/seed.mjs`), adds a visible cursor and captions, serves
   generated sample photos instead of Drive files, and writes H.264 MP4 files
   to `.help-videos/output/`.

4. Review the files, then upload them:

   ```bash
   node scripts/help-videos/upload.mjs [clip-id ...]
   ```

## Adding a video

1. Add `scripts/help-videos/clips/<id>.mjs` exporting `clip` (`id`, `topicId`,
   `title`) and `record()`. Follow the guide section's wording in captions.
2. Add the matching entry, with its duration, to `HELP_VIDEOS`.
3. Record, review, and upload it.

Keep clips between 15 and 90 seconds and cover one workflow each. Tests check
that every video points at an existing section and has a recording script.
