import type { YTPlayerApi, YTPlayerAudioTrack } from "@pear/sdk";

// The player's track objects are protobuf-backed and their accessors differ
// between builds, so every read tries the three shapes pear-desktop did.

type RawAudioTrack = YTPlayerAudioTrack & {
  Pb?: { id?: string; name?: string; isDefault?: boolean; isAutoDubbed?: boolean };
};

const raw = (track: YTPlayerAudioTrack) => track as RawAudioTrack;

/** The track's stable id, however this player build spells it. */
export function trackId(track: YTPlayerAudioTrack): string {
  return track.getLanguageInfo?.()?.getId?.() || raw(track).Pb?.id || track.id || "";
}

/** What to call the track in the picker. */
export function trackName(track: YTPlayerAudioTrack): string {
  return track.getLanguageInfo?.()?.getName?.() || raw(track).Pb?.name || track.id || "";
}

export function isAutoDubbed(track: YTPlayerAudioTrack): boolean {
  return track.getLanguageInfo?.()?.getIsAutoDubbed?.() ?? raw(track).Pb?.isAutoDubbed ?? track.isAutoDubbed?.() ?? false;
}

export function isDefaultTrack(track: YTPlayerAudioTrack): boolean {
  return track.getLanguageInfo?.()?.getIsDefault?.() ?? raw(track).Pb?.isDefault ?? false;
}

/** The track the video was uploaded with: the default one, and not machine-dubbed. */
export function isOriginalTrack(track: YTPlayerAudioTrack): boolean {
  return !isAutoDubbed(track) && isDefaultTrack(track);
}

/** The original track, or failing that the first one that is not an auto-dub. */
export function findOriginalTrack(tracks: readonly YTPlayerAudioTrack[]): YTPlayerAudioTrack | undefined {
  return tracks.find(isOriginalTrack) ?? tracks.find((track) => !isAutoDubbed(track));
}

/**
 * The track to play: the picked one when this video offers it (ids survive
 * across videos), otherwise the original while `preferOriginal` is on.
 */
export function desiredTrack(
  tracks: readonly YTPlayerAudioTrack[],
  configuredId: string,
  preferOriginal: boolean,
): YTPlayerAudioTrack | undefined {
  if (configuredId) {
    const picked = tracks.find((track) => trackId(track) === configuredId);
    if (picked) return picked;
  }
  return preferOriginal ? findOriginalTrack(tracks) : undefined;
}

/**
 * Which picker choice is the current state: 0 for Automatic (also when the
 * player cannot say which track is playing), otherwise the track's position
 * plus one. The picker must never fall back to the first track.
 */
export function pickerIndex(tracks: readonly YTPlayerAudioTrack[], currentId: string): number {
  const at = tracks.findIndex((track) => trackId(track) === currentId);
  return at < 0 ? 0 : at + 1;
}

/** A track row of the picker: its choice index (1-based; 0 is Automatic) and whether it plays now. */
export interface TrackChoice {
  index: number;
  label: string;
  checked: boolean;
}

/** The picker rows' state, read from the player each time the list opens. */
export interface PickerChoices {
  /** Whether no playing track matches the video's tracks, so Automatic is the state. */
  automatic: boolean;
  tracks: TrackChoice[];
}

export function pickerChoices(tracks: readonly YTPlayerAudioTrack[], currentId: string): PickerChoices {
  const current = pickerIndex(tracks, currentId);
  return {
    automatic: current === 0,
    tracks: tracks.map((track, at) => ({ index: at + 1, label: trackName(track), checked: current === at + 1 })),
  };
}

/** The video's tracks; a player without the selector answers an empty list. */
export function readTracks(api: YTPlayerApi): YTPlayerAudioTrack[] {
  try {
    return api.getAvailableAudioTracks?.() ?? [];
  } catch {
    return [];
  }
}

/** The id of the playing track, empty when the player cannot say. */
export function readCurrentTrackId(api: YTPlayerApi): string {
  try {
    const track = api.getAudioTrack?.();
    return track ? trackId(track) : "";
  } catch {
    return "";
  }
}
