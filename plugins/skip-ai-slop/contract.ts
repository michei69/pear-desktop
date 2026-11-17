/** The settings buttons pass their intent to the page, which owns the lists and the matches. */
export interface SkipAiSlopCommands {
  /** The two community sources the host downloads and the page merges. */
  fetchList(): Promise<{ blacklist: unknown; aislist: string }>;
  refreshList(): Promise<string>;
  clearCache(): Promise<string>;
  showRecent(): Promise<string>;
  /** Allows / forgets a recent match by id; without one, the newest entry the summary lists. */
  allowRecent(id?: string): Promise<string>;
  removeRecent(id?: string): Promise<string>;
}
