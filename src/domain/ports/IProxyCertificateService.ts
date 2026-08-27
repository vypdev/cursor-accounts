import type { IProxyCertificateMaterial } from './IProxyCertificateMaterial';
import type { IProxyCertificateTrust } from './IProxyCertificateTrust';

export interface IProxyCertificateService
  extends IProxyCertificateMaterial,
    IProxyCertificateTrust {}
