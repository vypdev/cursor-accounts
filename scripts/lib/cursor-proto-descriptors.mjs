import { OUTPUT_PACKAGES, SCALAR_TYPES } from './cursor-proto-config.mjs';

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * @param {string} fullTypeName
 * @param {string} packageId
 */
export function localTypeName(fullTypeName, packageId) {
  return fullTypeName.slice(packageId.length + 1).replace(/\./g, '_');
}

/**
 * Resolve a protobuf type reference within or across the extracted packages.
 *
 * @param {string} fullTypeName
 * @param {string} packageId
 */
export function fieldTypeRef(fullTypeName, packageId) {
  const pkg = fullTypeName.split('.').slice(0, 2).join('.');
  const local = localTypeName(fullTypeName, pkg);
  return pkg === packageId ? local : `${pkg}.${local}`;
}

/**
 * Extract the descriptor fragments emitted by @bufbuild/protobuf.
 *
 * @param {string} bundle
 * @param {ReadonlyArray<{ packageId: string }>} packages
 */
export function extractDescriptors(bundle, packages = OUTPUT_PACKAGES) {
  if (typeof bundle !== 'string') {
    throw new TypeError('Cursor bundle must be a string');
  }

  /** @type {Map<string, string>} */
  const symToType = new Map();
  /** @type {Map<string, string>} */
  const messageFieldsBlob = new Map();
  /** @type {Map<string, Array<{ name: string, number: number }>>} */
  const enumValues = new Map();
  /** @type {Map<string, { methods: Array<{ name: string, I: string, O: string, kind: string }> }>} */
  const services = new Map();
  const packagePrefixes = packages
    .map(({ packageId }) => escapeRegex(packageId))
    .join('|');

  extractMessageDescriptors(
    bundle,
    packagePrefixes,
    symToType,
    messageFieldsBlob
  );
  extractEnumDescriptors(
    bundle,
    packages,
    packagePrefixes,
    symToType,
    enumValues
  );
  extractServiceDescriptors(bundle, packagePrefixes, services);

  return { symToType, messageFieldsBlob, enumValues, services };
}

/**
 * Extract message descriptors emitted by the supported protobuf runtimes.
 *
 * @param {string} bundle
 * @param {string} packagePrefixes
 * @param {Map<string, string>} symToType
 * @param {Map<string, string>} messageFieldsBlob
 */
function extractMessageDescriptors(
  bundle,
  packagePrefixes,
  symToType,
  messageFieldsBlob
) {
  const classRe = new RegExp(
    `(\\w+)=class \\w+ extends \\w+\\{[\\s\\S]*?typeName="((${packagePrefixes})\\.[^"]+)"[\\s\\S]*?newFieldList\\(\\(\\)=>\\[([\\s\\S]*?)\\]\\)\\}`,
    'g'
  );
  for (const match of bundle.matchAll(classRe)) {
    symToType.set(match[1], match[2]);
    if (!messageFieldsBlob.has(match[2])) {
      messageFieldsBlob.set(match[2], match[4]);
    }
  }

  const makeMessageTypeRe = new RegExp(
    `(\\w+)=\\w+\\.makeMessageType\\("((${packagePrefixes})\\.[^"]+)",\\(\\)=>\\[`,
    'g'
  );
  for (const match of bundle.matchAll(makeMessageTypeRe)) {
    const fieldsStart = match.index + match[0].length - 1;
    const fieldsEnd = findBalancedDelimiterEnd(bundle, fieldsStart, '[', ']');
    if (fieldsEnd === -1) {
      continue;
    }
    symToType.set(match[1], match[2]);
    if (!messageFieldsBlob.has(match[2])) {
      messageFieldsBlob.set(match[2], bundle.slice(fieldsStart + 1, fieldsEnd));
    }
  }

  // Bufbuild static blocks contain nested braces that defeat the generic class expression.
  const staticFieldListRe = new RegExp(
    `(\\w+)=class[^;]{0,4000}?static\\{this\\.typeName="((${packagePrefixes})\\.[^"]+)"\\}static\\{this\\.fields=n\\.util\\.newFieldList\\(\\(\\)=>\\[([\\s\\S]*?)\\]\\)\\}`,
    'g'
  );
  for (const match of bundle.matchAll(staticFieldListRe)) {
    symToType.set(match[1], match[2]);
    if (!messageFieldsBlob.has(match[2])) {
      messageFieldsBlob.set(match[2], match[4]);
    }
  }

  const typeNameAssignRe = new RegExp(
    `(\\w+)\\.typeName="((${packagePrefixes})\\.[^"]+)"`,
    'g'
  );
  for (const match of bundle.matchAll(typeNameAssignRe)) {
    symToType.set(match[1], match[2]);
  }

  const quotedTypeRe = new RegExp(
    `"typeName":"((${packagePrefixes})\\.[^"]+)"`,
    'g'
  );
  for (const match of bundle.matchAll(quotedTypeRe)) {
    if (!messageFieldsBlob.has(match[1])) {
      messageFieldsBlob.set(match[1], '');
    }
  }
}

