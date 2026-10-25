import { useEffect, useMemo, useState } from 'react';
import { listCollaborationGroups, subscribeCollaborationGroups, type CollaborationGroup, type OrchestrationSession } from '../../terminal/api';
import { useSessionDirectory, useSessionPresentations } from '../../stores/useSessionDirectory';
import type { ChatMention } from './chatComposerContent';

/** The owner directory supplies contactable Sessions; groups only add context.
 * Shared views deliberately do not receive this discovery capability. */
export function useChatMentions(sessionId: string, enabled: boolean, open: boolean) {
  const directory = useSessionDirectory();
  const [groups, setGroups] = useState<CollaborationGroup[]>([]);
  const [snapshots, setSnapshots] = useState<OrchestrationSession[]>([]);
  const remoteSessions = useSessionPresentations(snapshots);
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [version, setVersion] = useState(0);
  useEffect(() => {
    if (!enabled || !open) return;
    let alive = true;
    setStatus('loading');
    const update = (data: { groups: CollaborationGroup[]; sessions: OrchestrationSession[] }) => { if (alive) {
      setGroups(data.groups); setSnapshots(data.sessions.filter(session => session.sessionId.startsWith('remote:'))); setStatus('ready');
    } };
    const unsubscribe = subscribeCollaborationGroups(update);
    void listCollaborationGroups().then(update).catch(() => { if (alive) setStatus('error'); });
    return () => { alive = false; unsubscribe(); };
  }, [sessionId, enabled, open, version]);
  const members = useMemo(() => {
    const result: ChatMention[] = [];
    for (const group of groups) {
      if (group.archivedAt || !group.sessionIds.includes(sessionId)) continue;
      for (const id of group.sessionIds) {
        const member = directory.find(session => session.sessionId === id) ?? remoteSessions.find(session => session.sessionId === id);
        if (id !== sessionId && member?.agent) result.push({ sessionId: id, groupId: group.id, groupName: group.name, name: member.displayName, ...(member.displaySubtitle ? { subtitle: member.displaySubtitle } : {}) });
      }
    }
    for (const member of directory) {
      if (member.sessionId === sessionId || !member.agent || member.sessionId.startsWith('remote:')
        || result.some(item => item.sessionId === member.sessionId)) continue;
      result.push({ sessionId: member.sessionId, groupId: '', groupName: '', name: member.displayName,
        ...(member.displaySubtitle ? { subtitle: member.displaySubtitle } : {}) });
    }
    for (const member of remoteSessions) {
      if (!member.agent || member.canDirectContact !== true || result.some(item => item.sessionId === member.sessionId)) continue;
      const subtitle = [member.displaySubtitle, member.serviceLabel || member.serviceOrigin].filter(Boolean).join(' · ');
      result.push({ sessionId: member.sessionId, groupId: '', groupName: '', name: member.displayName, ...(subtitle ? { subtitle } : {}) });
    }
    return result;
  }, [directory, groups, remoteSessions, sessionId]);
  const unsupportedRemote = remoteSessions.some(member => member.agent && member.canDirectContact !== true
    && !members.some(candidate => candidate.sessionId === member.sessionId));
  return { members, status, unsupportedRemote, retry: () => setVersion(value => value + 1) };
}
