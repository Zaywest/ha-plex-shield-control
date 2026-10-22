#!/system/bin/sh
# plexplay.sh - runs ON the NVIDIA SHIELD / Android TV (copied to /data/local/tmp/).
# Home Assistant calls it through the Android TV (ADB) integration's androidtv.adb_command.
#
# Each call is one short step (< 10 s, because adb_command gives up after ~10 s) and prints a
# status word on its last line:  OK = done, WAIT = not ready yet (call again), FAIL:<why> = stop.
#
#   plexplay.sh open <base64 plex link> [same]   open the title's detail page in the Plex app
#   plexplay.sh play [resume|start]              press Resume/Watch/Play (or Plex's Restart button)
#   plexplay.sh seekto <milliseconds>            seek the playing title without leaving it
#   plexplay.sh pos                              print the current position in ms
#
# The Plex link is Plex's own in-app library route (found in the Plex for Android TV app):
#   plex://libraries/<serverId>/movie/<slug>/<ratingKey>
#   plex://libraries/<serverId>/show/<slug>/<showKey>/s/<season>/<seasonKey>/e/<episode>/<episodeKey>
# Only the server ID and keys matter; the slug can be any text.
STEP="$1"
PKG=com.plexapp.android
X=/data/local/tmp/pp.xml; PRE=/data/local/tmp/pp.pre; N=/data/local/tmp/pp.n
dump() { rm -f $X; timeout 5 uiautomator dump $X >/dev/null 2>&1; [ -s $X ] || : > $X; }
sig() { grep -oE 'text="[^"]*"' $X | md5sum | cut -c1-32; }
session() { dumpsys media_session | grep -A40 "package=$PKG"; }
plexstate() { session | grep -m1 -oE 'state=PlaybackState \{state=[0-9]+' | grep -oE '[0-9]+$'; }
playing() { session | grep -qE 'state=(3|6), position=[0-9]'; }

