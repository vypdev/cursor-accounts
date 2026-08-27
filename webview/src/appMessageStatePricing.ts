import type { ToWebviewMessage } from './types';
import type { AppMessageState } from './appMessageStateTypes';

export type AppPricingMessage = Extract<
  ToWebviewMessage,
  { type: 'modelPricing' | 'modelPricingError' }
>;

export function applyPricingMessage(
  state: AppMessageState,
  message: AppPricingMessage
): AppMessageState {
  if (message.type === 'modelPricing') {
    return {
      ...state,
      modelPricingData: message.data,
      enabledModelPricingData: message.enabledModels ?? [],
      pricingLoading: false,
      showPricesModal: true,
    };
  }

  return {
    ...state,
    pricingLoading: false,
    showPricesModal: false,
    error: message.error,
  };
}
