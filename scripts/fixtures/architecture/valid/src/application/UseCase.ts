import type { Entity } from '../domain/Entity';

export function execute(entity: Entity): string {
  return entity.id;
}
