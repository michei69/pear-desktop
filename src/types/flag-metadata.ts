/**
 * What the published `flags.json` says about one feature flag. Only the name is
 * required: a flag the file does not describe still gets a row, just without a
 * description, a family or a restart requirement.
 */
export interface FlagMetadata {
  /** Shown under the flag's name. */
  description?: string;
  /** Whether a change needs a restart. */
  requires_restart: boolean;
  /** Group the flag belongs to, shown as a tag. */
  family: string;
}

/** The published metadata, keyed by flag name. */
export type FlagMetadataMap = Record<string, FlagMetadata>;

/**
 * The published file is remote input, so only entries shaped the way the
 * settings UI reads them are kept; a stray object would render as one.
 */
export const sanitizeFlagMetadata = (raw: unknown): FlagMetadataMap => {
  // Object.entries needs a non-null object; the field reads below narrow each
  // value on its own.
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};

  const out: FlagMetadataMap = {};
  for (const [name, entry] of Object.entries(raw as Record<string, unknown>)) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const fields = entry as Record<string, unknown>;

    out[name] = {
      description:
        typeof fields.description === 'string' ? fields.description : undefined,
      requires_restart: fields.requires_restart === true,
      family: typeof fields.family === 'string' ? fields.family : '',
    } satisfies FlagMetadata;
  }
  return out;
};
