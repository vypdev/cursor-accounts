/** Port for storing extension-owned secrets without exposing the backing API. */
export interface ISecretStorage {
  get(key: string): PromiseLike<string | undefined>;
  store(key: string, value: string): PromiseLike<void>;
}
