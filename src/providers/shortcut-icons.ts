import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import is from 'electron-is';

import { LoggerPrefix } from '@/utils';

import { shortcutIconPath, useYtmIcons } from './app-icon';

const execFileAsync = promisify(execFile);

// Windows .lnk files carry their own icon location — the only way the in-app icon
// option reaches outside the app (the exe's icon is baked at build time). Read and
// written via the WScript.Shell COM object through PowerShell, so no native module;
// only shortcuts targeting this exe and still on the default or our icon are
// touched. Passed through -Command with no double quotes, so Node's argv quoting
// cannot mangle it. Covers the current user's desktop (SpecialFolders follows
// redirection, e.g. OneDrive), public desktop, start menu programs and taskbar
// pins; the all-users start menu is in ProgramData and needs elevation. Tiles,
// search results and "Apps & features" keep the baked icon, and explorer caches
// shortcut icons, so an explorer restart may be needed before a change shows.
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
 * Keeps the app's own shortcuts on the icon matching the current icon option,
 * or resets them to the exe icon when the option is off. No-op off Windows, and
 * writes only when a shortcut differs, so it is safe on every launch.
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
