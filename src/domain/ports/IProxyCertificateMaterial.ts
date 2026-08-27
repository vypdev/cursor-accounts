import type { IProxyCertificateGuide } from './IProxyCertificateGuide';
import type { IProxyCertificatePath } from './IProxyCertificatePath';

/** Certificate path and user-facing installation-guide capabilities. */
export interface IProxyCertificateMaterial
  extends IProxyCertificatePath,
    IProxyCertificateGuide {}
