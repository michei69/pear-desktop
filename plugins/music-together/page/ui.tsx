import type { ComponentChildren } from "preact";
import { useEffect, useState } from "preact/hooks";
import type { Translate } from "@pear/sdk/i18n";
import { runDiagnostics } from "../diagnostics.ts";
import type { CheckId, DiagnosticCheck, DiagnosticResult, NatType } from "../diagnostics-analysis.ts";
import { parseIceServers } from "../ice.ts";
import type { Together } from "../together.ts";
import { PERMISSIONS, type Profile } from "../types.ts";

function useTogether(together: Together) {
  const [, setTick] = useState(0);
  useEffect(() => together.subscribe(() => setTick((t) => t + 1)), [together]);
}

export function LauncherButton({ together, open, onClick }: { together: Together; open: boolean; onClick(): void }) {
  useTogether(together);
  const count = Object.keys(together.profiles).length;
  const active = together.mode !== "disconnected";
  return (
    <button
      type="button"
      class="launcher"
      data-active={active}
      aria-expanded={open}
      aria-label="Music Together"
      title="Music Together"
      onClick={onClick}
    >
      {together.connecting ? <span class="spinner" aria-hidden="true" /> : <PeopleIcon />}
      {active && count > 1 && <span class="count">{count}</span>}
    </button>
  );
}

export interface PanelProps {
  together: Together;
  t: Translate;
  name: string;
  setName(name: string): void;
  copy(text: string): void;
  copyDiagnostics(text: string): void;
  iceServerEntries: readonly string[];
  onClose(): void;
}

/** pear-desktop's Music Together menus: host or join; then the host id, permission, users, and stop. */
export function Panel(props: PanelProps) {
  const { together, t, onClose } = props;
  useTogether(together);
  const mode = together.mode;
  return (
    <div class="panel" role="dialog" aria-label="Music Together">
      {together.connecting ? (
        <div class="busy" role="status">
          <span class="spinner" aria-hidden="true" />
          {/* PeerJS may take a while (or never answer); stopping drops the attempt. */}
          <button type="button" class="button small" onClick={() => together.stop()}>
            {t("plugins.music-together.ui.cancel", "Cancel")}
          </button>
        </div>
      ) : mode === "disconnected" ? (
        <Start {...props} />
      ) : (
        <Connected {...props} />
      )}
      <Diagnostics {...props} />
      <button type="button" class="close" aria-label={t("plugins.music-together.ui.close", "Close")} onClick={onClose}>
        <CloseIcon />
      </button>
    </div>
  );
}

function Start({ together, t, name, setName, copy }: PanelProps) {
  const [hostId, setHostId] = useState("");
  return (
    <>
      <header class="intro">
        <span class="badge-icon" aria-hidden="true">
          <PeopleIcon />
        </span>
        <div>
          <h2>{t("plugins.music-together.name", "Music Together")}</h2>
          <p>
            {t(
              "plugins.music-together.description",
              "Share a playlist with others. When the host plays a song, everyone else will hear the same song",
            )}
          </p>
        </div>
      </header>
      <label class="field">
        <span>{t("plugins.music-together.settings.displayName.label", "Your name")}</span>
        <input value={name} maxLength={32} onChange={(e) => setName(e.currentTarget.value.trim())} />
      </label>
      <button
        type="button"
        class="button primary wide"
        onClick={async () => {
          // As pear-desktop: hosting copies the id to share.
          if (await together.host()) copy(together.id);
        }}
      >
        {t("plugins.music-together.menu.host", "Music Together Host")}
      </button>
      <div class="divider">
        <span>{t("plugins.music-together.menu.join", "Join Music Together")}</span>
      </div>
      <form
        class="row"
        onSubmit={(e) => {
          e.preventDefault();
          void together.join(hostId);
        }}
      >
        <input
          class="code-input"
          placeholder={t("plugins.music-together.dialog.enter-host", "Enter Host ID")}
          aria-label={t("plugins.music-together.dialog.enter-host", "Enter Host ID")}
          value={hostId}
          onInput={(e) => setHostId(e.currentTarget.value)}
        />
        <button type="submit" class="button" disabled={!hostId.trim()}>
          {t("plugins.music-together.ui.join", "Join")}
        </button>
      </form>
    </>
  );
}

