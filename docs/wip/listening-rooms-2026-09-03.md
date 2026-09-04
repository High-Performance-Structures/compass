# Listening Rooms

Status: synchronized playback pilot

## Purpose

Listening Rooms give a voice channel an optional shared music queue so a team
can listen together during a break or quiet work period. Participation is
explicitly opt-in. Compass stores room state, track metadata, and links, but it
does not proxy, rebroadcast, record, or transcribe music.

## Current experience

- A staff member with channel-create permission can start one room per voice
  channel.
- Any internal staff member with access to the voice channel can join.
- Every joined listener can add a track to the shared queue.
- A track may have links for several services. Listeners select their own
  provider; Compass never silently substitutes a different service.
- YouTube and SoundCloud links play in embedded, individually delivered
  players. After a listener enables audio once, Compass synchronizes play,
  pause, restart, skip, automatic queue advancement, and drift correction.
- Provider choices that do not yet expose an approved playback integration are
  labeled `Link only` and open outside Compass.
- Recognized providers are Spotify, Apple Music, YouTube, SoundCloud, Amazon
  Music, TIDAL, Deezer, and Pandora. Other HTTPS links remain usable.
- The room host controls shared playback. Playing tracks are scheduled 1.5
  seconds ahead so connected clients can load before the common start time.
- Contributors can remove their own tracks and service links. The host and
  channel moderators can moderate the whole queue.
- Closing a room requires confirmation and deletes the ephemeral queue and
  participant list through cascading foreign keys.

The browser must receive one explicit `Enable synced playback` interaction
before attempting audio, because autoplay policy is controlled by the browser.
If autoplay is still blocked, the embedded provider controls remain available
for the listener's one-time manual start.

## Realtime architecture

The D1 room record remains the authoritative durable playback and queue state.
Each active room also maps to one `ListeningRoomCoordinator` Durable Object.
Authenticated, joined listeners connect to it using hibernatable WebSockets.
Mutations continue through permission-checked server actions, then send a small
`room_changed` event so peers immediately reload the authoritative D1 snapshot.
The coordinator persists a monotonically increasing event sequence before
broadcasting it; it never accepts playback state from a browser.

Each embedded player derives its target position from the server-time anchor.
While playing, the client compares the provider position every five seconds and
seeks when drift exceeds 750 milliseconds. The host's player advances the queue
when the provider reports that the current track ended.

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

1. Add catalog search and metadata lookup so users can select a track inside
   Compass instead of finding and copying a provider URL.
2. Add Apple MusicKit authorization and playback for subscribers.
3. Pursue additional playback adapters only where provider policy and account
   access permit them. Spotify remains link-only pending written approval for a
   commercial streaming integration.
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
