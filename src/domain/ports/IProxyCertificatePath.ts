/** Resolves the currently available managed CA certificate path. */
export interface IProxyCertificatePath {
  getCertificatePath(): Promise<string | null>;
}