case "$STEP" in
  open)
    # Opens the title INSIDE the running Plex app (no restart, so no Plex logo).
    # Plex is only cold-started if it isn't running at all.
    LINK=$(echo "$2" | base64 -d 2>/dev/null)
    input keyevent KEYCODE_WAKEUP
    case "$LINK" in plex://libraries/*) ;; *) echo "FAIL:bad-link"; exit 0 ;; esac
    echo 0 > $N
    if ! pidof $PKG >/dev/null; then
      rm -f $PRE
      am start -a android.intent.action.VIEW -d "$LINK" $PKG >/dev/null 2>&1
      echo OK; exit 0
    fi
    # stop anything playing so the page isn't hidden behind the player
    case "$(plexstate)" in 2|3|6|8) input keyevent MEDIA_STOP; sleep 1.5 ;; esac
    if [ "$3" = "same" ]; then rm -f $PRE
    else dump; sig > $PRE; fi          # remember the old screen so we never press on it
    am start -a android.intent.action.VIEW -d "$LINK" $PKG >/dev/null 2>&1
    echo OK ;;

  play)
    # On the detail page Plex selects its main button: "Watch" (never started), "Play",
    # or "Resume • Xm left" (partly watched). Next to Resume is a "Restart" button.
    #   resume (default): press the selected button
    #   start:            if it's Resume, move Right to Restart first
    # Verifies playback began; a miss returns WAIT so Home Assistant retries.
    MODE="${2:-resume}"
    focused() { n=$(grep -oE '<node [^>]*focused="true"[^>]*>' $X | head -1)
                echo "$(echo "$n" | grep -oE 'content-desc="[^"]*"') $(echo "$n" | grep -oE 'bounds="\[[0-9]+,[0-9]+\]' | grep -oE '\[[0-9]+,[0-9]+\]')"; }
    if playing; then rm -f $PRE; echo OK; exit 0; fi
    dump
    # never act on Plex's online-catalog page (only your library's copy)
    grep -qE 'content-desc="(Where to Watch|Add to Watchlist)' $X && { echo "FAIL:online-page"; exit 0; }
    # Preferred: Plex's action buttons have fixed ids on movie AND episode pages:
    #   action-button-watch (Watch / Play / Resume)   action-button-watchFromStart (Restart)
    # Tap the right one directly (episode pages select the episode thumbnail, not a button).
    btn() { grep -oE "<node [^>]*resource-id=\"$1\"[^>]*>" $X | head -1 | grep -oE 'bounds="\[[0-9]+,[0-9]+\]\[[0-9]+,[0-9]+\]"' | grep -oE '[0-9]+' | tr '\n' ' '; }
    W=$(btn action-button-watch)
    if [ -n "$W" ]; then
      if [ -f $PRE ]; then             # another title's page may still be showing
        n=$(( $(cat $N 2>/dev/null || echo 0) + 1 )); echo $n > $N
        [ "$(sig)" = "$(cat $PRE)" ] && [ $n -lt 3 ] && { echo WAIT; exit 0; }
      fi
      B="$W"
      if [ "$MODE" = "start" ]; then S=$(btn action-button-watchFromStart); [ -n "$S" ] && B="$S"; fi
      set -- $B; input tap $(( ($1 + $3) / 2 )) $(( ($2 + $4) / 2 ))
      i=0; while [ $i -lt 6 ]; do sleep 0.5; playing && break; i=$((i+1)); done
      if playing; then rm -f $PRE; echo OK; else echo WAIT; fi
      exit 0
    fi
    # Fallback (button ids not found): press the selected button with the D-pad.
    foc=$(focused)
    case "$foc" in *Resume*|*Play*|*Watch*|*Restart*|*'[128,'[5-9][0-9][0-9]']'*) ;; *) echo WAIT; exit 0 ;; esac
    if [ -f $PRE ]; then               # another title's page may still be showing
      n=$(( $(cat $N 2>/dev/null || echo 0) + 1 )); echo $n > $N
      [ "$(sig)" = "$(cat $PRE)" ] && [ $n -lt 3 ] && { echo WAIT; exit 0; }
    fi
    if [ "$MODE" = "start" ]; then
      case "$foc" in *Resume*) input keyevent KEYCODE_DPAD_RIGHT; sleep 0.7 ;; esac
    fi
    input keyevent KEYCODE_DPAD_CENTER
    i=0; while [ $i -lt 6 ]; do sleep 0.5; playing && break; i=$((i+1)); done
    if playing; then rm -f $PRE; echo OK; else echo WAIT; fi ;;

  pos)
    session | grep -m1 -oE 'state=[0-9]+, position=[0-9-]+' | grep -oE 'position=[0-9-]+' | grep -oE '[-0-9]+' || echo -1 ;;

  seekto)
    # Exact seek through Plex's own media-session "seek to", via the small helper seek.dex.
    # The movie keeps playing; nothing is closed or reopened.
    T="$2"; [ -z "$T" ] && { echo "FAIL:no-target"; exit 0; }
    if [ -f /data/local/tmp/seek.dex ]; then
      r=$(CLASSPATH=/data/local/tmp/seek.dex app_process /system/bin tv.plex.Seek $PKG seekto "$T" 2>/dev/null | grep -E 'SEEK_OK|NO_SESSION' | tail -1)
      case "$r" in SEEK_OK*) echo OK; exit 0 ;; esac
    fi
    # Backup if the helper is missing: nudge with fast-forward (+30 s) / rewind (-10 s).
    i=0
    while [ $i -lt 5 ]; do
      p=$(session | grep -m1 -oE 'position=[-0-9]+' | grep -oE '[-0-9]+')
      [ -z "$p" ] && { echo "FAIL:no-playback"; exit 0; }
      d=$(( T - p )); a=$d; [ $a -lt 0 ] && a=$(( -a ))
      [ $a -le 7000 ] && { echo OK; exit 0; }
      if [ $d -gt 0 ]; then input keyevent MEDIA_FAST_FORWARD; else input keyevent MEDIA_REWIND; fi
      sleep 1.0; i=$(( i + 1 ))
    done
    echo WAIT ;;

  *) echo "FAIL:unknown-step" ;;
esac
