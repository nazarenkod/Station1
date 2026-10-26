import {X509Certificate} from 'node:crypto';

import {runTool} from '../doctor/exec.js';

// certificates Xcode signs development builds with: the current name and the one before Xcode 11
const CERTIFICATE_NAMES = ['Apple Development', 'iPhone Developer'];

const field = (subject, key) => subject.match(new RegExp(`^${key}=(.*)$`, 'm'))?.[1]?.trim() ?? null;

/**
 * The development teams of the signing certificates in a PEM bundle, as
 * `security find-certificate -p` prints them: the team id (the certificate's
 * OU), the team's name (its O) and whose certificate it is (its CN). Expired
 * certificates are left out, and each team comes once.
 */
export function parseSigningTeams(pem, now = new Date()) {
  const blocks = pem.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g) ?? [];
  const teams = new Map();
  for (const block of blocks) {
    let cert;
    try {
      cert = new X509Certificate(block);
    } catch {
      continue;
    }
    const teamId = field(cert.subject, 'OU');
    if (!teamId || new Date(cert.validTo) < now || teams.has(teamId)) {
      continue;
    }
    teams.set(teamId, {
      teamId,
      teamName: field(cert.subject, 'O') ?? teamId,
      certificate: field(cert.subject, 'CN') ?? '',
    });
  }
  return [...teams.values()];
}

/**
 * The teams this Mac can sign WebDriverAgent with for a real iPhone: those
 * of the development certificates in the login keychain. Empty when there is
 * none (no Apple ID added in Xcode), or off macOS.
 */
export async function signingTeams() {
  if (process.platform !== 'darwin') {
    return [];
  }
  const outputs = await Promise.all(
    CERTIFICATE_NAMES.map((name) =>
      runTool('security', ['find-certificate', '-a', '-c', name, '-p'], {timeout: 10000}),
    ),
  );
  return parseSigningTeams(outputs.map((result) => (result.ok ? result.stdout : '')).join('\n'));
}
