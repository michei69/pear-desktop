/**
 * What the published `flags.json` says about one feature flag. Every field but
 * the name is optional in practice: a flag the file does not describe still
 * gets a row, just without a description, a family or a restart requirement.
 */
export interface FlagMetadata {
  /** Shown under the flag's name, like any other setting's description. */
  description?: string;
  /** Whether a change needs a restart to take effect. */
  requires_restart: boolean;
  /** Group the flag belongs to, shown as a tag. */
  family: string;
}

/** The published metadata, keyed by flag name. */
export type FlagMetadataMap = Record<string, FlagMetadata>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * The published file is remote input, so only entries with the shape the
 * settings UI reads are kept; a stray object would otherwise render as one.
 */
export const sanitizeFlagMetadata = (raw: unknown): FlagMetadataMap => {
  if (!isRecord(raw)) return {};

  const out: FlagMetadataMap = {};
  for (const [name, entry] of Object.entries(raw)) {
    if (!isRecord(entry)) continue;

    out[name] = {
      description:
        typeof entry.description === 'string' ? entry.description : undefined,
      requires_restart: entry.requires_restart === true,
      family: typeof entry.family === 'string' ? entry.family : '',
    } satisfies FlagMetadata;
  }
  return out;
};
