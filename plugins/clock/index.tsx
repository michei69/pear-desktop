/** @jsxImportSource @pear/sdk */
import { config, definePlugin } from "@pear/sdk";
import { css } from "@pear/sdk/macros" with { type: "macro" };

const SECOND = 1000;

export default definePlugin({
  id: "clock",
  name: "Clock",
  description: "Shows the current time in the top bar.",
  config: {
    displaySeconds: config.bool(false, { label: "Show seconds" }),
    hour12: config.bool(false, { label: "12-hour format" }),
  },
  // The original centered the clock, but the search box lives there now.
  style: css`
    .pear-clock {
      align-self: center;
      margin: 0 12px 0 4px;
      color: var(--ytmusic-text-secondary, #aaa);
      font:
        500 15px/1 "\u0059\u006f\u0075\u0054\u0075\u0062\u0065 Sans",
        Roboto,
        sans-serif;
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
      user-select: none;
    }
  `,
  host: {
    start(ctx) {
      // Quick access only: the flat app/tray menu has no checkmarks, so the
      // settings card stays the canonical place where the state is visible.
      ctx.addMenuItem({
        label: ctx.t("plugins.clock.menu.toggle-display-seconds", "Toggle seconds"),
        click: () => ctx.setConfig({ displaySeconds: !ctx.config.displaySeconds }),
      });
      ctx.addMenuItem({
        label: ctx.t("plugins.clock.menu.toggle-24-hour-format", "Toggle 24-hour format"),
        click: () => ctx.setConfig({ hour12: !ctx.config.hour12 }),
      });
    },
  },
  page: (ctx) => {
    const clock = (<time class="pear-clock" />) as HTMLTimeElement;

    // Master formats with the app language (its menu wrote the same option);
    // an empty setting means the runtime locale, as it did there.
    const locale = () => ctx.core("general").language || navigator.language;
    const makeFormat = (hour12: boolean, displaySeconds: boolean) =>
      new Intl.DateTimeFormat(locale(), {
        hour12,
        hour: "numeric",
        minute: "numeric",
        ...(displaySeconds && { second: "numeric" }),
      });
    let format = makeFormat(ctx.config.hour12, ctx.config.displaySeconds);

    const tick = () => {
      const now = new Date();
      clock.textContent = format.format(now);
      clock.dateTime = now.toISOString();
    };
    tick();
    // Tick on second boundaries so the display never lags behind the system clock.
    const schedule = () => {
      ctx.setTimeout(
        () => {
          tick();
          schedule();
        },
        SECOND - (Date.now() % SECOND),
      );
    };
    schedule();

    // Config changes apply in place instead of restarting the page part.
    ctx.onConfigChange((next) => {
      format = makeFormat(next.hour12, next.displaySeconds);
      tick();
    });
    // A language change formats with the new language immediately.
    ctx.onCoreChange("general", () => {
      format = makeFormat(ctx.config.hour12, ctx.config.displaySeconds);
      tick();
    });

    // YTM re-renders the nav bar on some navigations.
    ctx.mount(clock, "nav_bar.right", "prepend");
  },
});
