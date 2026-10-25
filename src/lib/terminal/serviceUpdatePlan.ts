import { connectionAddresses, connectionRoutes, currentConnectionPath, currentEntryClient, currentSecureClient, savedConnection, type ConnectionIntent } from '../federation/browserIntegration';
import { listServiceConnections, type ServiceConnection } from '../services/serviceDirectory';

export interface ServiceUpdateNode {
  intent: ConnectionIntent;
  label: string;
  role: 'target' | 'relay' | 'interface';
}
export interface ServiceUpdatePlan {
  nodes: ServiceUpdateNode[];
  targetId: string;
  relayId?: string;
  interfaceId?: string;
}

/** Identify the actual relay and the shell provider separately. A saved target's
 * relay URL is never evidence that the target itself serves that origin. */
export function buildServiceUpdatePlan(target: ConnectionIntent, services: ServiceConnection[], origin: string, relayId?: string): ServiceUpdatePlan {
  const candidates = services.filter((service): service is ServiceConnection & { targetPeerId: string } => Boolean(service.targetPeerId));
  const routes = [...connectionRoutes(target), ...candidates.flatMap(service => connectionRoutes({ ...service, targetPeerId: service.targetPeerId }))];
  const own = candidates.find(service => service.targetPeerId === target.targetPeerId);
  const nodes: ServiceUpdateNode[] = [{ intent: target, label: own?.label || target.serviceName || new URL(target.url).host, role: 'target' }];
  const nodeFor = (id: string, role: ServiceUpdateNode['role']): ServiceUpdateNode => {
    const service = candidates.find(item => item.targetPeerId === id);
    const route = routes.find(item => item.targetPeerId === id);
    if (!service && !route) throw new Error('无法确定中转服务的已保存地址，请重新连接后重试。');
    const intent = service ? { ...service, serviceName: service.label } : { ...route! };
    return { intent, label: service?.label || new URL(intent.url).host, role };
  };
  if (relayId && relayId !== target.targetPeerId) nodes.push(nodeFor(relayId, 'relay'));
  const providers = new Set<string>();
  for (const item of [{ ...target }, ...candidates]) {
    if (connectionAddresses(item).some(address => new URL(address).origin === origin)) providers.add(item.targetPeerId);
  }
  for (const route of routes) if (new URL(route.url).origin === origin) providers.add(route.targetPeerId);
  // Conflicting pins must be resolved by the user, not by an update operation.
  if (providers.size > 1) throw new Error('界面入口的服务身份记录不一致，请检查保存的服务地址。');
  const interfaceId = [...providers][0];
  if (relayId && !interfaceId) throw new Error('无法确定当前界面的入口服务，请从已保存的入口重新打开后更新。');
  if (interfaceId && !nodes.some(node => node.intent.targetPeerId === interfaceId)) nodes.push(nodeFor(interfaceId, 'interface'));
  // Keep the shell provider last: restarting it also interrupts the PWA's
  // resource downloads. Other relays follow the target, before the shell.
  nodes.sort((a, b) => Number(a.intent.targetPeerId === interfaceId && a.role !== 'target') - Number(b.intent.targetPeerId === interfaceId && b.role !== 'target'));
  return { nodes, targetId: target.targetPeerId, relayId, interfaceId };
}

export async function captureServiceUpdatePlan(): Promise<ServiceUpdatePlan> {
  const target = savedConnection(), client = currentSecureClient(), relay = currentEntryClient();
  if (!target || !client || client.closed) throw new Error('连接已变化，请重新连接后更新。');
  const relayId = currentConnectionPath() === 'relay' ? relay?.targetPeerId : undefined;
  if (currentConnectionPath() === 'relay' && (!relay || relay.closed)) throw new Error('中转连接已断开，请重新连接后更新。');
  const services = await listServiceConnections();
  if (savedConnection() !== target || currentSecureClient() !== client || currentEntryClient() !== relay || client.closed) throw new Error('连接已变化，请重新确认更新。');
  return buildServiceUpdatePlan(target, services, location.origin, relayId);
}

export function serviceUpdateCopy(plan: ServiceUpdatePlan, chinese: boolean) {
  const names = plan.nodes.filter(node => node.role !== 'target').map(node => `“${node.label}”`).join(chinese ? '、' : ', ');
  const relay = plan.nodes.find(node => node.intent.targetPeerId === plan.relayId);
  const provider = plan.nodes.find(node => node.intent.targetPeerId === plan.interfaceId);
  const notice = chinese
    ? `${relay ? `当前通过“${relay.label}”中转连接。` : ''}${provider && provider.role !== 'target' ? `界面由“${provider.label}”提供。` : ''}仅更新当前服务无法更新全部界面功能，将一并更新 ${names}。`
    : `${relay ? `Connected through “${relay.label}”. ` : ''}${provider && provider.role !== 'target' ? `The interface is provided by “${provider.label}”. ` : ''}Updating this service alone will not update all interface features. ${names} will be updated together.`;
  return {
    notice,
    actionLabel: chinese ? '一并更新并重启' : 'Update and restart together',
    confirmation: chinese
      ? `${notice}\n\n将更新并重启 ${plan.nodes.map(node => `“${node.label}”`).join('、')}。先重启当前服务，再重启中转和界面入口，连接会短暂中断，最后自动重新加载界面。中转重启也会影响经它连接的其他设备。是否继续？`
      : `${notice}\n\nUpdate and restart ${plan.nodes.map(node => `“${node.label}”`).join(', ')}? The current service restarts first, followed by relays and the interface provider. Connections will be briefly interrupted, including other devices using these relays. The interface will reload automatically.`,
  };
}
