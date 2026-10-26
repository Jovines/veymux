import type { ShareResources } from '../shared/shareResources.js';
import type { Request } from 'express';

// Object identity is deliberately used instead of a remotely forgeable header.
const resources = new WeakMap<object, ShareResources>();
export function encryptedRequestResources(request: object): ShareResources | undefined { return resources.get(request); }
const verified = new WeakSet<object>();
const subjects = new WeakMap<object, string>();
const serviceAccess = new WeakSet<object>();
const restrictedChat = new WeakSet<object>();
export function isRestrictedChatRequest(request: object): boolean { return restrictedChat.has(request); }
export function markEncryptedRequest(request: object, subjectId?: string, fullService = false, shared?: ShareResources, chatOnly = false): void {
  verified.add(request);
  if (shared) resources.set(request, shared);
  if (subjectId) subjects.set(request, subjectId);
  if (fullService) serviceAccess.add(request);
  if (chatOnly) restrictedChat.add(request);
}
export function isEncryptedRequest(request: Request): boolean { return verified.has(request); }
export function encryptedRequestSubject(request: object): string | undefined { return subjects.get(request); }
/** Set only by the target's authenticated internal dispatcher, never a page header. */
export function hasEncryptedServiceAccess(request: object): boolean { return serviceAccess.has(request); }
