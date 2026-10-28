import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { DirectTargetConfig } from './directRoutes.js';
import { directConnectionAddresses, type ConnectionRecord } from './connectionModel.js';

const peer = (value: unknown): value is string => typeof value === 'string' && /^[a-zA-Z0-9_.:-]{1,160}$/.test(value);
function origin(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > 2048) return;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') return;
    return url.origin;
  } catch { return; }
}
/** Read only this OS user's Desktop directory. The local service must itself
 * have been pinned there before its administrator can discover other entries.
 * This supplies addresses, never the Desktop client's device authorization.
 */
export function desktopDirectTargets(file: string, localServiceId: string): DirectTargetConfig[] {
  if (!localServiceId) return [];
  try {
    if (statSync(file).size > 1024 * 1024) return [];
    const data = JSON.parse(readFileSync(file, 'utf8'));
    if (data?.version !== 1 || !Array.isArray(data.connections) || data.connections.length > 256) return [];
    const removedKeys = data.removedKeys;
    const removed = new Set(Array.isArray(removedKeys) ? removedKeys : []);
    const connections = data.connections.filter((item: Record<string, unknown> | null) => item && ![item.id, item.targetPeerId, item.serviceOrigin || item.url].some(key => removed.has(key)));
    if (!connections.some((item: Record<string, unknown>) => item.targetPeerId === localServiceId)) return [];
    const targets = new Map<string, DirectTargetConfig>();
    for (const item of connections) {
      if (!peer(item.targetPeerId) || item.targetPeerId === localServiceId) continue;
      for (const address of directConnectionAddresses(item as unknown as ConnectionRecord)) {
        const url = origin(address);
        if (!url) continue;
        const pin = data.certificatePins?.[url];
        // Saved pins identify leaf certificates. Invalid pins fail closed.
        if (pin !== undefined && (typeof pin !== 'string' || !/^[\da-f]{64}$/i.test(pin))) continue;
        targets.set(JSON.stringify([item.targetPeerId, url]), { serviceId: item.targetPeerId, url,
          ...(typeof item.label === 'string' && item.label.trim() ? { label: item.label.trim().slice(0, 120) } : {}),
          ...(pin ? { certificateFingerprint256: pin.toUpperCase() } : {}) });
        if (targets.size >= 64) break;
      }
      if (targets.size >= 64) break;
    }
    return [...targets.values()];
  } catch { return []; }
}

/** Stable Rust settings are authoritative; Preview is used only before a stable install. */
export function desktopServiceTargets(home: string, localServiceId: string, platform: NodeJS.Platform = process.platform): DirectTargetConfig[] {
  const nativeRoot = platform === 'darwin' ? join(home, 'Library', 'Application Support')
    : platform === 'win32' ? process.env.APPDATA || join(home, 'AppData', 'Roaming')
      : process.env.XDG_CONFIG_HOME || join(home, '.config');
  const stableFile = join(nativeRoot, 'com.jovines.veymux', 'connections.json');
  try {
    statSync(stableFile);
    return desktopDirectTargets(stableFile, localServiceId);
  } catch (error) {
    // An unreadable stable directory is unknown; only absence permits legacy fallback.
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') return [];
  }
  return desktopDirectTargets(join(nativeRoot, 'com.jovines.veymux.preview', 'connections.json'), localServiceId);
}
