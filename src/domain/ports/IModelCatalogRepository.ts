import type { ModelCatalogEntry } from '@cursor-accounts/types';

/**
 * Port for accessing Cursor's model catalog from state.vscdb.
 */
export interface IModelCatalogRepository {
  /**
   * Load model catalog from state database.
   * @param stateDbPath Path to state.vscdb file
   * @param extensionPath Extension path for sqlite3 binary
   * @returns Parsed model catalog entries with variants
   */
  loadModelCatalog(
    stateDbPath: string,
    extensionPath: string
  ): Promise<ModelCatalogEntry[]>;

  /**
   * Load raw applicationUser JSON from state database.
   * Used for toggle state parsing alongside the catalog.
   */
  loadModelCatalogRaw(
    stateDbPath: string,
    extensionPath: string
  ): Promise<string | null>;
}
