import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { DirectTargetConfig } from '../federation/directRoutes.js';
import type { CollaborationNode } from './collaborationPeerTransport.js';

/** Persisted collaboration origins name sessions. Dial only the administrator's
 * current pinned addresses when available, without weakening their trust mode. */
export async function withPeerEndpoint<T>(peer: CollaborationNode, targets: DirectTargetConfig[], baseDir: string,
  connect: (node: CollaborationNode, ca?: Buffer, certificateFingerprint256?: string) => Promise<T>): Promise<T> {
  const configured = targets.filter(target => target.serviceId === peer.serviceId);
  if (!configured.length) {
    const hostname = new URL(peer.origin).hostname;
    if (['localhost', '127.0.0.1', '[::1]'].includes(hostname) || hostname.endsWith('.localhost')) throw new Error('WAITING_FOR_PEER_CONNECTION');
    return connect(peer);
  }
  let failure: unknown;
  for (const target of configured) {
    try {
      const origin = new URL(target.url.replace(/^wss:/, 'https:')).origin;
      const node = { serviceId: peer.serviceId, origin, ...(target.caFingerprint256 ? { caFingerprint256: target.caFingerprint256 } : {}) };
      const ca = target.caPath ? readFileSync(resolve(baseDir, target.caPath)) : undefined;
      return await connect(node, ca, target.certificateFingerprint256);
    } catch (error) { failure = error; }
  }
  // An explicit saved pin supersedes the legacy origin, including on failure.
  throw failure;
}
