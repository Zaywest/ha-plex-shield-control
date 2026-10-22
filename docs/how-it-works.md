# How it works

Notes for anyone maintaining or porting this. Everything was found by inspecting the
Plex for Android TV app (decompiled with JADX; its React Native Hermes bundle searched for
strings) and by testing on an NVIDIA SHIELD.

## 1. Plex's in-app library link

The Plex for Android TV app (2026.x) registers the `plex://` scheme and routes it with React
Navigation. Its route table contains library routes:

```
libraries/:serverId/movie/:slug/:key
libraries/:serverId/show/:slug/:showKey/s/:seasonId/:seasonKey?/e/:episodeId/:episodeKey
```

So, for example:

```
plex://libraries/<serverMachineId>/movie/anything/<ratingKey>
plex://libraries/<serverMachineId>/show/anything/<showRatingKey>/s/<seasonIndex>/<seasonRatingKey>/e/<episodeIndex>/<episodeRatingKey>
```

* `serverMachineId` is the Plex server's `machineIdentifier` (from `/identity`).
* The slug is only cosmetic; any text works.
* `am start -a android.intent.action.VIEW -d '<link>' com.plexapp.android` opens the title's
  detail page. Sent to an already-running Plex it navigates in place (no splash/logo).

Older link formats (`plex://server://…/library/metadata/…`, `plex://play/…`,
`plex://preplay/…`) are ignored by this app version. `watch.plex.tv` links open Plex's
*online catalog* page, which has no Play button for your copy.

## 2. Pressing Play / Resume / Restart

Plex doesn't auto-play from the link and its remote-control (Companion) player is off on
Android TV, so `plexplay.sh play` presses the button the way a person would:

* `uiautomator dump` exposes the detail page's action buttons with **stable resource ids**:
  * `action-button-watch` labelled "Watch" (never started), "Play", or "Resume • Xm left"
  * `action-button-watchFromStart` labelled "Restart"
* The script taps the right one by its bounds. This matters for episodes: their page selects
  the *episode thumbnail*, not a button, so pressing Select would just resume.
* It then checks the media session (`dumpsys media_session`) until the state is playing,
  otherwise it answers `WAIT` and Home Assistant calls it again.
* Guard: it never acts on a page with "Where to Watch" / "Add to Watchlist" (the online
  catalog), and waits for the previous title's page to be replaced.

Home Assistant's `androidtv.adb_command` gives up after ~10 s, so every step is short and
reports `OK` / `WAIT` / `FAIL:<reason>` on its last line; the HA scripts loop on `WAIT`.

## 3. Seeking without leaving the movie

Plex's player registers an Android media session (androidx media3) whose actions include
`ACTION_SEEK_TO`. `seek.dex` is a tiny Java program run with `app_process` as the adb shell
user (which may read media sessions): it gets a system context, finds the
`com.plexapp.android` `MediaController`, and calls `getTransportControls().seekTo(ms)`.

```
CLASSPATH=/data/local/tmp/seek.dex app_process /system/bin tv.plex.Seek com.plexapp.android seekto 600000
```

Result: playback jumps to the exact millisecond and continues. Nothing is stopped or reopened.

Things that **don't** work, for the record:
* Tapping the on-screen progress bar: the player ignores touch.
* Simulated held keys via `sendevent`: input devices are blocked by SELinux.
* Plex Companion `/player/playback/seekTo`: the TV app doesn't advertise as a player.
* Setting the server resume point to 0: Plex ignores offsets that small (hence "Start over" uses the Restart button).

## 4. The cards

* **plex-library-card** talks to your Plex server directly (token obtained through the
  plex.tv PIN flow, stored in the browser), builds the link from `machineIdentifier` and
  `ratingKey`s, and calls `script.plex_library_play` with `uri` and `start_over`.
* **plex-now-playing-card** reads Home Assistant's Plex player entity for title/position and
  calls `script.plex_seek` with the target seconds when you release the bar.
