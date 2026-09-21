import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import is from 'electron-is';

import { LoggerPrefix } from '@/utils';

import { shortcutIconPath, useYtmIcons } from './app-icon';

const execFileAsync = promisify(execFile);

// Windows shortcuts (.lnk) carry their own icon location, which is the one
// place the in-app icon option can reach outside the app. The exe's own icon
// is baked in at build time and no runtime toggle can touch it.
//
// The icons are read and written through the WScript.Shell COM object (driven
// by PowerShell) so no native module is needed. Only shortcuts whose target is
// this executable are touched, and only while their icon is still the default
// (unset, ",0", or the installer's own exe path) or already ours, so a
// manually chosen icon is never overwritten.
//
// The script is passed through -Command and deliberately contains no double
// quotes, so Node's argv quoting cannot mangle it.
//
// Covers the current user's shortcuts: the desktop (via WScript's
// SpecialFolders, so a redirected/OneDrive desktop still resolves), the public
// desktop, the start menu programs folder and taskbar pins. The all-users
// start menu lives in ProgramData and would need elevation. Start menu tiles,
// search results and "Apps & features" keep the exe's baked icon, and explorer
// caches shortcut icons, so an explorer restart may be needed before a change
// is visible.
const SYNC_SCRIPT = `
$ErrorActionPreference = 'SilentlyContinue'
$exe = $env:PM_SHORTCUT_EXE
$icon = $env:PM_SHORTCUT_ICON
$ours = $env:PM_SHORTCUT_ICON_MATCH

$shell = New-Object -ComObject WScript.Shell

# WScript knows the real desktop (it follows redirection, e.g. OneDrive)
$desktop = ''
try { $desktop = $shell.SpecialFolders('Desktop') } catch { }
if ([string]::IsNullOrEmpty($desktop)) { $desktop = $env:USERPROFILE + '\\Desktop' }

$roots = @(
  $desktop,
  $(if ($env:PUBLIC) { Join-Path $env:PUBLIC 'Desktop' }),
  $(if ($env:APPDATA) { Join-Path $env:APPDATA 'Microsoft\\Windows\\Start Menu\\Programs' }),
  $(if ($env:APPDATA) { Join-Path $env:APPDATA 'Microsoft\\Internet Explorer\\Quick Launch\\User Pinned\\TaskBar' })
) | Where-Object { -not [string]::IsNullOrEmpty($_) }

$changed = 0
foreach ($root in $roots) {
  if (-not (Test-Path -LiteralPath $root)) { continue }

  Get-ChildItem -LiteralPath $root -Filter *.lnk -Recurse -Force | ForEach-Object {
    try {
      $lnk = $shell.CreateShortcut($_.FullName)
      if ([string]::IsNullOrEmpty($lnk.TargetPath)) { return }
      if ($lnk.TargetPath -ine $exe) { return }

      $current = $lnk.IconLocation
      $currentPath = ($current -split ',')[0]
      # Empty and ,0 both mean the shortcut is still on the exe icon, and the
      # installer writes the exe path itself; all three are fair game.
      $isDefault = [string]::IsNullOrEmpty($currentPath) -or ($currentPath -ieq $exe)
      $isOurs = $currentPath -ieq $ours

      if ([string]::IsNullOrEmpty($icon)) {
        # Option off: only undo what we set, leave everything else alone.
        if (-not $isOurs) { return }
        $next = ''
      } else {
        if (-not ($isDefault -or $isOurs)) { return }
        $next = $icon + ',0'
      }

      if ($next -eq $current) { return }
      # '' and ',0' are the same state, so resets are a no-op for them.
      if ([string]::IsNullOrEmpty($next) -and [string]::IsNullOrEmpty($currentPath)) { return }

      try {
        $lnk.IconLocation = $next
        $lnk.Save()
        $changed++
      } catch {
        [Console]::Error.WriteLine('Shortcut icon save failed: ' + $_.Exception.Message)
      }
    } catch {
      # One unreadable shortcut must not stop the rest.
      [Console]::Error.WriteLine('Shortcut skipped: ' + $_.Exception.Message)
    }
  }
}

Write-Output $changed
`;

/**
 * Keeps the app's own shortcuts carrying the icon matching the current icon
 * option, or resets them to the exe icon when the option is off. No-op off
 * Windows; writes only when a shortcut actually differs, so it is safe to run
 * on every launch.
 */
export const syncShortcutIcons = async () => {
  if (!is.windows()) {
    return;
  }

  const ours = shortcutIconPath();
  const icon = useYtmIcons() ? ours : '';

  try {
    const { stdout } = await execFileAsync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', SYNC_SCRIPT],
      {
        env: {
          ...process.env,
          PM_SHORTCUT_EXE: process.execPath,
          PM_SHORTCUT_ICON: icon,
          PM_SHORTCUT_ICON_MATCH: ours,
        },
        timeout: 15_000,
        windowsHide: true,
      },
    );

    const changed = Number.parseInt(stdout.trim(), 10);
    if (changed > 0) {
      console.log(LoggerPrefix, `Shortcut icons updated (${changed})`);
    }
  } catch (error) {
    console.warn(LoggerPrefix, 'Failed to update shortcut icons', error);
  }
};
