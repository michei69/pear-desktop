declare module "virtual:pear/page-runtime" {
  const code: string;
  export default code;
}

declare module "virtual:pear/host-plugins" {
  import type { AnyPlugin } from "@pear/sdk";
  const plugins: readonly AnyPlugin[];
  export default plugins;
}

declare module "virtual:pear/i18n" {
  /** A translation file's own `language` block. */
  export interface LanguageMeta {
    code: string;
    name: string;
    "local-name": string;
    [key: string]: string;
  }
  /** Every language code in src/i18n/resources, sorted. */
  export const languageCodes: readonly string[];
  export const languageMeta: Readonly<Record<string, LanguageMeta>>;
  /** The resources of these languages, by code; unknown codes are skipped. */
  export function loadLanguageResources(codes: readonly string[]): Promise<Record<string, Record<string, unknown>>>;
}

declare module "virtual:pear/settings-app" {
  /** The standalone settings window's script, as an IIFE string. */
  const code: string;
  export default code;
}

/** A CSS file's contents, for the host to write into a theme folder. */
declare module "*.css?inline" {
  const css: string;
  export default css;
}
