// Windows only: where the notification-area overflow flyout (the "^" chevron)
// is, so the hover mini-player can sit above the icon inside it.
//
// The shell sizes the flyout window to however many icons are hidden, and DWM's
// frame differs from the rectangle hit-tests report, so the only honest answer
// comes from asking the shell: a small PowerShell probe streams the rectangle
// while the popup is up. Hardcoding the taskbar-height band breaks with a
// different icon count.

import { type ChildProcess, spawn } from "node:child_process";

export interface FlyoutRect {
  left: number;
  /** Top edge of the flyout window, in physical pixels. */
  top: number;
}

const PROBE_SCRIPT = `
Add-Type -Namespace Pear -Name TrayFlyout -MemberDefinition @'
[System.Runtime.InteropServices.DllImport("user32.dll")]
public static extern bool SetProcessDpiAwarenessContext(System.IntPtr value);
[System.Runtime.InteropServices.DllImport("user32.dll", CharSet = System.Runtime.InteropServices.CharSet.Unicode)]
public static extern System.IntPtr FindWindowW(string className, string windowName);
[System.Runtime.InteropServices.DllImport("user32.dll")]
public static extern bool IsWindowVisible(System.IntPtr hWnd);
[System.Runtime.InteropServices.DllImport("user32.dll")]
public static extern bool GetWindowRect(System.IntPtr hWnd, out RECT rect);
[System.Runtime.InteropServices.DllImport("dwmapi.dll")]
public static extern int DwmGetWindowAttribute(System.IntPtr hWnd, int attribute, out RECT rect, int size);
[System.Runtime.InteropServices.StructLayout(System.Runtime.InteropServices.LayoutKind.Sequential)]
public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
'@
try { [Pear.TrayFlyout]::SetProcessDpiAwarenessContext([System.IntPtr](-4)) | Out-Null } catch {}

# Whichever of the window rectangle and the DWM frame sits lower wins, so a
# shadow frame cannot be read as the square's reach.
function Get-FlyoutTop($h, $r) {
  try {
    $f = New-Object Pear.TrayFlyout+RECT
    if ([Pear.TrayFlyout]::DwmGetWindowAttribute($h, 9, [ref]$f, 16) -eq 0) { return [Math]::Max($r.Top, $f.Top) }
  } catch {}
  return $r.Top
}

$last = ''
while ($true) {
  $h = [Pear.TrayFlyout]::FindWindowW('NotifyIconOverflowWindow', $null)
  $r = New-Object Pear.TrayFlyout+RECT
  $line = 'none'
  if ($h -ne [System.IntPtr]::Zero -and [Pear.TrayFlyout]::IsWindowVisible($h) -and [Pear.TrayFlyout]::GetWindowRect($h, [ref]$r)) {
    $top = Get-FlyoutTop $h $r
    $line = "$($r.Left),$top,$($r.Right),$($r.Bottom)"
  }
  if ($line -ne $last) {
    [Console]::Out.WriteLine($line)
    [Console]::Out.Flush()
    $last = $line
  }
  Start-Sleep -Milliseconds 150
}
`;

/** Parses "left,top,right,bottom" in physical pixels, or null for anything else. */
export function parseFlyoutLine(line: string): FlyoutRect | null {
  const parts = line.split(",");
  if (parts.length !== 4) return null;
  const numbers = parts.map(Number);
  if (numbers.some(Number.isNaN)) return null;
  const [left, top] = numbers;
  return { left: left!, top: top! };
}

/**
 * Streams the flyout rectangle until the returned stop function is called.
 * The helper is spawned once (a 150ms poll, not a process per hover) and
 * restarted if it dies, so the popup keeps its anchor for the whole session.
 */
export function watchTrayFlyout(onRect: (rect: FlyoutRect) => void): () => void {
  if (process.platform !== "win32") return () => {};

  let child: ChildProcess | null = null;
  let stopped = false;
  let restartTimer: ReturnType<typeof setTimeout> | undefined;

  const start = () => {
    if (stopped) return;
    let spawned: ChildProcess;
    try {
      spawned = spawn(
        "powershell.exe",
        ["-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(PROBE_SCRIPT, "utf16le").toString("base64")],
        { windowsHide: true, stdio: ["ignore", "pipe", "ignore"] },
      );
    } catch {
      // No PowerShell: the popup falls back to the tray icon's own position.
      return;
    }
    child = spawned;
    // A missing PowerShell is not fatal: without a rectangle the popup anchors
    // on the tray icon.
    spawned.on("error", () => {});
    spawned.on("close", () => {
      if (child !== spawned) return;
      child = null;
      if (!stopped) restartTimer = setTimeout(start, 1000);
    });

    let buffered = "";
    spawned.stdout?.setEncoding("utf8");
    spawned.stdout?.on("data", (chunk: string) => {
      buffered += chunk;
      const lines = buffered.split("\n");
      buffered = lines.pop() ?? "";
      for (const line of lines) {
        const rect = parseFlyoutLine(line.trim());
        if (rect) onRect(rect);
      }
    });
  };

  start();

  return () => {
    stopped = true;
    clearTimeout(restartTimer);
    restartTimer = undefined;
    const running = child;
    child = null;
    running?.kill();
  };
}
