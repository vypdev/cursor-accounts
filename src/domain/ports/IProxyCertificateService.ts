import type { IProxyCertificateGenerator } from './IProxyCertificateGenerator';
import type { IProxyCertificateMaterial } from './IProxyCertificateMaterial';
import type { IProxyCertificateTrust } from './IProxyCertificateTrust';

export interface IProxyCertificateService
  extends IProxyCertificateGenerator,
    IProxyCertificateMaterial,
    IProxyCertificateTrust {}
