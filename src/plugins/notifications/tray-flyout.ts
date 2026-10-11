import { spawn, type ChildProcess } from 'node:child_process';

export type FlyoutRect = {
  left: number;
  // Top edge of the flyout window; the square starts a little below it (see probe).
  top: number;
};

// The shell sizes the flyout (the "^" chevron) window to however many icons are
// hidden, so its rectangle is the only honest answer to how far above the
// taskbar it reaches; a hardcoded band height breaks with a different icon
// count. The window is taller than the square it draws, and no probe sees that
// margin (DWM and hit-tests report the whole rectangle), so the popup adds it back.
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

# How far the flyout window reaches, for however many icon rows it holds. Two
# sources: the window rectangle, and the frame bounds DWM draws it in.
# Whichever sits lower wins, so a shadow frame cannot be read as reach.
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

// Parses "left,top,right,bottom" in physical pixels, or null for anything else.
export const parseFlyoutLine = (line: string): FlyoutRect | null => {
  const parts = line.split(',');
  if (parts.length !== 4) return null;

  const numbers = parts.map(Number);
  if (numbers.some(Number.isNaN)) return null;

  const [left, top] = numbers;
  return { left, top };
};

// Streams the flyout rectangle until the returned stop function is called.
// Only the last rectangle matters: it does not move while the flyout is hidden.
// The helper is spawned once (a 150ms poll, not a process per hover) and
// restarted if it dies, so the popup never falls back to the position this fixes.
export const watchTrayFlyout = (
  onRect: (rect: FlyoutRect) => void,
): (() => void) => {
  if (process.platform !== 'win32') return () => {};

  let child: ChildProcess | null = null;
  let stopped = false;
  let restartTimer: ReturnType<typeof setTimeout> | null = null;

  const start = () => {
    const spawned = spawn(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-EncodedCommand',
        Buffer.from(PROBE_SCRIPT, 'utf16le').toString('base64'),
      ],
      { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] },
    );
    child = spawned;

    // A missing PowerShell is not fatal: without a rectangle the popup anchors
    // on the tray icon.
    spawned.on('error', () => {});
    spawned.on('close', () => {
      child = null;
      if (!stopped) restartTimer = setTimeout(start, 1000);
    });

    let buffered = '';
    spawned.stdout.setEncoding('utf8');
    spawned.stdout.on('data', (chunk: string) => {
      buffered += chunk;
      const lines = buffered.split('\n');
      buffered = lines.pop() ?? '';

      for (const line of lines) {
        const rect = parseFlyoutLine(line.trim());
        if (rect) onRect(rect);
      }
    });
  };

  start();

  return () => {
    stopped = true;
    if (restartTimer) clearTimeout(restartTimer);
    child?.kill();
  };
};
