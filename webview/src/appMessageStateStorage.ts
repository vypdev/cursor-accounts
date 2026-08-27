import type { ToWebviewMessage } from './types';
import type { AppMessageState } from './appMessageStateTypes';

export type AppStorageMessage = Extract<
  ToWebviewMessage,
  { type: 'storageInfo' | 'storageCleanupResult' }
>;

export function applyStorageMessage(
  state: AppMessageState,
  message: AppStorageMessage,
  storageProfileId: string | null
): AppMessageState {
  if (message.type === 'storageInfo') {
    return message.data.profileId === storageProfileId
      ? { ...state, storageInfo: message.data }
      : state;
  }

  if (!storageProfileId) {
    return state;
  }
  return message.data.success
    ? {
        ...state,
        lastCleanupResult: message.data,
        error: null,
        success: message.data.message,
      }
    : {
        ...state,
        lastCleanupResult: message.data,
        error: message.data.message,
        success: null,
      };
}
