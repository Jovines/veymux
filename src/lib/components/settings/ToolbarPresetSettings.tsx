import React from 'react';
import { createPortal } from 'react-dom';
import {
  Trash2,
  Undo2,
  Copy,
  TerminalSquare,
  Keyboard,
  Settings2,
  Smartphone,
  Monitor,
  Check,
  Loader2,
  Wand2,
  Hand,
  X,
  ChevronRight,
} from 'lucide-react';
import { X as RiCloseLine, Plus as RiAddLine, Minus as RiSubtractLine } from 'lucide-react';
import {
  createDefaultToolbarPresets,
  getToolbarPresetDisplayName,
  isRegexProgramPattern,
  normalizeProgramMatchEntry,
  sanitizeRowLayout,
  sanitizeToolbarPresets,
  decodeToolbarSequence,
  getToolbarRuntimeActions,
  type ToolbarPresetMode,
  tryCompileProgramRegex,
  type MobileToolbarAction,
  type ToolbarPresetDefinition,
} from '../terminal/mobileKeyboardPresets';
import { MobileKeyboard } from '../terminal/MobileKeyboard';
import { editableToolbarActions } from '../../terminal/toolbarCustomization';
import { useI18n } from '../../i18n';
import { usesTouchTerminalLayout } from '../../utils/touchTerminalLayout';
import { useKeyboardLayer } from '../../hooks/useKeyboardLayer';
import { Switch } from '../ui/Switch';
import { ToolbarActionEditor } from './ToolbarActionEditor';
import { ToolbarButtonCanvas, ToolbarArrangement } from './ToolbarButtonCanvas';

export type ToolbarSaveState = 'loading' | 'saved' | 'saving' | 'error' | 'load-error' | 'conflict';
export interface ToolbarPresetSettingsProps {
  presets: ToolbarPresetDefinition[];
  selectedPresetId: string;
  onSelectPreset: (presetId: string) => void;
  onChange: (presets: ToolbarPresetDefinition[]) => void;
  saveState?: ToolbarSaveState;
  onRetry?: () => void;
  onReload?: () => void;
  previewTarget?: HTMLElement | null;
  previewMode?: ToolbarPresetMode;
  onUsePreset?: () => void;
}

