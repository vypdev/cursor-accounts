import { Adapter } from '../proxy/Adapter';

export function execute(adapter: Adapter): string {
  return adapter.name;
}
