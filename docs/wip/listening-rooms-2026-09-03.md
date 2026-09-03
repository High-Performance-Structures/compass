# Listening Rooms

Status: experimental MVP

## Purpose

Listening Rooms give a voice channel an optional shared music queue so a team
can listen together during a break or quiet work period. Participation is
explicitly opt-in. Compass stores room state, track metadata, and links, but it
does not proxy, rebroadcast, record, or transcribe music.

## MVP experience

- A staff member with channel-create permission can start one room per voice
  channel.
- Any internal staff member with access to the voice channel can join.
- Every joined listener can add a track to the shared queue.
- A track may have links for several services. Listeners select a preferred
  provider and Compass opens that provider when available, otherwise falling
  back to the first link.
- Recognized providers are Spotify, Apple Music, YouTube, SoundCloud, Amazon
  Music, TIDAL, Deezer, and Pandora. Other HTTPS links remain usable.
- The room host controls the shared play, pause, restart, and skip cues.
- Contributors can remove their own tracks and service links. The host and
  channel moderators can moderate the whole queue.
- Closing a room requires confirmation and deletes the ephemeral queue and
  participant list through cascading foreign keys.

The MVP intentionally opens tracks in each provider rather than controlling
provider playback. The shared clock and playback anchor are stored now so a
future provider adapter can synchronize supported SDK players without changing
the room model.

## Data model

`listening_rooms` contains the channel, host, current track, playback state,
and server-time anchor. `listening_queue_items` contains canonical human-entered
track metadata. `listening_track_links` maps a queued track to provider URLs.
`listening_room_participants` records opt-in participation and each listener's
preferred provider.

All tables are scoped indirectly through a voice channel and cascade when the
channel or room is deleted. Server actions re-check authentication,
organization scope, channel type, archive state, private-channel membership,
internal-staff status, and demo read-only state.

## Follow-up stages

1. Add catalog search and metadata lookup so users can paste only a URL or
   search by title and artist.
2. Add provider OAuth connections and playback adapters where provider policy
   permits it. Each listener must authenticate their own account.
3. Use the stored server playback anchor for SDK seek and drift correction.
4. Add optional voice-aware local volume ducking. Music must remain excluded
   from meeting recordings and transcripts.
5. Add queue ordering, DJ handoff, reactions, and organization-level feature
   controls after the experiment demonstrates real use.

## Provider and rights boundary

Before enabling embedded or synchronized playback in a production product,
review each provider's current developer terms, account requirements, branding
rules, autoplay behavior, and commercial-use restrictions. The provider must
deliver audio directly to its authenticated listener. Compass must not extract
audio, bypass advertisements, or turn one subscriber's stream into a broadcast.
