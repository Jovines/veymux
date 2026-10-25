import { Bot } from 'lucide-react';
import type { AgentLauncherInfo } from '../../terminal/api';
import { ConfigurationChoices } from './ConfigurationChoices';

export function AgentChoices({ label = 'Agent', agents, value, loading = false, onChange }: {
  label?: string; agents: AgentLauncherInfo[]; value: string; loading?: boolean; onChange: (slug: string) => void;
}) {
  return <div className="min-w-0 space-y-2">
    <ConfigurationChoices label={label} value={value} disabled={loading} onChange={onChange}
      options={agents.map(agent => ({ value: agent.slug, label: agent.displayName, icon: <Bot size={18} /> }))} />
    {loading && <p role="status" className="text-xs text-muted-foreground">正在加载 Agent…</p>}
    {!loading && value && !agents.some(agent => agent.slug === value) && <p role="alert" className="text-xs text-destructive">{value}（当前不可用），请重新选择 Agent。</p>}
  </div>;
}