function Connected({ together, t, copy }: PanelProps) {
  const host = together.mode === "host";
  const users = Object.values(together.profiles);
  return (
    <>
      <div class="status">
        <span class={`live${host ? "" : " guest"}`}>
          <i />
          {host
            ? t("plugins.music-together.menu.status.host", "Connected as Host")
            : t("plugins.music-together.menu.status.guest", "Connected as Guest")}
        </span>
      </div>
      {host && (
        <div class="code-card">
          <span class="label">{t("plugins.music-together.menu.click-to-copy-id", "Copy Host ID")}</span>
          <div class="code-row">
            <code class="host-id">{together.id}</code>
            <button type="button" class="button small" onClick={() => copy(together.id)}>
              {t("plugins.music-together.menu.click-to-copy-id", "Copy Host ID")}
            </button>
          </div>
        </div>
      )}
      <div class="field">
        <span>{t("plugins.music-together.menu.set-permission", "Change Control Permission")}</span>
        {host ? (
          <div class="segmented" role="radiogroup">
            {PERMISSIONS.map((permission) => (
              <button
                type="button"
                role="radio"
                aria-checked={together.permission === permission}
                title={together.permissionLabel(permission)}
                onClick={() => void together.setPermission(permission)}
              >
                {t(`plugins.music-together.settings.defaultPermission.options.${permission}`, permission)}
              </button>
            ))}
          </div>
        ) : null}
        <p class="hint">{together.permissionLabel(together.permission)}</p>
      </div>
      <div class="field">
        <span>{t("plugins.music-together.menu.connected-users", "Connected Users")}</span>
        {users.length === 0 ? (
          <p class="hint">{t("plugins.music-together.menu.empty-user", "No connected users")}</p>
        ) : (
          <ul class="people">
            {users.map((user) => (
              <User user={user} host={user.id === (host ? together.id : undefined)} />
            ))}
          </ul>
        )}
      </div>
      <button type="button" class="button danger wide" onClick={() => together.stop()}>
        {host
          ? t("plugins.music-together.menu.close", "Close Music Together")
          : t("plugins.music-together.menu.disconnect", "Disconnect Music Together")}
      </button>
    </>
  );
}

const CHECK_ORDER: readonly CheckId[] = ["signaling", "stun", "turn", "nat"];

const CHECK_LABEL: Record<CheckId, string> = {
  signaling: "Signaling server",
  stun: "Direct connection (STUN)",
  turn: "Relay fallback (TURN)",
  nat: "Network type (NAT)",
};

const NAT_LABEL: Record<NatType, string> = {
  open: "Open / cone (direct works)",
  symmetric: "Symmetric (relay required)",
  blocked: "UDP or STUN blocked",
  unknown: "Undetermined",
};

const VERDICT_TEXT: Record<DiagnosticResult["verdict"], string> = {
  good: "Direct connections should work on this network.",
  relay: "Direct connections may fail here; a relay will be used (works, but adds latency).",
  blocked: "This network will likely block Music Together. Try another network or a VPN.",
  limited: "Couldn't fully determine this network. Direct connections may still work; if they fail, try another network.",
  "no-signaling": "Can't reach the Music Together server. Check your firewall or internet connection.",
};

/** The diagnostics card: runs on open, fills each row as its check resolves. */
function Diagnostics({ iceServerEntries, copyDiagnostics, t }: PanelProps) {
  const [open, setOpen] = useState(false);
  return (
    <section class="diagnostics">
      <button type="button" class="button wide" aria-expanded={open} onClick={() => setOpen(!open)}>
        {open
          ? t("plugins.music-together.menu.diagnostics.title", "Connection diagnostics")
          : t("plugins.music-together.menu.diagnostics.test", "Test connection")}
      </button>
      {open && <DiagnosticsRun entries={iceServerEntries} t={t} copyDiagnostics={copyDiagnostics} />}
    </section>
  );
}

function DiagnosticsRun({
  entries,
  t,
  copyDiagnostics,
}: {
  entries: readonly string[];
  t: Translate;
  copyDiagnostics(text: string): void;
}) {
  const [checks, setChecks] = useState<Partial<Record<CheckId, DiagnosticCheck>>>({});
  const [result, setResult] = useState<DiagnosticResult | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const serversKey = entries.join("\n");

  useEffect(() => {
    const controller = new AbortController();
    setChecks({});
    setResult(null);
    setFailed(false);
    runDiagnostics(
      parseIceServers(serversKey.split("\n")),
      (check) => {
        if (!controller.signal.aborted) setChecks((current) => ({ ...current, [check.id]: check }));
      },
      controller.signal,
    ).then(
      (next) => {
        if (!controller.signal.aborted) setResult(next);
      },
      () => {
        if (!controller.signal.aborted) setFailed(true);
      },
    );
    return () => controller.abort();
  }, [serversKey, attempt]);

  return (
    <div class="diagnostics-body">
      {CHECK_ORDER.map((id) => {
        const check = checks[id];
        return (
          <div class="diagnostics-row" key={id}>
            <span class={`dot${check ? ` ${check.status}` : ""}`} aria-hidden="true" />
            <span class="diagnostics-label">{t(`plugins.music-together.menu.diagnostics.check.${id}`, CHECK_LABEL[id])}</span>
            <span class="diagnostics-detail">
              {check ? diagnosticsDetail(check, t) : t("plugins.music-together.menu.diagnostics.running", "Running checks…")}
            </span>
          </div>
        );
      })}
      {failed ? (
        <p class="message">
          {t("plugins.music-together.menu.diagnostics.verdict.error", "Diagnostics failed to run. Check the console for details.")}
        </p>
      ) : result ? (
        <p class="diagnostics-verdict">
          {t(`plugins.music-together.menu.diagnostics.verdict.${result.verdict}`, VERDICT_TEXT[result.verdict])}
        </p>
      ) : null}
      <div class="row">
        <button type="button" class="button small" onClick={() => setAttempt(attempt + 1)}>
          {t("plugins.music-together.menu.diagnostics.run-again", "Run again")}
        </button>
        <button type="button" class="button small" disabled={!result} onClick={() => result && copyDiagnostics(result.summary)}>
          {t("plugins.music-together.menu.diagnostics.copy", "Copy summary")}
        </button>
      </div>
    </div>
  );
}

