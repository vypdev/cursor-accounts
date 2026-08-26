/**
 * Stable configuration for Cursor protobuf extraction.
 */

export const OUTPUT_PACKAGES = Object.freeze([
  Object.freeze({
    packageId: 'agent.v1',
    fileName: 'agent.proto',
    goPackage: 'cursor/gen/agent/v1;agentv1',
  }),
  Object.freeze({
    packageId: 'aiserver.v1',
    fileName: 'aiserver.proto',
    goPackage: 'cursor/gen/aiserver/v1;aiserverv1',
  }),
]);

/**
 * Services whose methods are missing from extensionHost descriptors.
 *
 * These entries are patched at emit time so known Connect paths can still be
 * decoded when Cursor ships an empty minified service method map.
 */
export const EMPTY_SERVICE_RPC_PATCHES = Object.freeze({
  'aiserver.v1.BidiService': Object.freeze([
    Object.freeze({
      name: 'BidiAppend',
      in: 'aiserver.v1.BidiAppendRequest',
      out: 'aiserver.v1.BidiAppendResponse',
    }),
  ]),
});

export const SCALAR_TYPES = new Map([
  [1, 'double'],
  [2, 'float'],
  [3, 'int64'],
  [4, 'uint64'],
  [5, 'int32'],
  [6, 'fixed64'],
  [7, 'fixed32'],
  [8, 'bool'],
  [9, 'string'],
  [12, 'bytes'],
  [13, 'uint32'],
  [15, 'sfixed32'],
  [16, 'sfixed64'],
  [17, 'sint32'],
  [18, 'sint64'],
]);
