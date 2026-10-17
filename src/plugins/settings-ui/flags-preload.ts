import { webFrame } from 'electron';

import * as config from '@/config';
import {
  isPerformancePartEnabled,
  performanceModeOverrides,
} from '@/providers/performance-mode';

import {
  installFeatureFlags,
  type FeatureFlagOverrides,
} from './injectors/flags';

/**
 * Hands the saved feature-flag overrides to the page before its own scripts run:
 * the config YouTube Music builds `window.ytcfg` from decides how it starts up, so
 * patching any later is too late for some flags.
 */
export const startFeatureFlags = () => {
  // The standalone settings window has no player page to patch.
  if (new URLSearchParams(window.location.search).has('settings')) return;

  const saved = (config.get('options.featureFlags') ??
    {}) as FeatureFlagOverrides;
  const overrides = isPerformancePartEnabled('flags')
    ? performanceModeOverrides(saved, config.get('options.performanceMode'))
    : saved;

  return webFrame.executeJavaScript(
    `(${installFeatureFlags.toString()})(${JSON.stringify(overrides)}); 0`,
  );
};
