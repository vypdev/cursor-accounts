import { readFileSync } from 'node:fs';

const MACH_O_MAGIC = 0xfeedfacf;
const ELF_MAGIC = [0x7f, 0x45, 0x4c, 0x46];
const PE_MAGIC = [0x4d, 0x5a];

function matchesBytes(buffer, expected, offset = 0) {
  return expected.every((byte, index) => buffer[offset + index] === byte);
}

function architectureFromMachine(machine) {
  if (machine === 0x01000007 || machine === 0x8664 || machine === 0x3e) {
    return 'x64';
  }
  if (machine === 0x0100000c || machine === 0xaa64 || machine === 0xb7) {
    return 'arm64';
  }
  throw new Error(`Unsupported native machine type: 0x${machine.toString(16)}`);
}

function targetFromMachO(buffer) {
  if (buffer.length < 8) {
    throw new Error('Mach-O binary is truncated.');
  }
  return `darwin-${architectureFromMachine(buffer.readUInt32LE(4))}`;
}

function targetFromElf(buffer) {
  if (buffer.length < 20) {
    throw new Error('ELF binary is truncated.');
  }
  const isLittleEndian = buffer[5] === 1;
  const isBigEndian = buffer[5] === 2;
  if (!isLittleEndian && !isBigEndian) {
    throw new Error(`Unsupported ELF byte order: ${buffer[5]}`);
  }
  const machine = isLittleEndian ? buffer.readUInt16LE(18) : buffer.readUInt16BE(18);
  return `linux-${architectureFromMachine(machine)}`;
}

function targetFromPe(buffer) {
  if (buffer.length < 64) {
    throw new Error('PE binary is truncated.');
  }
  const peHeaderOffset = buffer.readUInt32LE(0x3c);
  if (peHeaderOffset + 6 > buffer.length || !matchesBytes(buffer, [0x50, 0x45, 0x00, 0x00], peHeaderOffset)) {
    throw new Error('PE binary has an invalid header.');
  }
  return `win32-${architectureFromMachine(buffer.readUInt16LE(peHeaderOffset + 4))}`;
}

export function detectNativeTarget(buffer) {
  if (buffer.length >= 4 && buffer.readUInt32LE(0) === MACH_O_MAGIC) {
    return targetFromMachO(buffer);
  }
  if (buffer.length >= 4 && matchesBytes(buffer, ELF_MAGIC)) {
    return targetFromElf(buffer);
  }
  if (buffer.length >= 2 && matchesBytes(buffer, PE_MAGIC)) {
    return targetFromPe(buffer);
  }
  throw new Error('Unsupported native binary format.');
}

export function assertNativeTarget(filePath, expectedTarget) {
  const actualTarget = detectNativeTarget(readFileSync(filePath));
  if (actualTarget !== expectedTarget) {
    throw new Error(
      `Native binary target mismatch: expected ${expectedTarget}, got ${actualTarget}`
    );
  }
  return actualTarget;
}
