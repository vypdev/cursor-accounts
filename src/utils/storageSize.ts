import { NodeFileSystemService } from '../storage/nodeFileSystemService';
import {
  ProfileStorageAnalyzer,
  formatBytes,
} from '../storage/profileStorageAnalyzer';

export { formatBytes };

const defaultFileSystem = new NodeFileSystemService();
const defaultAnalyzer = new ProfileStorageAnalyzer(defaultFileSystem);

/** @deprecated Prefer injecting {@link ProfileStorageAnalyzer} via {@link IProfileStorageAnalyzer}. */
export async function calculateProfileStorageSize(
  profileId: string,
  userDataDir: string
) {
  return defaultAnalyzer.calculateProfileStorageSize(profileId, userDataDir);
}

/** @deprecated Prefer injecting {@link ProfileStorageAnalyzer} via {@link IProfileStorageAnalyzer}. */
export async function getProfileTotalBytes(userDataDir: string): Promise<number> {
  return defaultAnalyzer.getProfileTotalBytes(userDataDir);
}

/** @deprecated Prefer {@link IFileSystemService.getPathSize}. */
export async function getDirectorySize(targetPath: string): Promise<number> {
  return defaultFileSystem.getPathSize(targetPath);
}

export { ProfileStorageAnalyzer, NodeFileSystemService };
