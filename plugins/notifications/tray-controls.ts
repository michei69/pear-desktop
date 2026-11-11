// pear-desktop's Windows tray controls for notifications: a click toggles the
// toast, a double-click the window. The tray plugin first offers each click as
// a claimable event, so without a claim its own window toggle runs as before.

import type { Emitter, NowPlaying, Track } from "@pear/sdk";
import { isPlaying } from "@pear/sdk/util";

/** What the tray controls need from the notifier (see index.ts). */
export interface TrayNotifier {
  readonly showing: boolean;
  show(track: Track, paused: boolean): boolean;
  close(): void;
}

/** The parts of the host context the tray controls use. */
export interface TrayControlsHost {
  readonly app: Emitter;
  readonly window: { isVisible(): boolean; show(): void; hide(): void };
  readonly player: { readonly state: NowPlaying };
  readonly config: { readonly trayControls: boolean; readonly interactive: boolean };
  listen(target: Emitter, event: string, listener: (claim: { claimed: boolean }) => void): void;
}

export function setupTrayControls(host: TrayControlsHost, notifier: TrayNotifier) {
  const enabled = () => host.config.trayControls && host.config.interactive;

  host.listen(host.app, "pear:tray-click", (claim: { claimed: boolean }) => {
    if (!enabled()) return;
    const track = host.player.state.track;
    // Nothing to close or announce: the tray's own click action should run
    // instead of being swallowed by a claim.
    if (!notifier.showing && !track) return;
    claim.claimed = true;
    if (notifier.showing) notifier.close();
    else if (track) notifier.show(track, !isPlaying(host.player.state));
  });

  host.listen(host.app, "pear:tray-double-click", (claim: { claimed: boolean }) => {
    if (!enabled()) return;
    claim.claimed = true;
    if (host.window.isVisible()) host.window.hide();
    else host.window.show();
  });
}
