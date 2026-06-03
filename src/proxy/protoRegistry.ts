import * as fs from 'fs';
import * as path from 'path';
import type { Root, Service, Type } from 'protobufjs';

export interface RpcTypeInfo {
  requestType: Type;
  responseType: Type;
}

let loadPromise: Promise<ProtoRegistry> | null = null;

/**
 * Resolve proto directory: extension cwd (forked proxy) or repo root in dev.
 */
export function resolveProtoDir(): string {
  const candidates = [
    path.join(process.cwd(), 'proto'),
    path.join(process.cwd(), 'out', 'proto'),
    path.resolve(__dirname, '../../proto'),
    path.resolve(__dirname, '../../../proto'),
  ];

  for (const dir of candidates) {
    const aiserver = path.join(dir, 'aiserver', 'v1', 'aiserver.proto');
    if (fs.existsSync(aiserver)) {
      return dir;
    }
  }

  return path.join(process.cwd(), 'proto');
}

export class ProtoRegistry {
  private root: Root | null = null;
  private readonly rpcMap = new Map<string, RpcTypeInfo>();

  async initialize(): Promise<void> {
    if (this.root) {
      return;
    }

    const protobuf = await import('protobufjs');
    const protoDir = resolveProtoDir();
    const files = [
      path.join(protoDir, 'agent', 'v1', 'agent.proto'),
      path.join(protoDir, 'aiserver', 'v1', 'aiserver.proto'),
    ];

    for (const file of files) {
      if (!fs.existsSync(file)) {
        throw new Error(`Proto file not found: ${file}`);
      }
    }

    this.root = await protobuf.load(files);
    this.buildRpcMap(protobuf.Service);
  }

  private buildRpcMap(ServiceCtor: typeof Service): void {
    if (!this.root) {
      return;
    }

    const visit = (obj: { nestedArray: unknown[] }): void => {
      for (const item of obj.nestedArray) {
        if (item instanceof ServiceCtor) {
          const svc = item as Service;
          for (const method of svc.methodsArray) {
            const serviceName = svc.fullName.replace(/^\./, '');
            const rpcPath = `/${serviceName}/${method.name}`;
            try {
              const requestType = this.root!.lookupType(method.requestType);
              const responseType = this.root!.lookupType(method.responseType);
              this.rpcMap.set(rpcPath, { requestType, responseType });
            } catch {
              // unresolved request/response in generated proto
            }
          }
        }
        if (
          item &&
          typeof item === 'object' &&
          'nestedArray' in item &&
          Array.isArray((item as { nestedArray: unknown[] }).nestedArray)
        ) {
          visit(item as { nestedArray: unknown[] });
        }
      }
    };

    visit(this.root as unknown as { nestedArray: unknown[] });
  }

  getRpcTypes(rpcPath: string): RpcTypeInfo | undefined {
    return this.rpcMap.get(rpcPath);
  }

  lookupMessageType(typeName: string): Type | null {
    if (!this.root) {
      return null;
    }
    try {
      return this.root.lookupType(typeName);
    } catch {
      return null;
    }
  }

  decode(type: Type, payload: Buffer): Record<string, unknown> {
    const message = type.decode(payload);
    return type.toObject(message, {
      longs: String,
      enums: String,
      bytes: String,
      defaults: false,
      arrays: true,
      objects: true,
      oneofs: true,
    }) as Record<string, unknown>;
  }

  getRpcPathCount(): number {
    return this.rpcMap.size;
  }
}

export async function getProtoRegistry(): Promise<ProtoRegistry> {
  if (!loadPromise) {
    loadPromise = (async () => {
      const registry = new ProtoRegistry();
      await registry.initialize();
      return registry;
    })();
  }
  return loadPromise;
}

export function resetProtoRegistryForTests(): void {
  loadPromise = null;
}
