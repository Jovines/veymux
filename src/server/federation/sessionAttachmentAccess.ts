import { createHash } from 'node:crypto';
import path from 'node:path';
import type { AuthorizationGrant } from './authorization.js';
import { canonicalApiPath } from './accessPolicy.js';
import { resourceHttpAllowed } from './resourceAccess.js';

export function sessionAttachmentRoot(directory: string, sessionId: string): string {
  return path.resolve(directory, createHash('sha256').update(sessionId).digest('hex'));
}

/** Session viewing includes only existing attachment file reads. It never
 * grants directory discovery, arbitrary file access or attachment mutation. */
export function attachmentReadRoot(directory: string | undefined, grants: AuthorizationGrant[], normalize: (id: string) => string, method: string, requestPath: string): string | undefined {
  if (!directory || !['GET', 'HEAD'].includes(method)) return;
  const pathname = canonicalApiPath(requestPath);
  if (!pathname) return;
  const prefix = '/api/terminal/fs/';
  if (!pathname.startsWith(prefix)) return;
  const operation = pathname.slice(prefix.length);
  if (!['blob', 'read', 'video', 'download'].includes(operation) && !operation.startsWith('preview/')) return;
  const url = new URL(requestPath, 'http://inner');
  let requested: string;
  if (operation.startsWith('preview/')) {
    const parts = operation.slice(8).split('/');
    if (/^[0-9a-f]{32}$/.test(parts[0])) parts.shift();
    requested = '/' + parts.join('/');
  } else {
    if (url.searchParams.getAll('path').length !== 1) return;
    requested = url.searchParams.get('path')!;
  }
  const base = path.resolve(directory);
  const relative = path.relative(base, path.resolve(requested));
  const [hash, ...file] = relative.split(path.sep);
  if (!/^[a-f0-9]{64}$/.test(hash) || !file.length) return;
  const root = path.join(base, hash);
  if (!grants.some(grant => (grant.actions.includes('session.view') || grant.actions.includes('service:*'))
    && (grant.scope.kind === 'service' || grant.scope.sessionIds.some(id => sessionAttachmentRoot(base, normalize(id)) === root)))) return;
  return resourceHttpAllowed({ directories: [{ path: root, access: 'read' }] }, method, requestPath) ? root : undefined;
}
