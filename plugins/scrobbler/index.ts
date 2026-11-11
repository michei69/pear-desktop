// Scrobbles to Last.fm and/or ListenBrainz: "now playing" when a track starts
// or resumes, a scrobble once it is halfway through (see tracker.ts).

import { definePlugin } from "@pear/sdk";
import { v } from "@pear/sdk/rpc";
import { lastFmAuthorizer } from "./auth.ts";
import { warner } from "./common.ts";
import { scrobbleNames } from "./filters.ts";
import { schema } from "./schema.ts";
import { submitter } from "./submit.ts";
import { ScrobbleTracker, type ScrobbleMemory } from "./tracker.ts";

/** Ticks just after the scrobble threshold, so it has surely passed. */
const THRESHOLD_SLACK_MS = 50;

/**
 * The submitted play survives the plugin's stop/start (the host part is rebuilt
 * when it is toggled), so re-enabling it on the same track must not submit the
 * play again; the tracker releases it when another track is seen.
 */
const submitted: ScrobbleMemory = { videoId: undefined };

export default definePlugin({
  id: "scrobbler",
  name: "Scrobbler",
  description: "Scrobble what you listen to to Last.fm and ListenBrainz.",
  config: schema,
  host: {
    start(ctx) {
      const warn = warner(ctx);
      const { submit, prefetchDetails } = submitter(ctx, warn);
      const tracker = new ScrobbleTracker(
        {
          nowPlaying: (play) => void submit("nowPlaying", play),
          scrobble: (play) => void submit("scrobble", play),
        },
        submitted,
      );
      // One timer, re-armed on every player change.
      let tick: ReturnType<typeof setTimeout> | undefined;
      const schedule = () => {
        ctx.clearTimeout(tick);
        const wait = tracker.timeUntilScrobble();
        if (wait === null) return;
        tick = ctx.setTimeout(() => {
          tracker.tick();
          schedule();
        }, wait + THRESHOLD_SLACK_MS);
      };
      ctx.player.on("change", (state) => {
        if (state.track) prefetchDetails(state.track.videoId);
        tracker.update(state);
        schedule();
      });
      tracker.update(ctx.player.state);
      schedule();

      // pear-desktop's native scrobbler menu entries, as quick actions; the rest is in the settings card.
      ctx.addMenuItem({
        label: ctx.t("plugins.scrobbler.menu.toggle-lastfm", "Toggle Last.fm"),
        click: () => ctx.setConfig({ lastfmEnabled: !ctx.config.lastfmEnabled }),
      });
      ctx.addMenuItem({
        label: ctx.t("plugins.scrobbler.menu.toggle-listenbrainz", "Toggle ListenBrainz"),
        click: () => ctx.setConfig({ listenbrainzEnabled: !ctx.config.listenbrainzEnabled }),
      });
      ctx.addMenuItem({
        label: ctx.t("plugins.scrobbler.menu.open-settings", "Scrobbler settings"),
        click: () => ctx.openSettings(),
      });

      // Config changes keep the current play; they may ask for Last.fm authorization.
      const auth = lastFmAuthorizer(ctx, warn);
      ctx.onConfigChange(() => auth.reconfigure());
      void auth.authorize();
    },
    rpc: {
      names: {
        summary: "The title and artist the scrobbler would submit for a song",
        input: v.object({
          title: v.string(),
          artist: v.string(),
          alternativeTitle: v.optional(v.string()),
          tags: v.optional(v.array(v.string())),
        }),
        run({ title, artist, alternativeTitle, tags }) {
          return scrobbleNames({ title, artist, alternativeTitle, tags }, this.config);
        },
      },
    },
  },
});
