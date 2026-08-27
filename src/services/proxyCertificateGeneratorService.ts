import type { IProxyCertificateGenerator } from '../domain/ports/IProxyCertificateGenerator';
import type { IProxyCertificateOperations } from '../domain/ports/IProxyCertificateOperations';

/** Keeps certificate generation behind the domain-facing generator port. */
export class ProxyCertificateGeneratorService
  implements IProxyCertificateGenerator
{
  constructor(
    private readonly certificateOperations: IProxyCertificateOperations
  ) {}

  ensureCaCertificate(): Promise<string> {
    return this.certificateOperations.ensureCaCertificate();
  }
}
