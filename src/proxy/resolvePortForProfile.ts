import type { IProfileManager } from '../domain/ports/IProfileManager';
import type { IProxyStateStore } from '../domain/ports/IProxyStateStore';
import { isPortAvailable, isProcessAlive } from './portUtils';
import { PROXY_PORT_FALLBACKS } from './types';

function isProxyAlive(state: {
  pid?: number;
  port?: number;
}): boolean {
  if (state.pid == null || !isProcessAlive(state.pid)) {
    return false;
  }
  return true;
}

async function isProxyListening(port: number): Promise<boolean> {
  return !(await isPortAvailable(port));
}

/**
 * Returns true when persisted state matches a live proxy on the assigned port.
 */
export async function isProfileProxyRunning(
  state: { pid?: number; port?: number; running?: boolean } | null
): Promise<boolean> {
  if (!state?.running || state.port == null) {
    return false;
  }
  if (!isProxyAlive(state)) {
    return false;
  }
  return await isProxyListening(state.port);
}

/**
 * Resolve a stable port for a profile, avoiding conflicts with other profiles.
 */
export async function resolvePortForProfile(
  profileId: string,
  profileManager: IProfileManager,
  stateStore: IProxyStateStore
): Promise<number | null> {
  const profile = await profileManager.getProfile(profileId);
  if (!profile) {
    return null;
  }

  const state = await stateStore.read(profile.userDataDir);

  if (state?.port != null && (await isProfileProxyRunning(state))) {
    return state.port;
  }

  if (state?.port != null && (await isPortAvailable(state.port))) {
    return state.port;
  }

  const profiles = await profileManager.getProfiles();
  const reservedPorts = new Set<number>();

  for (const other of profiles) {
    if (other.id === profileId) {
      continue;
    }
    const otherState = await stateStore.read(other.userDataDir);
    if (otherState?.port == null) {
      continue;
    }
    if (await isProfileProxyRunning(otherState)) {
      reservedPorts.add(otherState.port);
      continue;
    }
    reservedPorts.add(otherState.port);
  }

  for (const port of PROXY_PORT_FALLBACKS) {
    if (reservedPorts.has(port)) {
      continue;
    }
    if (await isPortAvailable(port)) {
      return port;
    }
  }

  return null;
}

/**
 * Collect ports currently in use by live profile proxies.
 */
export async function getAllUsedProxyPorts(
  profileManager: IProfileManager,
  stateStore: IProxyStateStore
): Promise<number[]> {
  const profiles = await profileManager.getProfiles();
  const usedPorts = new Set<number>();

  for (const profile of profiles) {
    const state = await stateStore.read(profile.userDataDir);
    if (state?.port == null) {
      continue;
    }
    if (await isProfileProxyRunning(state)) {
      usedPorts.add(state.port);
    }
  }

  return [...usedPorts].sort((a, b) => a - b);
}
