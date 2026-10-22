// Seeks the active Plex media session to an exact position, from the adb shell,
// without leaving the player. Pure reflection so it compiles with a plain JDK
// (no android.jar). Run on the SHIELD via:
//   CLASSPATH=/data/local/tmp/seek.dex app_process /system/bin tv.plex.Seek <packageHint> <command> [ms]
// commands: list | pos | seekto <ms> | seekby <deltaMs>
package tv.plex;

import java.lang.reflect.Method;
import java.util.List;

public class Seek {
  public static void main(String[] args) throws Exception {
    String pkgHint = args.length > 0 ? args[0] : "com.plexapp.android";
    String cmd = args.length > 1 ? args[1] : "pos";

    // Spin up a system Context from app_process (no Activity).
    Class<?> at = Class.forName("android.app.ActivityThread");
    Method prep = Class.forName("android.os.Looper").getMethod("prepareMainLooper");
    prep.invoke(null);
    Object thread = at.getMethod("systemMain").invoke(null);
    Object ctx = at.getMethod("getSystemContext").invoke(thread);

    // MediaSessionManager.getActiveSessions(null) -> List<MediaController>
    Class<?> ctxC = Class.forName("android.content.Context");
    Object msm = ctxC.getMethod("getSystemService", String.class).invoke(ctx, "media_session");
    Class<?> msmC = Class.forName("android.media.session.MediaSessionManager");
    Class<?> compC = Class.forName("android.content.ComponentName");
    List<?> controllers = (List<?>) msmC.getMethod("getActiveSessions", compC).invoke(msm, new Object[]{null});

    Class<?> ctrlC = Class.forName("android.media.session.MediaController");
    Object target = null;
    for (Object c : controllers) {
      String pkg = (String) ctrlC.getMethod("getPackageName").invoke(c);
      if ("list".equals(cmd)) System.out.println("session: " + pkg);
      if (pkg != null && pkg.contains(pkgHint) && target == null) target = c;
    }
    if ("list".equals(cmd)) return;
    if (target == null) { System.out.println("NO_SESSION"); return; }

    Object state = ctrlC.getMethod("getPlaybackState").invoke(target);
    Class<?> stateC = Class.forName("android.media.session.PlaybackState");
    long pos = state == null ? -1 : (long) stateC.getMethod("getPosition").invoke(state);
    long actions = state == null ? 0 : (long) stateC.getMethod("getActions").invoke(state);

    if ("pos".equals(cmd)) { System.out.println("POS " + pos + " ACTIONS " + actions); return; }

    long want;
    if ("seekby".equals(cmd)) want = Math.max(0, pos + Long.parseLong(args[2]));
    else want = Math.max(0, Long.parseLong(args[2])); // seekto

    Object tc = ctrlC.getMethod("getTransportControls").invoke(target);
    tc.getClass().getMethod("seekTo", long.class).invoke(tc, want);
    System.out.println("SEEK_OK from " + pos + " to " + want + " (actions " + actions + ")");
  }
}
