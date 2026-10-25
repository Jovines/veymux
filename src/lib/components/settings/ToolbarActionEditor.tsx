import React from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, CornerDownLeft, Pencil, X, Check, Trash2 } from 'lucide-react';
import { useI18n } from '../../i18n';
import { useKeyboardLayer } from '../../hooks/useKeyboardLayer';
import { useTouchScrollBoundary } from '../../hooks/useTouchScrollBoundary';
import { focusKeyboardInput } from '../../hooks/nativeKeyboardLayout';
import { decodeToolbarSequence, type MobileToolbarAction } from '../terminal/mobileKeyboardPresets';
import {
  describeToolbarSequence,
  buildToolbarTextSequence,
  TOOLBAR_SHORTCUTS,
} from '../../terminal/toolbarCustomization';
import {
  encodeToolbarKeyCombo,
  getToolbarKeyComboLabel,
  escapeToolbarSequence,
} from '../../terminal/toolbarKeyCombo';
import { ToolbarKeyComboPicker } from './ToolbarKeyComboPicker';
import { ToolbarActionLibrary } from './ToolbarActionLibrary';

export function ToolbarActionEditor({
  action,
  existingActions = [],
  onSave,
  onCancel,
  commandTemplate,
  error,
  onRemove,
}: {
  action?: MobileToolbarAction;
  existingActions?: MobileToolbarAction[];
  commandTemplate?: string;
  error?: string;
  onRemove?: () => void;
  onSave: (action: MobileToolbarAction) => void;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const [picking, setPicking] = React.useState(!action);
  const initial = describeToolbarSequence(action?.sequence ?? '');
  const [draft, setDraft] = React.useState<MobileToolbarAction>(() =>
    action ? { ...action } : { id: crypto.randomUUID(), label: '', sequence: '' },
  );
  const [type, setType] = React.useState<'key' | 'text' | 'combo' | 'advanced'>(() =>
    initial.kind === 'key' &&
    !TOOLBAR_SHORTCUTS.some(
      (key) =>
        decodeToolbarSequence(key.sequence) === decodeToolbarSequence(action?.sequence ?? ''),
    )
      ? 'combo'
      : action
        ? initial.kind
        : 'key',
  );
  const [validCombo, setValidCombo] = React.useState(true);
  const [combo, setCombo] = React.useState(
    initial.combo ?? { key: 'ArrowLeft', shift: true, ctrl: false, alt: false },
  );
  const [text, setText] = React.useState(initial.kind === 'text' ? initial.value : '');
  const [enter, setEnter] = React.useState(initial.enter ?? false);
  const [nameTouched, setNameTouched] = React.useState(
    !!action && action.label !== initial.value.trim(),
  );
  const panel = React.useRef<HTMLDivElement>(null);
  const scroll = React.useRef<HTMLDivElement>(null);
  const textInput = React.useRef<HTMLTextAreaElement>(null);
  useKeyboardLayer(panel, true, onCancel);
  useTouchScrollBoundary(scroll, true);
  React.useLayoutEffect(() => {
    if (!action && !picking && type === 'text') focusKeyboardInput(textInput.current);
  }, [action, picking, type]);
  const updateSequence = (sequence: string, label: string) =>
    setDraft((current) => {
      const { doubleTapSequence, ...rest } = current;
      const sameKey = decodeToolbarSequence(current.sequence) === decodeToolbarSequence(sequence);
      return {
        ...rest,
        sequence,
        label: nameTouched ? current.label : label,
        ...(sameKey && doubleTapSequence !== undefined ? { doubleTapSequence } : {}),
      };
    });
  const updateText = (next: string, submit: boolean) => {
    setText(next);
    setEnter(submit);
    const sequence = buildToolbarTextSequence(next, submit, action?.sequence ?? commandTemplate);
    setDraft((current) => ({
      ...current,
      sequence,
      label: nameTouched ? current.label : next.trim().slice(0, 24),
      // Keep the common "double-tap to submit" behavior linked to edited text.
      ...(current.doubleTapSequence &&
      describeToolbarSequence(current.doubleTapSequence).kind === 'text' &&
      describeToolbarSequence(current.doubleTapSequence).value ===
        describeToolbarSequence(current.sequence).value &&
      describeToolbarSequence(current.doubleTapSequence).enter
        ? { doubleTapSequence: buildToolbarTextSequence(next, true, current.doubleTapSequence) }
        : {}),
    }));
  };
  const summary = describeToolbarSequence(draft.sequence);
  const summaryText =
    summary.kind === 'key'
      ? t('toolbarPresets.pressSummary', { key: summary.value })
      : summary.kind === 'text'
        ? t(summary.enter ? 'toolbarPresets.submitSummary' : 'toolbarPresets.typeSummary', {
            text: summary.value,
          })
        : t('toolbarPresets.customSummary');
  const valid =
    !!draft.sequence.trim() &&
    (type !== 'combo' || validCombo) &&
    (type !== 'text' || !!text.trim());
  const inputClass =
    'min-h-11 w-full min-w-0 rounded-xl border border-border/40 bg-surface-2 px-3 py-2 text-sm outline-none focus:border-primary';
  return createPortal(
    <div
      className="fixed inset-0 z-modal-editor flex items-center justify-center bg-[var(--app-backdrop)] preview-safe-area [--preview-safe-area-gap:0.75rem]"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={t(action ? 'toolbarPresets.saveAction' : 'toolbarPresets.addButton')}
        tabIndex={-1}
        className="font-sans flex max-h-full w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-border bg-surface text-foreground shadow-xl"
      >
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-border/30 px-4 py-2">
          {!action && !picking && <button type="button" aria-label={t('toolbarPresets.backToKeys')} onClick={() => setPicking(true)} className="-ml-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-muted-foreground hover:bg-surface-2"><ArrowLeft size={19} /></button>}
          <h3 className="text-base font-medium">
            {action ? action.label : picking ? t('toolbarPresets.addButton') : t(type === 'combo' ? 'toolbarPresets.combination' : 'toolbarPresets.inputText')}
          </h3>
          <div className="ml-auto flex items-center gap-1">
            {onRemove && (
              <button
                type="button"
                aria-label={t('toolbarPresets.removeButton')}
                title={t('toolbarPresets.removeButton')}
                onClick={onRemove}
                className="flex h-11 w-11 items-center justify-center rounded-xl text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
              >
                <Trash2 size={17} />
              </button>
            )}
            <button
              type="button"
              className="flex h-11 w-11 items-center justify-center rounded-xl hover:bg-surface-2"
              aria-label={t('common.cancel')}
              onClick={onCancel}
            >
              <X size={18} />
            </button>
          </div>
        </header>
        <div ref={scroll} className="min-h-0 space-y-4 overflow-y-auto overscroll-contain p-4">
          {picking ? <ToolbarActionLibrary actions={existingActions} onKey={onSave} onCustom={mode => {
            setPicking(false); setType(mode); setValidCombo(true);
            if (mode === 'text') updateText(text, enter);
            else updateSequence(encodeToolbarKeyCombo(combo) ?? '', getToolbarKeyComboLabel(combo));
          }} /> : <>
          {action && <fieldset>
            <legend className="mb-2 text-sm font-medium">{t('toolbarPresets.actionType')}</legend>
            <div className="grid grid-cols-3 gap-1 rounded-xl bg-surface-2 p-1">
              {(['key', 'text', 'combo'] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  aria-pressed={type === mode}
                  className={`min-h-11 rounded-lg px-1 text-xs font-medium ${type === mode ? 'bg-surface text-primary ring-1 ring-primary' : 'text-muted-foreground hover:bg-surface-elevated'}`}
                  onClick={() => {
                    if (mode === type) return;
                    setType(mode);
                    setValidCombo(true);
                    if (mode === 'text') updateText(text, enter);
                    if (mode === 'combo')
                      updateSequence(
                        encodeToolbarKeyCombo(combo) ?? '',
                        getToolbarKeyComboLabel(combo),
                      );
                  }}
                >
                  {t(
                    mode === 'key'
                      ? 'toolbarPresets.commonKeys'
                      : mode === 'text'
                        ? 'toolbarPresets.inputText'
                        : 'toolbarPresets.combination',
                  )}
                </button>
              ))}
            </div>
          </fieldset>}
          {type === 'key' && (
            <fieldset>
              <legend className="sr-only">{t('toolbarPresets.chooseKey')}</legend>
              <div className="grid grid-cols-3 gap-2">
                {TOOLBAR_SHORTCUTS.map((key) => (
                  <button
                    key={key.id}
                    type="button"
                    aria-pressed={
                      decodeToolbarSequence(draft.sequence) === decodeToolbarSequence(key.sequence)
                    }
                    className={`flex min-h-[4.25rem] min-w-0 items-center justify-between gap-1 rounded-xl border px-2 py-2 text-left ${decodeToolbarSequence(draft.sequence) === decodeToolbarSequence(key.sequence) ? 'border-primary bg-surface-2' : 'border-border/30 bg-surface-2 hover:bg-surface-elevated'}`}
                    onClick={() => updateSequence(key.sequence, key.label)}
                  >
                    <span className="min-w-0">
                      <span className="block text-sm font-medium">{key.label}</span>
                      <span className="block text-[11px] text-muted-foreground">
                        {t(`toolbarPresets.key_${key.id}`)}
                      </span>
                    </span>
                    {decodeToolbarSequence(draft.sequence) ===
                      decodeToolbarSequence(key.sequence) && (
                      <Check size={14} className="shrink-0 text-primary" />
                    )}
                  </button>
                ))}
              </div>
            </fieldset>
          )}
          {type === 'text' && (
            <div className="space-y-3">
              <label className="block space-y-1.5 text-sm">
                <span>{t('toolbarPresets.textContent')}</span>
                <textarea
                  ref={textInput}
                  rows={2}
                  className={inputClass}
                  value={text}
                  placeholder={t('toolbarPresets.textPlaceholder')}
                  onChange={(event) => updateText(event.target.value, enter)}
                  autoCapitalize="off"
                  autoCorrect="off"
                  spellCheck={false}
                />
              </label>
              <label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-xl bg-surface-2 p-3">
                <input
                  className="mt-1 h-4 w-4 accent-[var(--primary)]"
                  type="checkbox"
                  checked={enter}
                  onChange={(event) => updateText(text, event.target.checked)}
                />
                <span>
                  <span className="block text-sm">{t('toolbarPresets.sendEnter')}</span>

                </span>
              </label>
            </div>
          )}
          {type === 'combo' && (
            <ToolbarKeyComboPicker
              embedded
              initialCombo={combo}
              onChange={(sequence, label, next) => {
                setCombo(next);
                setValidCombo(sequence !== null);
                if (sequence !== null) updateSequence(sequence, label);
              }}
            />
          )}
          <details open={action ? true : undefined} className="rounded-xl border border-border/30">
            <summary className="flex min-h-16 cursor-pointer items-center gap-3 px-3 py-3 [&::-webkit-details-marker]:hidden" aria-label={t('toolbarPresets.renameAction')}>
              <span className="flex min-h-10 min-w-16 max-w-[80%] items-center justify-center gap-2 rounded-lg border border-border/40 bg-surface-2 px-4 py-2 font-mono text-sm shadow-[0_2px_0_var(--border)]"><span className="truncate">{draft.label.trim() || summary.value.trim() || '…'}</span>{summary.enter && <CornerDownLeft size={14} className="shrink-0 text-muted-foreground" />}</span>
              <Pencil size={14} className="text-muted-foreground" />
            </summary>
            <div className="px-3 pb-3">
          <label className="block space-y-1.5 text-sm">
            <span>{t('toolbarPresets.actionName')}</span>
            <input
              className={inputClass}
              value={draft.label}
              placeholder={t('toolbarPresets.namePlaceholder')}
              onChange={(event) => {
                setNameTouched(true);
                setDraft((current) => ({ ...current, label: event.target.value }));
              }}
            />
          </label>
            </div>
          </details>
          <details
            open={type === 'advanced' ? true : undefined}
            className="rounded-xl border border-border/30"
          >
            <summary className="cursor-pointer px-3 py-3 text-sm text-muted-foreground">
              {t('toolbarPresets.advanced')}
            </summary>
            <div className="space-y-3 px-3 pb-3">
              <p className="text-xs text-muted-foreground">{t('toolbarPresets.advancedHint')}</p>
              <label className="block space-y-1.5 text-sm">
                <span>{t('toolbarPresets.sequence')}</span>
                <input
                  className={`${inputClass} font-mono`}
                  value={escapeToolbarSequence(draft.sequence)}
                  onChange={(event) => {
                    setType('advanced');
                    setDraft((current) => ({ ...current, sequence: event.target.value }));
                  }}
                  autoCapitalize="off"
                  autoCorrect="off"
                  spellCheck={false}
                />
              </label>
              <p className="text-xs text-muted-foreground">{t('toolbarPresets.sequenceHelp')}</p>
              <ToolbarKeyComboPicker
                onInsert={(sequence) => {
                  setType('advanced');
                  setDraft((current) => ({
                    ...current,
                    sequence: escapeToolbarSequence(current.sequence) + sequence,
                  }));
                }}
              />
              <label className="block space-y-1.5 text-sm">
                <span>{t('toolbarPresets.doubleTap')}</span>
                <input
                  className={`${inputClass} font-mono`}
                  value={escapeToolbarSequence(draft.doubleTapSequence ?? '')}
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, doubleTapSequence: event.target.value }))
                  }
                  autoCapitalize="off"
                  autoCorrect="off"
                  spellCheck={false}
                />
              </label>
              <p className="text-xs text-muted-foreground">{t('toolbarPresets.doubleTapHelp')}</p>
              <ToolbarKeyComboPicker
                onInsert={(sequence) =>
                  setDraft((current) => ({
                    ...current,
                    doubleTapSequence:
                      escapeToolbarSequence(current.doubleTapSequence ?? '') + sequence,
                  }))
                }
              />
            </div>
          </details>
          </>}
        </div>
        {picking ? error && <p role="alert" className="shrink-0 border-t border-border/30 px-4 py-3 text-sm text-destructive">{error}</p> : <footer className="shrink-0 space-y-2 border-t border-border/30 bg-surface px-4 py-3">
          <p
            role={error ? 'alert' : 'status'}
            className={`text-xs ${error ? 'text-destructive' : 'truncate text-muted-foreground'}`}
          >
            {error || (valid ? summaryText : t('toolbarPresets.emptyAction'))}
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              className="min-h-11 rounded-xl bg-surface-2 px-4 text-sm hover:bg-surface-elevated"
              onClick={onCancel}
            >
              {t('common.cancel')}
            </button>
            <button
              type="button"
              disabled={!valid}
              className="min-h-11 flex-1 rounded-xl bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-40"
              onClick={() => {
                const { doubleTapSequence, ...rest } = draft;
                onSave({
                  ...rest,
                  label: draft.label.trim() || summary.value.trim().slice(0, 24) || 'Key',
                  ...(doubleTapSequence?.trim() ? { doubleTapSequence } : {}),
                });
              }}
            >
              {t(action ? 'toolbarPresets.saveAction' : 'toolbarPresets.addAction')}
            </button>
          </div>
        </footer>}
      </div>
    </div>,
    document.body,
  );
}
