/** The InnerTube context the page reads, passed along so the host can send feedback. */
export interface FeedbackRequest {
  token: string;
  context: unknown;
  key: string;
}

export interface SkipAiSlopCommands {
  /** Downloads the community list with the host's network stack. */
  fetchList(): Promise<unknown>;
  feedback(request: FeedbackRequest): Promise<void>;
  /** The page owns the cache and the page's matches; the buttons ask it through these. */
  refreshList(): Promise<string>;
  clearCache(): Promise<string>;
  showRecent(): Promise<string>;
  searchList(): Promise<string>;
}
