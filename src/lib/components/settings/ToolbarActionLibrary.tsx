import { Check, ChevronRight, Keyboard, Plus, TerminalSquare } from 'lucide-react';
import { useI18n } from '../../i18n';
import { TOOLBAR_SHORTCUTS } from '../../terminal/toolbarCustomization';
import { decodeToolbarSequence, type MobileToolbarAction } from '../terminal/mobileKeyboardPresets';

export function ToolbarActionLibrary({ actions, onKey, onCustom }: {
  actions: MobileToolbarAction[];
  onKey: (action: MobileToolbarAction) => void;
  onCustom: (type: 'text' | 'combo') => void;
}) {
  const { t } = useI18n();
  return <div className="space-y-5">
    <div className="grid grid-cols-2 gap-2">
      {(['text', 'combo'] as const).map(type => <button key={type} type="button" onClick={() => onCustom(type)}
        className="flex min-h-20 min-w-0 items-center gap-2 rounded-xl border border-border/40 bg-surface-2 px-3 py-3 text-left hover:border-primary focus-visible:ring-2 focus-visible:ring-primary">
        {type === 'text' ? <TerminalSquare size={22} className="shrink-0 text-primary" /> : <Keyboard size={22} className="shrink-0 text-primary" />}
        <span className="min-w-0 flex-1 text-sm font-medium">{t(type === 'text' ? 'toolbarPresets.inputText' : 'toolbarPresets.combination')}</span><ChevronRight size={14} className="shrink-0 text-muted-foreground" />
      </button>)}
    </div>
    <section aria-label={t('toolbarPresets.commonKeys')}>
      <h4 className="mb-3 text-xs font-medium text-muted-foreground">{t('toolbarPresets.commonKeys')}</h4>
      <div className="grid grid-cols-3 gap-2">
        {TOOLBAR_SHORTCUTS.map(key => {
          const added = actions.some(action => decodeToolbarSequence(action.sequence) === decodeToolbarSequence(key.sequence));
          return <button key={key.id} type="button" disabled={added}
            aria-label={added ? t('toolbarPresets.keyAlreadyAdded', { key: key.label }) : t('toolbarPresets.addKey', { key: key.label })}
            onClick={() => onKey({ id: crypto.randomUUID(), label: key.label, sequence: key.sequence })}
            className={`relative flex min-h-[4.25rem] min-w-0 flex-col items-start justify-center rounded-xl border px-2 py-2 text-left focus-visible:ring-2 focus-visible:ring-primary ${added ? 'border-border/20 text-muted-foreground' : 'border-border/40 bg-surface-2 text-foreground shadow-[0_2px_0_var(--border)] hover:border-primary'}`}>
            <span className="max-w-full truncate font-mono text-sm font-medium">{key.label}</span>
            <span className="mt-1 block text-[10px] leading-4 text-muted-foreground">{t(`toolbarPresets.key_${key.id}`)}</span>
            {added ? <Check size={12} className="absolute right-1.5 top-1.5 text-primary" /> : <Plus size={11} className="absolute right-1.5 top-1.5 text-muted-foreground" />}
          </button>;
        })}
      </div>
    </section>
  </div>;
}
