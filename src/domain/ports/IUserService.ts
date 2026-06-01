/** Minimal account metadata returned by the user API. */
export interface UserAccountInfo {
  name?: string;
  picture?: string;
  email?: string;
}

/** Port for fetching live account metadata from Cursor auth APIs. */
export interface IUserService {
  fetchAccount(
    accessToken: string,
    signal?: AbortSignal
  ): Promise<UserAccountInfo>;
}