function diagnosticsDetail(check: DiagnosticCheck, t: Translate) {
  const failure = check.detail
    ? t("plugins.music-together.menu.diagnostics.detail.check-error", "Check failed: {{reason}}", { reason: check.detail })
    : undefined;
  switch (check.id) {
    case "signaling":
      return check.status === "pass"
        ? t("plugins.music-together.menu.diagnostics.detail.signaling-ok", "Reachable")
        : t("plugins.music-together.menu.diagnostics.detail.signaling-fail", "Unreachable ({{reason}})", {
            reason: check.detail ?? "unknown",
          });
    case "stun":
      if (check.status === "pass") {
        return check.detail
          ? t("plugins.music-together.menu.diagnostics.detail.public-ip", "Public address: {{ip}}", { ip: check.detail })
          : t("plugins.music-together.menu.diagnostics.detail.stun-ok", "Public address found");
      }
      return failure ?? t("plugins.music-together.menu.diagnostics.detail.stun-fail", "No public address (UDP/STUN blocked)");
    case "turn":
      return check.status === "pass"
        ? t("plugins.music-together.menu.diagnostics.detail.turn-ok", "Relay reachable")
        : (failure ?? t("plugins.music-together.menu.diagnostics.detail.turn-fail", "Relay unreachable"));
    case "nat":
      return t(`plugins.music-together.menu.diagnostics.nat.${check.detail}`, NAT_LABEL[(check.detail as NatType) ?? "unknown"]);
  }
}

function User({ user, host }: { user: Profile; host: boolean }) {
  return (
    <li>
      <img class="avatar" src={user.thumbnail} alt="" />
      <span class="name">{user.name}</span>
      {host && <span class="tag host">host</span>}
    </li>
  );
}

const Svg = ({ children }: { children: ComponentChildren }) => (
  <svg viewBox="0 -960 960 960" width="24" height="24" fill="currentColor" aria-hidden="true">
    {children}
  </svg>
);

// Material Symbols "groups", as upstream.
const PeopleIcon = () => (
  <Svg>
    <path d="M0-240v-63q0-43 44-70t116-27q13 0 25 .5t23 2.5q-14 21-21 44t-7 48v65H0Zm240 0v-65q0-32 17.5-58.5T307-410q32-20 76.5-30t96.5-10q53 0 97.5 10t76.5 30q32 20 49 46.5t17 58.5v65H240Zm540 0v-65q0-26-6.5-49T754-397q11-2 22.5-2.5t23.5-.5q72 0 116 26.5t44 70.5v63H780Zm-455-80h311q-10-20-55.5-35T480-370q-55 0-100.5 15T325-320ZM160-440q-33 0-56.5-23.5T80-520q0-34 23.5-57t56.5-23q34 0 57 23t23 57q0 33-23 56.5T160-440Zm640 0q-33 0-56.5-23.5T720-520q0-34 23.5-57t56.5-23q34 0 57 23t23 57q0 33-23 56.5T800-440Zm-320-40q-50 0-85-35t-35-85q0-51 35-85.5t85-34.5q51 0 85.5 34.5T600-600q0 50-34.5 85T480-480Zm0-80q17 0 28.5-11.5T520-600q0-17-11.5-28.5T480-640q-17 0-28.5 11.5T440-600q0 17 11.5 28.5T480-560Zm1 240Zm-1-280Z" />
  </Svg>
);

const CloseIcon = () => (
  <Svg>
    <path d="m256-200-56-56 224-224-224-224 56-56 224 224 224-224 56 56-224 224 224 224-56 56-224-224-224 224Z" />
  </Svg>
);
