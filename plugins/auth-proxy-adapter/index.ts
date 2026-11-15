import { config, definePlugin } from "@pear/sdk";
import { session } from "electron";
import { type Adapter, startAdapter } from "./adapter.ts";
import { needsAdapter, parseProxy, proxyRule } from "./proxy.ts";

/** The scrobbler's Last.fm sign-in window has a session of its own (plugins/scrobbler/auth.ts). */
const LASTFM_PARTITION = "persist:pear-lastfm";
/** A hung setProxy must not hold the first page load forever. */
const HOLD_TIMEOUT_MS = 10_000;

export default definePlugin({
  id: "auth-proxy-adapter",
  name: "Proxy",
  description: "Sends all traffic through an HTTP or SOCKS proxy, including ones that need a username and password.",
  config: {
    url: config.string("", {
      label: "Proxy address",
      placeholder: "socks5://127.0.0.1:1080",
      description: "http://, https://, socks4:// or socks5://. Credentials may also be part of the address.",
    }),
    username: config.string("", { label: "Username" }),
    password: config.string("", { label: "Password", secret: true }),
    bypass: config.string("<local>", {
      label: "Bypass list",
      placeholder: "<local>, *.example.com",
      description: "Comma-separated hosts that connect directly. <local> means plain hostnames such as localhost.",
    }),
    hostname: config.string("127.0.0.1", {
      label: "Adapter address",
      description: "Chromium can't log in to SOCKS proxies, so Pear Desktop runs a local adapter that does it. This is where it listens.",
    }),
    port: config.number(4545, { label: "Adapter port", min: 0, max: 65535, description: "0 picks a free port." }),
  },
  host: {
    async start(ctx) {
      const { config } = ctx;
      const proxy = parseProxy(config.url, { username: config.username, password: config.password });
      // pear-desktop appended --proxy-server, which covered every window; the
      // Last.fm sign-in window is the one the default session doesn't reach.
      const sessions = [ctx.session, session.fromPartition(LASTFM_PARTITION)];

      // The SDK has no prompt dialog: both items land in the settings card.
      ctx.addMenuItem({
        label: ctx.t("plugins.auth-proxy-adapter.settings.hostname.label", "Adapter address"),
        click: () => ctx.openSettings(),
      });
      ctx.addMenuItem({
        label: ctx.t("plugins.auth-proxy-adapter.settings.port.label", "Adapter port"),
        click: () => ctx.openSettings(),
      });

      // Hold requests (incl. the page that is already loading at launch) until the proxy applies.
      let release!: () => void;
      const applied = new Promise<void>((resolve) => (release = resolve));
      let deadline!: ReturnType<typeof setTimeout>;
      const expired = new Promise<void>((resolve) => (deadline = ctx.setTimeout(resolve, HOLD_TIMEOUT_MS)));
      ctx.webRequest.onBeforeRequest((_, callback) => void Promise.race([applied, expired]).then(() => callback({})));
      ctx.onCleanup(release);

      try {
        let rules = proxyRule(proxy.scheme, proxy.host, proxy.port);
        if (needsAdapter(proxy)) {
          const adapter: Adapter = await startAdapter(
            { ...proxy, type: proxy.scheme === "socks4" ? 4 : 5 },
            { host: config.hostname || "127.0.0.1", port: config.port },
            ctx.log,
          );
          ctx.onCleanup(() => adapter.close());
          rules = proxyRule("socks5", adapter.host, adapter.port);
          // The bound address, which is a free port when the config says 0.
          ctx.log.info(`SOCKS adapter on ${rules} → ${proxy.host}:${proxy.port}`);
        } else if (proxy.username) {
          const onLogin = (
            event: Electron.Event,
            _contents: unknown,
            _details: unknown,
            auth: Electron.AuthInfo,
            callback: (username?: string, password?: string) => void,
          ) => {
            if (!auth.isProxy || auth.host !== proxy.host || auth.port !== proxy.port) return;
            event.preventDefault();
            callback(proxy.username, proxy.password);
          };
          ctx.listen(ctx.app, "login", onLogin);
        }

        for (const target of sessions) {
          await target.setProxy({ mode: "fixed_servers", proxyRules: rules, proxyBypassRules: config.bypass });
          // Connections opened before keep their old route otherwise.
          await target.closeAllConnections();
        }
        // Turned off, the core then re-applies its own proxy option, if one is set.
        ctx.onCleanup(() => {
          for (const target of sessions) void target.setProxy({ mode: "system" }).then(() => target.closeAllConnections());
        });
        ctx.log.info(`using proxy ${proxyRule(proxy.scheme, proxy.host, proxy.port)}`);
      } finally {
        release();
        ctx.clearTimeout(deadline);
        ctx.webRequest.onBeforeRequest(null);
      }
    },
  },
});
