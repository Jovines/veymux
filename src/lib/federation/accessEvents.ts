export const OPEN_SERVICE_ACCESS_EVENT = 'veymux:open-services';
export function openServiceAccess(): void { window.dispatchEvent(new Event(OPEN_SERVICE_ACCESS_EVENT)); }
export interface SessionShareRequest { inviteSessionId?: string; inviteSessionIds?: string[]; viewMode?: 'terminal' | 'chat'; viewLayout?: 'split' }
export function openSessionShare(options: SessionShareRequest): void { window.dispatchEvent(new CustomEvent(OPEN_SERVICE_ACCESS_EVENT, { detail: options })); }
