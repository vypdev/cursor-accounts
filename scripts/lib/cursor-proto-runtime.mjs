import path from 'node:path';
import { fileURLToPath } from 'node:url';
import protobuf from 'protobufjs';

const SCRIPT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIRECTORY, '../..');

/** Protobuf definitions shared by the traffic analysis and verification CLIs. */
export const CURSOR_PROTO_FILES = [
  path.join(REPO_ROOT, 'proto', 'agent', 'v1', 'agent.proto'),
  path.join(REPO_ROOT, 'proto', 'aiserver', 'v1', 'aiserver.proto'),
];

/** Load the Cursor protobuf definitions used by capture tooling. */
export function loadCursorProtos() {
  return protobuf.load(CURSOR_PROTO_FILES);
}
