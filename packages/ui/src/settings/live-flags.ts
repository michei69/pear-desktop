// The page runtime's live flag API: it applies an override without a restart and
// keeps it through later EXPERIMENT_FLAGS payloads. Absent in the standalone
// settings window, where only the stored overrides are editable.

import type { LiveFeatureFlags } from "@pear/sdk/protocol";

type FlagWindow = Window & { __pearFeatureFlags?: LiveFeatureFlags };

export const liveFeatureFlags = (): LiveFeatureFlags | undefined => (window as FlagWindow).__pearFeatureFlags;
