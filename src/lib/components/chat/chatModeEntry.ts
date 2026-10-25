import { getProgramDetection, replaceProgramDetection } from '../../terminal/api';
import { chatProgramName, validChatProgramName, type ChatEligibility, type ChatStartupAgent } from '../../../server/shared/chatProgramPolicy';
import { isConfiguredAgentCommand } from '../../terminal/launchCommands';
import type { SessionViewMode } from './sessionViewMode';
import { currentSecureClient, savedConnection } from '../../federation/browserIntegration';

export async function getChatEligibility(sessionId: string, command?: string): Promise<ChatEligibility> {
  const client = currentSecureClient(), target = savedConnection()?.targetPeerId || location.origin;
  const query = new URLSearchParams({ chatEligibility: '1' });
  if (command !== undefined) query.set('command', command);
  const response = await fetch(`/api/terminal/${encodeURIComponent(sessionId)}/view-mode?${query}`);
  if (!response.ok) throw new Error('暂时无法识别当前程序，请检查连接后重试');
  const result = await response.json();
  if (currentSecureClient() !== client || (savedConnection()?.targetPeerId || location.origin) !== target) throw new Error('连接已切换，请重试');
  if (typeof result.chatEligibility?.allowed !== 'boolean') throw new Error('程序识别暂不可用，请更新服务后重试');
  return result.chatEligibility;
}
export async function allowChatProgram(name: string): Promise<void> {
  const client = currentSecureClient(), target = savedConnection()?.targetPeerId || location.origin;
  const config = await getProgramDetection();
  if (currentSecureClient() !== client || (savedConnection()?.targetPeerId || location.origin) !== target) throw new Error('连接已切换，请重新配置');
  const program = name.trim().toLowerCase();
  if (!validChatProgramName(program, [...config.shellNames, ...config.genericProgramNames, ...config.wrapperScriptNames])) {
    throw new Error('请填写 Agent 的程序名（如 my-agent），不要填写路径、参数、Shell 或解释器名称');
  }
  await replaceProgramDetection({ ...config, chatProgramNames: [...new Set([...(config.chatProgramNames ?? []), program])] });
}
/** Capture the source mode at the creation gesture, before any asynchronous work. */
export async function inheritedAgentViewMode(sourceId: string | null, mode: SessionViewMode, command?: string): Promise<SessionViewMode> {
  return (await prepareNewSessionPresentation(sourceId, mode, command)).mode;
}
export async function prepareNewSessionPresentation(sourceId: string | null, mode: SessionViewMode, command?: string): Promise<{ mode: SessionViewMode; agent?: ChatStartupAgent }> {
  if (!sourceId || mode !== 'chat' || !command?.trim()) return { mode: 'terminal' };
  try {
    const eligibility = await getChatEligibility(sourceId, command);
    if (eligibility.allowed) return { mode: 'chat', agent: eligibility.agent ?? { displayName: eligibility.program || 'Agent' } };
    const program = chatProgramName(command);
    if (program && isConfiguredAgentCommand(command)) {
      await allowChatProgram(program);
      const configured = await getChatEligibility(sourceId, command);
      return { mode: 'chat', agent: configured.agent ?? { displayName: program } };
    }
  } catch { /* Creation still works offline/reconnecting; do not enter an unverified program. */ }
  return { mode: 'terminal' };
}
