/** The settings buttons pass their intent to the page, which owns the lists and the matches. */
export interface SkipAiSlopCommands {
  /** Downloads the community list with the host's network stack. */
  fetchList(): Promise<unknown>;
  refreshList(): Promise<string>;
  clearCache(): Promise<string>;
  showRecent(): Promise<string>;
  /** Allows / forgets a recent match by id; without one, the newest entry the summary lists. */
  allowRecent(id?: string): Promise<string>;
  removeRecent(id?: string): Promise<string>;
  searchList(): Promise<string>;
  /** Allows the best community-list match for the search text. */
  allowListMatch(): Promise<string>;
}
