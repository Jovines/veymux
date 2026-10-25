import React from 'react';
import { useI18n } from '../../i18n';
import {
  encodeToolbarKeyCombo,
  getToolbarKeyComboLabel,
  TOOLBAR_CHARACTER_KEYS,
  TOOLBAR_NAMED_KEYS,
  type ToolbarKeyCombo,
} from '../../terminal/toolbarKeyCombo';

export function ToolbarKeyComboPicker({
  onInsert,
  embedded = false,
  initialCombo,
  onChange,
}: {
  onInsert?: (sequence: string, label: string) => void;
  embedded?: boolean;
  initialCombo?: ToolbarKeyCombo;
  onChange?: (sequence: string | null, label: string, combo: ToolbarKeyCombo) => void;
}) {
  const { t } = useI18n();
  const [combo, setCombo] = React.useState<ToolbarKeyCombo>(
    initialCombo ?? { key: 'ArrowLeft', shift: true, ctrl: false, alt: false },
  );
  const select = (next: ToolbarKeyCombo) => {
    setCombo(next);
    onChange?.(encodeToolbarKeyCombo(next), getToolbarKeyComboLabel(next), next);
  };
  const sequence = encodeToolbarKeyCombo(combo);
  const label = getToolbarKeyComboLabel(combo);
  const quickKeys = ['ArrowLeft', 'ArrowUp', 'ArrowDown', 'ArrowRight', 'Home', 'End', 'Tab', 'Enter'];
  const keySelect = (
      <label className="flex items-center gap-3 text-xs text-muted-foreground">
        {t('toolbarPresets.comboKey')}
        <select
          value={combo.key}
          onChange={(event) => select({ ...combo, key: event.target.value })}
          className="min-h-11 min-w-0 flex-1 rounded-xl bg-surface-2 px-3 text-sm text-foreground outline-none focus:ring-1 focus:ring-accent/40"
        >
          <optgroup label={t('toolbarPresets.namedKeys')}>
            {TOOLBAR_NAMED_KEYS.map(([key, name]) => <option key={key} value={key}>{name}</option>)}
          </optgroup>
          <optgroup label={t('toolbarPresets.functionKeys')}>
            {Array.from({ length: 12 }, (_, i) => `F${i + 1}`).map(key => <option key={key} value={key}>{key}</option>)}
          </optgroup>
          <optgroup label={t('toolbarPresets.characterKeys')}>
            {TOOLBAR_CHARACTER_KEYS.map(key => <option key={key} value={key}>{key.toUpperCase()}</option>)}
          </optgroup>
        </select>
      </label>
  );
  const controls = (
    <div className="space-y-2 px-3 pb-3">
      <div className="flex flex-wrap gap-2">
        {(['shift', 'ctrl', 'alt'] as const).map((modifier) => (
          <button
            key={modifier}
            type="button"
            aria-pressed={combo[modifier]}
            onClick={() => select({ ...combo, [modifier]: !combo[modifier] })}
            className={`min-h-11 flex-1 rounded-lg border px-4 text-xs font-medium ${combo[modifier] ? 'border-primary bg-surface-2 text-primary' : 'border-border/30 bg-surface-2 text-muted-foreground hover:bg-surface-elevated'}`}
          >
            {modifier === 'shift' ? 'Shift' : modifier === 'ctrl' ? 'Ctrl' : 'Alt'}
          </button>
        ))}
      </div>
      {embedded ? <>
        <div className="grid grid-cols-4 gap-2" role="group" aria-label={t('toolbarPresets.comboKey')}>
          {quickKeys.map(key => <button key={key} type="button" aria-pressed={combo.key === key} onClick={() => select({ ...combo, key })}
            className={`min-h-11 min-w-0 rounded-lg border px-1 font-mono text-xs shadow-[0_2px_0_var(--border)] ${combo.key === key ? 'border-primary bg-surface-2 text-primary' : 'border-border/30 bg-surface-2 text-foreground hover:bg-surface-elevated'}`}>{TOOLBAR_NAMED_KEYS.find(([value]) => value === key)?.[1]}</button>)}
        </div>
        <details open={!quickKeys.includes(combo.key) ? true : undefined}>
          <summary className="min-h-11 cursor-pointer py-3 text-xs text-muted-foreground">{t('toolbarPresets.otherKeys')}{!quickKeys.includes(combo.key) && <span className="ml-2 text-foreground">{getToolbarKeyComboLabel({ ...combo, shift: false, ctrl: false, alt: false })}</span>}</summary>
          {keySelect}
        </details>
      </> : keySelect}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs text-foreground">{label}</span>
        {!embedded && (
          <button
            type="button"
            disabled={sequence === null}
            onClick={() => {
              if (sequence !== null) onInsert?.(sequence, label);
            }}
            className="min-h-11 rounded-full bg-primary/15 px-4 text-xs font-medium text-primary hover:bg-primary/25 disabled:opacity-40"
          >
            {t('toolbarPresets.insertCombo')}
          </button>
        )}
      </div>
      {!embedded && <p
        className="text-[11px] text-muted-foreground"
        role={sequence === null ? 'status' : undefined}
      >
        {t(
          sequence === null
            ? 'toolbarPresets.unsupportedCombo'
            : 'toolbarPresets.keyComboHint',
        )}
      </p>}
      {embedded && sequence === null && <p role="status" className="text-xs text-destructive">{t('toolbarPresets.unsupportedCombo')}</p>}
    </div>
  );
  return embedded ? (
    controls
  ) : (
    <details className="rounded-2xl bg-surface">
      <summary className="cursor-pointer px-3 py-2.5 text-xs font-medium text-accent">
        {t('toolbarPresets.keyCombo')}
      </summary>
      {controls}
    </details>
  );
}
