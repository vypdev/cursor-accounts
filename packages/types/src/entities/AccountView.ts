/** Live API account data for webview display (not persisted). */
export interface ProfileAccountView {
  profileId: string;
  accountName?: string;
  pictureUrl?: string;
  error?: string;
  fetchedAt: number;
}
