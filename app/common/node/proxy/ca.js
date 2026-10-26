import {createHash, X509Certificate} from 'node:crypto';
import {chmod, mkdir, readFile, writeFile} from 'node:fs/promises';
import path from 'node:path';

import {generateCACertificate} from 'mockttp';

import {PRODUCT_NAME} from '../../shared/product.js';

const CA_NAME = `${PRODUCT_NAME} CA`;

/**
 * The certificate authority the proxy signs sites with. Made once per
 * computer and kept in the app's data folder; devices trust it to let the
 * proxy read HTTPS.
 */
export async function ensureCa(dir) {
  const keyPath = path.join(dir, 'vision-inspector-ca.key');
  const certPath = path.join(dir, 'vision-inspector-ca.pem');
  let cert = await readFile(certPath, 'utf8').catch(() => null);
  // a certificate made under another product name is made again, so devices show the current one
  const stale = cert && !new X509Certificate(cert).subject.includes(`CN=${CA_NAME}`);
  if (!cert || stale || !(await readFile(keyPath, 'utf8').catch(() => null))) {
    await mkdir(dir, {recursive: true});
    const ca = await generateCACertificate({
      commonName: CA_NAME,
      organizationName: PRODUCT_NAME,
      countryName: 'UA',
    });
    await writeFile(keyPath, ca.key, {mode: 0o600});
    await chmod(keyPath, 0o600);
    await writeFile(certPath, ca.cert);
    cert = ca.cert;
  }
  const x509 = new X509Certificate(cert);
  return {
    keyPath,
    certPath,
    cert,
    fingerprint: createHash('sha256').update(x509.raw).digest('hex').match(/../g).join(':').toUpperCase(),
    validTo: x509.validTo,
  };
}