/**
 * Extract enum descriptors emitted by the supported protobuf runtimes.
 *
 * @param {string} bundle
 * @param {ReadonlyArray<{ packageId: string }>} packages
 * @param {string} packagePrefixes
 * @param {Map<string, string>} symToType
 * @param {Map<string, Array<{ name: string, number: number }>>} enumValues
 */
function extractEnumDescriptors(
  bundle,
  packages,
  packagePrefixes,
  symToType,
  enumValues
) {
  const makeEnumRe = new RegExp(
    `(\\w+)=\\w+\\.makeEnum\\("((${packagePrefixes})\\.[^"]+)",\\[`,
    'g'
  );
  for (const match of bundle.matchAll(makeEnumRe)) {
    const valuesStart = match.index + match[0].length - 1;
    const valuesEnd = findBalancedDelimiterEnd(bundle, valuesStart, '[', ']');
    if (valuesEnd === -1) {
      continue;
    }
    symToType.set(match[1], match[2]);
    if (!enumValues.has(match[2])) {
      enumValues.set(match[2], parseEnumValues(bundle.slice(valuesStart + 1, valuesEnd)));
    }
  }

  const enumRe = /\.util\.setEnumType\((\w+),"([^"]+)",\[([\s\S]*?)\]\)/g;
  for (const match of bundle.matchAll(enumRe)) {
    const packageConfig = packages.find(({ packageId }) =>
      match[2].startsWith(`${packageId}.`)
    );
    if (!packageConfig) {
      continue;
    }
    symToType.set(match[1], match[2]);
    if (!enumValues.has(match[2])) {
      enumValues.set(match[2], parseEnumValues(match[3]));
    }
  }
}

/**
 * Extract service descriptors and their RPC method metadata.
 *
 * @param {string} bundle
 * @param {string} packagePrefixes
 * @param {Map<string, { methods: Array<{ name: string, I: string, O: string, kind: string }> }>} services
 */
function extractServiceDescriptors(bundle, packagePrefixes, services) {
  const serviceHeaderRe = new RegExp(
    `typeName:"((${packagePrefixes})\\.[A-Za-z0-9_]+Service)",methods:\\{`,
    'g'
  );
  for (const match of bundle.matchAll(serviceHeaderRe)) {
    const methodsStart = match.index + match[0].length;
    const methodsEnd = findBalancedObjectEnd(bundle, methodsStart - 1);
    if (methodsEnd === -1) {
      continue;
    }
    const methods = [];
    const methodRe =
      /\w+:\{name:"([^"]+)",I:(\w+),O:(\w+),kind:\w+\.(\w+)\}/g;
    for (const method of bundle.slice(methodsStart, methodsEnd).matchAll(methodRe)) {
      methods.push({
        name: method[1],
        I: method[2],
        O: method[3],
        kind: method[4],
      });
    }
    services.set(match[1], { methods });
  }
}

/**
 * @param {string} valuesBlob
 * @returns {Array<{ name: string, number: number }>}
 */
