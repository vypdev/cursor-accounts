import type { IModelCatalogRepository } from '../domain/ports/IModelCatalogRepository';
import type { ModelCatalogEntry } from '@cursor-accounts/types';
import { readItemTableKey, APPLICATION_USER_KEY } from './stateDbReader';
import { parseModelCatalog } from './modelConfigResolver';

/**
 * Repository for loading Cursor model catalog from state.vscdb.
 * Reuses existing state database reader infrastructure.
 */
export class StateDbModelCatalogRepository implements IModelCatalogRepository {
  async loadModelCatalog(
    stateDbPath: string,
    extensionPath: string
  ): Promise<ModelCatalogEntry[]> {
    const rawCatalog = await readItemTableKey(
      stateDbPath,
      APPLICATION_USER_KEY,
      extensionPath
    );

    return parseModelCatalog(rawCatalog);
  }

  async loadModelCatalogRaw(
    stateDbPath: string,
    extensionPath: string
  ): Promise<string | null> {
    return await readItemTableKey(
      stateDbPath,
      APPLICATION_USER_KEY,
      extensionPath
    );
  }
}
