import { createInviteLink, parseInviteLink } from '../federation/inviteLink';
import type { ConnectionIntent } from '../federation/browserIntegration';
import { normalizeServiceAddress, type ServiceConnection } from './serviceDirectory';
import type { TermdockDesktopBridge } from '../desktop/nativeBridge';

export interface ServiceConnectionReview { connection: ServiceConnection; invitation?: string }

/** Hand off the target and every route, with credentials confined to an invite. */
export function desktopConnectionIntent(intent: ConnectionIntent): ServiceConnectionReview {
  const { targetPeerId, routes } = intent;
  // Preview probes `url` before creating a window. A relay selection must
  // bootstrap through its reachable entry, even when the target is offline locally.
  const relay = !intent.pairingCode && !intent.routeCode && !intent.entryServiceId
    ? routes?.find(route => route.targetPeerId !== targetPeerId) : undefined;
  const url = relay?.url || intent.nativeOrigin || intent.url;
  const entryServiceId = relay?.targetPeerId || intent.entryServiceId;
  const serviceOrigin = intent.nativeOrigin && (!intent.entryServiceId || intent.entryServiceId === targetPeerId) ? intent.nativeOrigin : intent.serviceOrigin || (relay && intent.url !== url ? intent.url : undefined);
  const connection = { id: targetPeerId, url, targetPeerId, serviceOrigin, entryServiceId, routes,
    label: intent.serviceName || new URL(serviceOrigin || url).host };
  const invitation = intent.pairingCode || intent.routeCode ? createInviteLink({
    v: 1, serviceId: targetPeerId, entryUrl: url, serviceUrl: serviceOrigin,
    name: intent.serviceName, entryServiceId, code: intent.pairingCode,
    routeCode: intent.routeCode, routeOnly: intent.routeOnly, viewMode: intent.viewMode, viewLayout: intent.viewLayout,
  }) : undefined;
  return { connection, invitation };
}

/** Keep invitation credentials in the original link, never in saved metadata. */
export function serviceConnectionInput(input: string): ServiceConnectionReview {
  if (input.includes('#termdock-invite=')) {
    const parsed = parseInviteLink(input);
    const { url, targetPeerId, serviceOrigin, entryServiceId } = parsed;
    return { connection: { id: targetPeerId, url, targetPeerId, serviceOrigin, entryServiceId,
      label: parsed.serviceName || new URL(serviceOrigin || url).host }, invitation: new URL(input).protocol === 'http:' && url.startsWith('https:') ? desktopConnectionIntent(parsed).invitation : input };
  }
  const url = normalizeServiceAddress(input);
  return { connection: { id: url, url, label: new URL(url).host } };
}

/** New desktop connections always continue in the bundled center, which owns
 * discovery and certificate approval. Older shells keep their native open path. */
export async function addDesktopService(bridge: TermdockDesktopBridge, input: string): Promise<void> {
  const { connection, invitation } = serviceConnectionInput(input);
  if (bridge.reviewServiceConnection) {
    await bridge.reviewServiceConnection(connection, invitation);
    return;
  }
  await openDesktopService(bridge, connection, invitation);
}

export async function openDesktopService(bridge: TermdockDesktopBridge, connection: ServiceConnection, invitation?: string): Promise<void> {
  try {
    const result = await bridge.openServiceConnection!(connection, invitation);
    if (!result.ok) throw new Error(result.error || '暂时无法打开服务，请检查地址和网络。');
  } catch (failure) {
    // Trust can only be granted in the bundled connection center. Transfer the
    // original request there; service content never receives trust privileges.
    if (bridge.reviewServiceConnection && ['PREVIEW_DISCOVERY_FAILED', 'PREVIEW_CERTIFICATE_REJECTED'].includes((failure as { code?: string })?.code || '')) {
      await bridge.reviewServiceConnection(connection, invitation);
      return;
    }
    throw failure;
  }
}

export function desktopCertificateTrust(bridge: TermdockDesktopBridge | undefined) {
  if (!bridge?.certificatePins || !bridge.inspectCertificate || !bridge.trustCertificate || !bridge.discardCertificateInspection || !bridge.revokeCertificate) return;
  return {
    listPins: () => bridge.certificatePins!(),
    inspect: (origin: string) => bridge.inspectCertificate!(origin),
    trust: (origin: string, fingerprint: string, receipt: string) => bridge.trustCertificate!(origin, fingerprint, receipt),
    discard: (receipt: string) => bridge.discardCertificateInspection!(receipt),
    revoke: (origin: string) => bridge.revokeCertificate!(origin),
  };
}