function ConfirmToolbarChange({
  title,
  hint,
  onConfirm,
  onCancel,
}: {
  title: string;
  hint: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const panel = React.useRef<HTMLDivElement>(null);
  useKeyboardLayer(panel, true, onCancel);
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
        aria-label={title}
        tabIndex={-1}
        className="w-full max-w-sm space-y-4 rounded-2xl border border-border bg-surface p-5 shadow-xl"
      >
        <h3 className="font-medium">{title}</h3>
        <p className="text-sm text-muted-foreground">{hint}</p>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            className="min-h-11 rounded-xl bg-surface-2 px-4 text-sm"
            onClick={onCancel}
          >
            {t('common.cancel')}
          </button>
          <button
            type="button"
            className="min-h-11 rounded-xl bg-destructive px-4 text-sm text-primary-foreground"
            onClick={onConfirm}
          >
            {t('toolbarPresets.confirmChange')}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function ChipInput({
  value,
  onChange,
  placeholder,
}: {
  value: string[];
  onChange: (next: string[]) => void;
  placeholder: string;
}) {
  const { t } = useI18n();
  const [draft, setDraft] = React.useState('');

  const addChip = (raw: string) => {
    // Split on commas and whitespace, but keep `/regex/flags` segments intact
    // (regex bodies may contain spaces/commas that must NOT be tokenized).
    const tokens: string[] = [];
    let buffer = '';
    let inRegex = false;
    const flush = () => {
      const trimmed = buffer.trim();
      if (trimmed) tokens.push(trimmed);
      buffer = '';
    };
    for (let i = 0; i < raw.length; i += 1) {
      const ch = raw[i];
      if (!inRegex && ch === '/' && buffer.trim().length === 0) {
        inRegex = true;
        buffer += ch;
        continue;
      }
      if (inRegex) {
        buffer += ch;
        if (ch === '/' && raw[i - 1] !== '\\' && buffer.length > 1) {
          // Consume trailing flag chars [gimsuy]*
          while (i + 1 < raw.length && /[gimsuy]/.test(raw[i + 1] ?? '')) {
            i += 1;
            buffer += raw[i];
          }
          flush();
          inRegex = false;
        }
        continue;
      }
      if (ch === ',' || /\s/.test(ch)) {
        flush();
        continue;
      }
      buffer += ch;
    }
    flush();

    if (tokens.length === 0) return;
    const next = [...value];
    for (const token of tokens) {
      const normalized = normalizeProgramMatchEntry(token);
      if (!normalized) continue;
      if (!next.includes(normalized)) next.push(normalized);
    }
    onChange(next);
    setDraft('');
  };

  const removeChip = (token: string) => {
    onChange(value.filter((t) => t !== token));
  };

  const draftTrimmed = draft.trim();
  const draftIsRegex = draftTrimmed.length > 0 && isRegexProgramPattern(draftTrimmed);
  const draftRegexInvalid = draftIsRegex && !tryCompileProgramRegex(draftTrimmed);

  return (
    <div className="rounded-2xl bg-surface px-3 py-2 ring-1 ring-border/15 focus-within:ring-accent/40">
      <div className="flex flex-wrap items-center gap-1.5">
        {value.map((token) => {
          const isRegex = isRegexProgramPattern(token);
          const invalid = isRegex && !tryCompileProgramRegex(token);
          return (
            <span
              key={token}
              className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] ${
                invalid
                  ? 'bg-destructive/15 text-destructive'
                  : isRegex
                    ? 'bg-accent/15 font-mono text-accent'
                    : 'bg-surface-elevated text-foreground'
              }`}
              title={
                isRegex
                  ? invalid
                    ? t('settings.invalidRegex')
                    : 'Regex match'
                  : 'Substring match (case-insensitive)'
              }
            >
              {isRegex && <span className="text-[10px] opacity-70">re</span>}
              {token}
              <button
                type="button"
                onClick={() => removeChip(token)}
                className="rounded-full p-0.5 text-muted-foreground hover:bg-destructive/20 hover:text-destructive"
                aria-label={t('toolbarPresets.removeAction', { name: token })}
              >
                <RiCloseLine size={12} />
              </button>
            </span>
          );
        })}
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || (e.key === ',' && !draftIsRegex)) {
              e.preventDefault();
              addChip(draft);
            } else if (e.key === 'Backspace' && draft.length === 0 && value.length > 0) {
              removeChip(value[value.length - 1]);
            }
          }}
          onBlur={() => addChip(draft)}
          placeholder={value.length === 0 ? placeholder : ''}
          className={`min-w-[8ch] flex-1 bg-transparent py-1 text-sm outline-none placeholder:text-muted/60 ${
            draftIsRegex ? 'font-mono' : ''
          } ${draftRegexInvalid ? 'text-destructive' : ''}`}
          autoCapitalize="off"
          autoCorrect="off"
          autoComplete="off"
        />
      </div>
    </div>
  );
}

function Stepper({
  value,
  min,
  max,
  onChange,
}: {
  value: number;
  min: number;
  max: number;
  onChange: (next: number) => void;
}) {
  const { t } = useI18n();
  return (
    <div className="inline-flex items-center gap-1 rounded-full bg-surface px-1 py-1 ring-1 ring-border/15">
      <button
        type="button"
        onClick={() => onChange(Math.max(min, value - 1))}
        disabled={value <= min}
        className="h-11 w-11 rounded-full bg-surface-2 text-muted-foreground transition hover:bg-surface-elevated disabled:opacity-40 inline-flex items-center justify-center"
        aria-label={t('common.decrease')}
      >
        <RiSubtractLine size={14} />
      </button>
      <span className="w-6 text-center text-sm font-medium tabular-nums text-foreground">
        {value}
      </span>
      <button
        type="button"
        onClick={() => onChange(Math.min(max, value + 1))}
        disabled={value >= max}
        className="h-11 w-11 rounded-full bg-surface-2 text-muted-foreground transition hover:bg-surface-elevated disabled:opacity-40 inline-flex items-center justify-center"
        aria-label={t('common.increase')}
      >
        <RiAddLine size={14} />
      </button>
    </div>
  );
}

function PresetIcon({ id }: { id: string }) {
  return ['codex', 'claude', 'opencode', 'kimi'].includes(id) ? (
    <span
      aria-hidden="true"
      className="h-5 w-5 shrink-0 bg-current"
      style={{
        WebkitMask: `url(/icons/agents/${id}.svg) center / contain no-repeat`,
        mask: `url(/icons/agents/${id}.svg) center / contain no-repeat`,
      }}
    />
  ) : id === 'default' ? (
    <TerminalSquare size={18} />
  ) : (
    <Keyboard size={18} />
  );
}

export const ToolbarPresetSettings: React.FC<ToolbarPresetSettingsProps> = ({
  presets,
  selectedPresetId,
  onSelectPreset,
  onChange,
  saveState = 'saved',
  onRetry,
  onReload,
  previewTarget,
  previewMode = 'auto',
  onUsePreset,
}) => {
  const { t } = useI18n();
  const nav = React.useRef<HTMLDivElement>(null);
  const optionsId = React.useId();
  const [previewDevice, setPreviewDevice] = React.useState<'mobile' | 'desktop'>(() =>
    usesTouchTerminalLayout() || window.innerWidth <= 768 ? 'mobile' : 'desktop',
  );
  const [settingsOpen, setSettingsOpen] = React.useState(false);
  const [highlightedId, setHighlightedId] = React.useState<string | null>(null);
  const [editor, setEditor] = React.useState<{
    presetId: string;
    action?: MobileToolbarAction;
  } | null>(null);
  const [confirm, setConfirm] = React.useState<'delete' | 'reset' | 'reload' | null>(null);
  const [undo, setUndo] = React.useState<{
    before: ToolbarPresetDefinition[];
    after: string;
    selectedId: string;
    message: string;
  } | null>(null);
  const [editorError, setEditorError] = React.useState('');
  const selected = presets.find((preset) => preset.id === selectedPresetId) ?? presets[0];
  React.useLayoutEffect(() => {
    const strip = nav.current;
    const active = strip?.querySelector<HTMLElement>('[aria-pressed="true"]');
    if (!strip || !active || strip.scrollWidth <= strip.clientWidth) return;
    strip.scrollLeft +=
      active.getBoundingClientRect().left -
      strip.getBoundingClientRect().left -
      (strip.clientWidth - active.clientWidth) / 2;
  }, [selected?.id, presets.length]);
  const blocked = saveState === 'loading' || saveState === 'load-error' || saveState === 'conflict';
  if (!selected) return null;
  const displayName = (preset: ToolbarPresetDefinition) =>
    getToolbarPresetDisplayName(preset, t('toolbarPresets.baseName'));
  const actions = editableToolbarActions(selected, previewDevice === 'desktop');
  const commit = (next: ToolbarPresetDefinition[], message = t('toolbarPresets.changed')) => {
    const clean = sanitizeToolbarPresets(next);
    if (JSON.stringify(clean) === JSON.stringify(presets)) return;
    setUndo({ before: presets, after: JSON.stringify(clean), selectedId: selected.id, message });
    setEditorError('');
    onChange(clean);
  };
  const update = (updater: (preset: ToolbarPresetDefinition) => ToolbarPresetDefinition) =>
    commit(presets.map((preset) => (preset.id === selected.id ? updater(preset) : preset)));
  const editActions = (next: MobileToolbarAction[]) =>
    update((preset) => ({ ...preset, actions: next }));
  const canUndo = undo && undo.after === JSON.stringify(presets);
  const openEditor = (action?: MobileToolbarAction) => {
    setEditorError('');
    setEditor({ presetId: selected.id, action });
    setHighlightedId(action?.id ?? null);
  };
  const copyPreset = () => {
    const copy = {
      ...selected,
      id: `preset-${crypto.randomUUID()}`,
      label: t('toolbarPresets.copyName', { name: displayName(selected) }),
      programs: [],
      actions: actions.map((action) => ({ ...action, id: crypto.randomUUID() })),
    };
    commit([...presets, copy]);
    onSelectPreset(copy.id);
    setSettingsOpen(false);
  };
  const statusKey =
    saveState === 'error'
      ? 'toolbarPresets.saveFailed'
      : saveState === 'load-error'
        ? 'toolbarPresets.loadFailed'
        : saveState === 'conflict'
          ? 'toolbarPresets.conflict'
          : saveState === 'loading'
            ? 'toolbarPresets.loading'
            : saveState === 'saving'
              ? 'toolbarPresets.saving'
              : 'toolbarPresets.saved';
  const runtimeActions = getToolbarRuntimeActions(selected);
  const preview = (
    <div
      data-toolbar-preview
      aria-label={t('toolbarPresets.previewFor', { name: displayName(selected) })}
      className="bg-[var(--chrome-bg)]"
    >
      <div className="flex items-center gap-2 border-t border-border/30 px-4 py-2 text-[11px] text-muted-foreground">
        {previewDevice === 'mobile' ? <Smartphone size={12} /> : <Monitor size={12} />}
        <span>{t('toolbarPresets.previewFor', { name: displayName(selected) })}</span>
      </div>
      <MobileKeyboard
        key={previewDevice}
        visible
        defaultShowExtended
        presentation={previewDevice === 'mobile' ? 'mobile' : 'desktop-actions'}
        activeModifier={null}
        lockedModifier={null}
        disabled={blocked}
        presetLabel={displayName(selected)}
        presetModeLabel={t('toolbarPresets.previewFor', { name: displayName(selected) })}
        presetMode={previewMode}
        presetOptions={[]}
        includeAlt={selected.includeAlt}
        presetRowLayout={selected.rowLayout}
        extraActions={runtimeActions}
        onKeyPress={() => {}}
        onTextPress={() => {}}
        onPastePress={() => {}}
        onFilePress={() => {}}
        onModifierToggle={() => {}}
        onPresetSelect={() => {}}
        previewActiveAction={actions.find((action) => action.id === highlightedId)}
        onPreviewAction={(action) => {
          if (blocked) return;
          const target =
            actions.find((item) => item.id === action.id) ??
            actions.find(
              (item) =>
                decodeToolbarSequence(item.sequence) === decodeToolbarSequence(action.sequence),
            );
          if (target) openEditor(target);
        }}
      />
    </div>
  );
  const slotCount =
    1 +
    (previewDevice === 'mobile' && selected.includeAlt ? 1 : 0) +
    (runtimeActions.length || (previewDevice === 'desktop' ? 5 : 3));
  return (
    <div
      data-toolbar-settings
      className="grid min-w-0 gap-5 lg:grid-cols-[12rem_minmax(0,1fr)] lg:gap-8"
    >
      <aside className="min-w-0 lg:sticky lg:top-0 lg:self-start">
        <div className="mb-2 hidden items-center gap-2 px-3 text-xs text-muted-foreground lg:flex">
          <Keyboard size={14} />
          {t('toolbarPresets.presets')}
        </div>
        <div className="flex min-w-0 items-center gap-1 lg:block">
          <div
            ref={nav}
            role="group"
            aria-label={t('toolbarPresets.chooseToolbar')}
            className="flex min-w-0 flex-1 gap-1 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible lg:pb-0"
          >
            {presets.map((preset) => (
              <button
                key={preset.id}
                type="button"
                aria-pressed={selected.id === preset.id}
                onClick={() => {
                  onSelectPreset(preset.id);
                  setSettingsOpen(false);
                  setHighlightedId(null);
                }}
                className={`inline-flex min-h-11 shrink-0 items-center gap-2.5 whitespace-nowrap rounded-xl border px-3 text-sm transition-colors lg:w-full lg:text-left ${selected.id === preset.id ? 'border-primary bg-surface-2 text-primary' : 'border-transparent text-muted-foreground hover:bg-surface-2 hover:text-foreground'}`}
              >
                <PresetIcon id={preset.id} />
                <span className="max-w-36 truncate">{displayName(preset)}</span>
                <span className="ml-auto hidden lg:block">
                  {selected.id === preset.id && <ChevronRight size={14} />}
                </span>
              </button>
            ))}
          </div>
          <button
            type="button"
            disabled={blocked}
            aria-label={t('toolbarPresets.newToolbar')}
            title={t('toolbarPresets.newToolbar')}
            onClick={copyPreset}
            className="flex h-11 shrink-0 items-center justify-center gap-2 rounded-xl px-3 text-muted-foreground hover:bg-surface-2 lg:mt-3 lg:w-full lg:justify-start"
          >
            <Copy size={15} />
            <span className="hidden text-xs lg:inline">{t('toolbarPresets.newToolbar')}</span>
          </button>
        </div>
      </aside>
      <div className="min-w-0 space-y-4">
        <div className="flex min-h-11 flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-3">
            <h3 className="truncate text-lg font-medium">{displayName(selected)}</h3>
            <span
              className="inline-flex shrink-0 items-center gap-1 rounded-md bg-surface-2 px-2 py-1 text-[10px] text-muted-foreground"
              title={selected.programs.join(' · ')}
            >
              {selected.id === 'default' || selected.programs.length ? (
                <Wand2 size={11} />
              ) : (
                <Hand size={11} />
              )}
              {t(
                selected.id === 'default' || selected.programs.length
                  ? 'toolbarPresets.autoMatch'
                  : 'toolbarPresets.manualShort',
              )}
            </span>
          </div>
          <div className="flex items-center gap-1">
            <span
              role="status"
              aria-live="polite"
              className={`inline-flex items-center gap-1.5 text-xs ${['error', 'load-error', 'conflict'].includes(saveState) ? 'text-destructive' : 'text-muted-foreground'}`}
              title={canUndo ? undo.message : undefined}
            >
              {saveState === 'saving' || saveState === 'loading' ? (
                <Loader2 size={13} className="animate-spin" />
              ) : saveState === 'saved' ? (
                <Check size={13} />
              ) : null}
              {t(statusKey)}
            </span>
            {saveState === 'error' && onRetry && (
              <button
                type="button"
                className="min-h-11 px-2 text-xs text-primary"
                onClick={onRetry}
              >
                {t('common.retry')}
              </button>
            )}
            {(saveState === 'load-error' || saveState === 'conflict') && onReload && (
              <button
                type="button"
                className="min-h-11 px-2 text-xs text-primary"
                onClick={() => (saveState === 'conflict' ? setConfirm('reload') : onReload())}
              >
                {t('toolbarPresets.reload')}
              </button>
            )}
            {canUndo && (
              <button
                type="button"
                disabled={blocked}
                aria-label={t('toolbarPresets.undo')}
                title={t('toolbarPresets.undo')}
                className="flex h-11 w-11 items-center justify-center rounded-lg text-primary hover:bg-primary/10"
                onClick={() => {
                  onChange(undo!.before);
                  onSelectPreset(undo!.selectedId);
                  setUndo(null);
                }}
              >
                <Undo2 size={16} />
              </button>
            )}
            {onUsePreset && (
              <button
                type="button"
                disabled={blocked}
                className="min-h-11 rounded-lg bg-primary/15 px-3 text-xs text-primary"
                onClick={onUsePreset}
              >
                {t('toolbarPresets.useInTerminal')}
              </button>
            )}
          </div>
        </div>
        <fieldset
          disabled={blocked}
          className="min-w-0 rounded-2xl border border-border/30 bg-surface p-4 disabled:opacity-50 sm:p-5"
        >
          <div className="mb-4 flex items-center justify-between gap-2">
            <h4 className="text-xs font-medium text-muted-foreground">
              {t('toolbarPresets.buttons')}
            </h4>
            <div className="flex items-center gap-1">
              {(['mobile', 'desktop'] as const).map((device) => (
                <button
                  key={device}
                  type="button"
                  aria-pressed={previewDevice === device}
                  aria-label={t(
                    device === 'mobile'
                      ? 'toolbarPresets.previewMobile'
                      : 'toolbarPresets.previewDesktop',
                  )}
                  title={t(
                    device === 'mobile'
                      ? 'toolbarPresets.previewMobile'
                      : 'toolbarPresets.previewDesktop',
                  )}
                  className={`flex h-11 w-11 items-center justify-center rounded-lg ${previewDevice === device ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-surface-2'}`}
                  onClick={() => {
                    setPreviewDevice(device);
                    setHighlightedId(null);
                  }}
                >
                  {device === 'mobile' ? <Smartphone size={17} /> : <Monitor size={17} />}
                </button>
              ))}
              <span className="mx-1 h-5 border-l border-border/40" />
              <button
                type="button"
                aria-label={t('toolbarPresets.toolbarOptions')}
                title={t('toolbarPresets.toolbarOptions')}
                aria-expanded={settingsOpen}
                aria-controls={optionsId}
                onClick={() => setSettingsOpen((current) => !current)}
                className={`flex h-11 w-11 items-center justify-center rounded-lg ${settingsOpen ? 'bg-surface-2 text-primary' : 'text-muted-foreground hover:bg-surface-2'}`}
              >
                <Settings2 size={17} />
              </button>
            </div>
          </div>
          <ToolbarButtonCanvas
            actions={actions}
            disabled={blocked}
            highlightedId={highlightedId}
            onHighlight={setHighlightedId}
            onEdit={openEditor}
            onAdd={() => openEditor()}
            onReorder={editActions}
          />
          <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border/30 pt-3">
            <span className="text-xs text-muted-foreground">{t('toolbarPresets.arrangement')}</span>
            <ToolbarArrangement
              value={selected.rowLayout}
              count={slotCount}
              onChange={(rowLayout) => update((preset) => ({ ...preset, rowLayout }))}
            />
          </div>
          {previewDevice === 'desktop' && selected.id !== 'default' && !selected.showOnDesktop && (
            <button
              type="button"
              className="mt-2 min-h-11 text-xs text-primary"
              onClick={() => update((preset) => ({ ...preset, showOnDesktop: true }))}
            >
              {t('toolbarPresets.enableDesktop')}
            </button>
          )}
        </fieldset>
        <fieldset disabled={blocked} className="min-w-0 disabled:opacity-50">
          <section
            id={optionsId}
            hidden={!settingsOpen}
            className="rounded-2xl border border-border/30 bg-surface p-4"
          >
            <div className="mb-4 flex items-center justify-between">
              <h4 className="text-sm font-medium">{t('toolbarPresets.toolbarOptions')}</h4>
              <button
                type="button"
                className="flex h-11 w-11 items-center justify-center rounded-xl text-muted-foreground hover:bg-surface-2"
                aria-label={t('common.close')}
                onClick={() => setSettingsOpen(false)}
              >
                <X size={16} />
              </button>
            </div>
            <div className="space-y-4 px-3 pb-4">
              <label className="block space-y-1.5 text-sm">
                <span>{t('toolbarPresets.presetLabelPlaceholder')}</span>
                <input
                  key={`${selected.id}:${selected.label}`}
                  className="min-h-11 w-full rounded-xl bg-surface-2 px-3 outline-none focus:ring-1 focus:ring-primary"
                  defaultValue={selected.label}
                  onBlur={(event) => {
                    const label = event.target.value.trim();
                    if (label) update((preset) => ({ ...preset, label }));
                    else event.target.value = selected.label;
                  }}
                />
              </label>
              {selected.id !== 'default' && (
                <div className="space-y-2">
                  <div className="text-sm">{t('toolbarPresets.programNames')}</div>
                  <ChipInput
                    key={selected.id}
                    value={selected.programs}
                    onChange={(programs) => update((preset) => ({ ...preset, programs }))}
                    placeholder={t('toolbarPresets.programPlaceholder')}
                  />
                  <p className="text-xs text-muted-foreground">{t('toolbarPresets.programHint')}</p>
                </div>
              )}
              <button
                type="button"
                className="flex min-h-11 w-full items-center justify-between gap-3 rounded-xl bg-surface-2 p-3 text-left text-sm"
                aria-pressed={selected.includeAlt}
                onClick={() => update((preset) => ({ ...preset, includeAlt: !preset.includeAlt }))}
              >
                <span>Alt</span>
                <Switch checked={selected.includeAlt} />
              </button>
              {selected.id !== 'default' && (
                <>
                  <button
                    type="button"
                    className="flex min-h-11 w-full items-center justify-between gap-3 rounded-xl bg-surface-2 p-3 text-left text-sm"
                    aria-pressed={selected.showOnDesktop === true}
                    onClick={() =>
                      update((preset) => ({ ...preset, showOnDesktop: !preset.showOnDesktop }))
                    }
                  >
                    <span>{t('toolbarPresets.desktopVisibility')}</span>
                    <Switch checked={selected.showOnDesktop === true} />
                  </button>
                </>
              )}
              <details>
                <summary className="min-h-11 cursor-pointer py-3 text-sm text-muted-foreground">
                  {t('toolbarPresets.customLayout')}
                </summary>
                <div className="space-y-2">
                  {selected.rowLayout.map((columns, index) => (
                    <div
                      key={index}
                      className="flex flex-wrap items-center justify-between gap-1 text-xs"
                    >
                      <span>{t('toolbarPresets.rowN', { n: index + 1 })}</span>
                      <Stepper
                        value={columns}
                        min={2}
                        max={20}
                        onChange={(next) =>
                          update((preset) => ({
                            ...preset,
                            rowLayout: preset.rowLayout.map((value, i) =>
                              i === index ? next : value,
                            ),
                          }))
                        }
                      />
                      {selected.rowLayout.length > 1 && (
                        <button
                          type="button"
                          className="min-h-11 px-3 text-destructive"
                          aria-label={t('toolbarPresets.removeRow', { n: index + 1 })}
                          onClick={() =>
                            update((preset) => ({
                              ...preset,
                              rowLayout: preset.rowLayout.filter((_, i) => i !== index),
                            }))
                          }
                        >
                          <Trash2 size={15} />
                        </button>
                      )}
                    </div>
                  ))}
                  <button
                    type="button"
                    className="min-h-11 px-3 text-primary"
                    onClick={() =>
                      update((preset) => ({
                        ...preset,
                        rowLayout: [...sanitizeRowLayout(preset.rowLayout), 6],
                      }))
                    }
                  >
                    + {t('toolbarPresets.addRow')}
                  </button>
                </div>
              </details>
            </div>

            <div className="flex flex-wrap gap-2">
              {createDefaultToolbarPresets().some((preset) => preset.id === selected.id) && (
                <button
                  type="button"
                  className="min-h-11 rounded-xl bg-surface-2 px-3 text-sm"
                  onClick={() =>
                    update((preset) => {
                      const defaults = createDefaultToolbarPresets().find(
                        (item) => item.id === preset.id,
                      )!;
                      return {
                        ...preset,
                        actions: defaults.actions,
                        rowLayout: defaults.rowLayout,
                        includeAlt: defaults.includeAlt,
                      };
                    })
                  }
                >
                  {t('toolbarPresets.restoreToolbar')}
                </button>
              )}
              {selected.id !== 'default' && (
                <button
                  type="button"
                  className="min-h-11 rounded-xl px-3 text-sm text-destructive"
                  onClick={() => setConfirm('delete')}
                >
                  {t('toolbarPresets.deletePreset', { name: displayName(selected) })}
                </button>
              )}
              <button
                type="button"
                className="min-h-11 px-3 text-xs text-muted-foreground"
                onClick={() => setConfirm('reset')}
              >
                {t('toolbarPresets.restoreAll')}
              </button>
            </div>
          </section>
        </fieldset>
      </div>
      {previewTarget === undefined ? (
        <div className="col-span-full">{preview}</div>
      ) : previewTarget ? (
        createPortal(preview, previewTarget)
      ) : null}
      {editor && (
        <ToolbarActionEditor
          key={`${editor.presetId}:${editor.action?.id ?? 'new'}`}
          action={editor.action}
          existingActions={actions}
          error={editorError}
          onRemove={
            editor.action && actions.length > 1
              ? () => {
                  const target = presets.find((preset) => preset.id === editor.presetId);
                  const current =
                    target && editableToolbarActions(target, previewDevice === 'desktop');
                  if (
                    !target ||
                    !current ||
                    JSON.stringify(current.find((item) => item.id === editor.action!.id)) !==
                      JSON.stringify(editor.action)
                  ) {
                    setEditorError(t('toolbarPresets.staleAction'));
                    return;
                  }
                  commit(
                    presets.map((preset) =>
                      preset.id === target.id
                        ? {
                            ...preset,
                            actions: current.filter((item) => item.id !== editor.action!.id),
                          }
                        : preset,
                    ),
                    t('toolbarPresets.removed'),
                  );
                  setEditor(null);
                }
              : undefined
          }
          commandTemplate={actions.find((action) => action.sequence.startsWith('/||'))?.sequence}
          onCancel={() => setEditor(null)}
          onSave={(action) => {
            if (blocked) {
              setEditorError(t('toolbarPresets.staleAction'));
              return;
            }
            const target = presets.find((preset) => preset.id === editor.presetId);
            const current = target && editableToolbarActions(target, previewDevice === 'desktop');
            if (
              !target ||
              !current ||
              (editor.action &&
                JSON.stringify(current.find((item) => item.id === editor.action!.id)) !==
                  JSON.stringify(editor.action))
            ) {
              setEditorError(t('toolbarPresets.staleAction'));
              return;
            }
            commit(
              presets.map((preset) =>
                preset.id === target.id
                  ? {
                      ...preset,
                      actions: editor.action
                        ? current.map((item) => (item.id === action.id ? action : item))
                        : [...current, action],
                    }
                  : preset,
              ),
            );
            setEditor(null);
          }}
        />
      )}
      {confirm && (
        <ConfirmToolbarChange
          title={t(
            confirm === 'delete'
              ? 'toolbarPresets.deleteTitle'
              : confirm === 'reload'
                ? 'toolbarPresets.reloadTitle'
                : 'toolbarPresets.restoreTitle',
          )}
          hint={t(
            confirm === 'delete'
              ? 'toolbarPresets.deleteHint'
              : confirm === 'reload'
                ? 'toolbarPresets.reloadHint'
                : 'toolbarPresets.restoreHint',
          )}
          onCancel={() => setConfirm(null)}
          onConfirm={() => {
            if (confirm === 'reload') {
              onReload?.();
              setConfirm(null);
              return;
            }
            commit(
              confirm === 'reset'
                ? createDefaultToolbarPresets()
                : presets.filter((preset) => preset.id !== selected.id),
            );
            onSelectPreset('default');
            setConfirm(null);
          }}
        />
      )}
    </div>
  );
};