function parseEnumValues(valuesBlob) {
  const numberedValues = [
    ...valuesBlob.matchAll(/\{no:([^,}]+),name:"([^"]+)"/g),
  ];
  if (numberedValues.length > 0) {
    return numberedValues.map((match, index) => {
      const number = Number(match[1]);
      return {
        name: match[2],
        number: Number.isFinite(number) ? number : index,
      };
    });
  }
  return [...valuesBlob.matchAll(/name:"([^"]+)"/g)].map((match, index) => ({
    name: match[1],
    number: index,
  }));
}

/**
 * Find the closing brace for an object whose opening brace is at startIndex.
 *
 * @param {string} source
 * @param {number} startIndex
 */
function findBalancedObjectEnd(source, startIndex) {
  return findBalancedDelimiterEnd(source, startIndex, '{', '}');
}

/**
 * Find a closing delimiter while ignoring delimiters inside quoted strings.
 *
 * @param {string} source
 * @param {number} startIndex
 * @param {string} opening
 * @param {string} closing
 */
function findBalancedDelimiterEnd(source, startIndex, opening, closing) {
  let depth = 0;
  let quote = null;
  let escaped = false;
  for (let index = startIndex; index < source.length; index += 1) {
    const character = source[index];
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (character === '\\') {
        escaped = true;
      } else if (character === quote) {
        quote = null;
      }
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === opening) depth += 1;
    if (character === closing) {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }
  return -1;
}

/**
 * Split a top-level field list while preserving nested descriptor objects.
 *
 * @param {string} fieldsBlob
 */
export function splitFields(fieldsBlob) {
  if (!fieldsBlob.trim()) {
    return [];
  }

  const parts = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < fieldsBlob.length; index += 1) {
    const character = fieldsBlob[index];
    if (character === '{') depth += 1;
    if (character === '}') depth -= 1;
    if (character === ',' && depth === 0) {
      parts.push(fieldsBlob.slice(start, index));
      start = index + 1;
    }
  }
  parts.push(fieldsBlob.slice(start));
  return parts.map((part) => part.trim()).filter(Boolean);
}

/**
 * Convert one Bufbuild field descriptor into a proto field declaration.
 *
 * @param {string} field
 * @param {Map<string, string>} symToType
 * @param {string} packageId
 */
export function fieldToProto(field, symToType, packageId) {
  const number = field.match(/no:(\d+)/)?.[1];
  const name = field.match(/name:"([^"]+)"/)?.[1];
  if (!number || !name) {
    return null;
  }

  const repeated = field.includes('repeated:!0');
  const optional = field.includes('opt:!0');
  const prefix = repeated ? 'repeated ' : optional ? 'optional ' : '';
  const kind = field.match(/kind:"([^"]+)"/)?.[1] ?? 'scalar';

  if (kind === 'scalar') {
    const scalarNumber = Number(field.match(/,T:(\d+)/)?.[1] ?? 12);
    return `${prefix}${SCALAR_TYPES.get(scalarNumber) ?? 'bytes'} ${name} = ${number};`;
  }

  const resolveType = (symbol) => {
    const fullName = symbol ? symToType.get(symbol) : undefined;
    if (!fullName) {
      return { label: 'bytes', comment: symbol };
    }
    return { label: fieldTypeRef(fullName, packageId), comment: null };
  };

  if (kind === 'message') {
    const symbol = field.match(/,T:(\w+)/)?.[1];
    const { label, comment } = resolveType(symbol);
    const note = comment ? ` // unresolved symbol ${comment}` : '';
    return `${prefix}${label} ${name} = ${number};${note}`;
  }

  if (kind === 'enum') {
    const symbol =
      field.match(/getEnumType\((\w+)\)/)?.[1] ??
      field.match(/,T:(\w+)/)?.[1];
    const { label, comment } = resolveType(symbol);
    const typeLabel = comment ? 'int32' : label;
    const note = comment ? ` // unresolved enum ${comment}` : '';
    return `${prefix}${typeLabel} ${name} = ${number};${note}`;
  }

  return `${prefix}bytes ${name} = ${number};`;
}
