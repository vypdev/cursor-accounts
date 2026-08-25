import type { Contract } from '@fixture/contracts';

export function execute(contract: Contract): string {
  return contract.id;
}
