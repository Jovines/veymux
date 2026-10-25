import React from 'react';
import { useI18n } from '../../i18n';
import { useKeyboardLayer } from '../../hooks/useKeyboardLayer';
import { useTouchScrollBoundary } from '../../hooks/useTouchScrollBoundary';
import { WorkspacePortal } from '../../services/WorkspacePortal';
import { ToolbarPresetSettings, type ToolbarPresetSettingsProps } from './ToolbarPresetSettings';

/** The preview dock shares the terminal's full viewport width on touch devices. */
export function ToolbarSettingsDialog({
  onClose,
  ...settings
}: ToolbarPresetSettingsProps & { onClose: () => void }) {
  const { t } = useI18n();
  const panel = React.useRef<HTMLDivElement>(null);
  const scroll = React.useRef<HTMLDivElement>(null);
  const [previewTarget, setPreviewTarget] = React.useState<HTMLDivElement | null>(null);
  useKeyboardLayer(panel, true, onClose);
  useTouchScrollBoundary(scroll, true);
  return (
    <WorkspacePortal>
      <button
        type="button"
        aria-label={t('common.close')}
        className="fixed inset-0 z-modal-backdrop bg-[var(--app-backdrop)] backdrop-blur-sm"
        onClick={onClose}
      />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={t('settings.toolbarPresets')}
        className="toolbar-settings-dialog fixed inset-0 z-modal-panel mx-auto flex flex-col overflow-hidden bg-[var(--chrome-bg)] text-foreground"
      >
        <header className="toolbar-settings-header shrink-0 font-sans border-b border-border/30">
          <div className="mx-auto flex min-h-16 w-full max-w-5xl items-center justify-between gap-3 px-4 py-2">
            <h2 className="text-base font-medium">{t('settings.toolbarPresets')}</h2>
            <button
              type="button"
              className="min-h-11 shrink-0 rounded-xl bg-surface-2 px-4 text-sm"
              onClick={onClose}
            >
              {t('toolbarPresets.done')}
            </button>
          </div>
        </header>
        <div
          ref={scroll}
          data-settings-scroll
          className="font-sans mx-auto min-h-0 w-full max-w-5xl flex-1 overflow-y-auto overscroll-contain p-4 sm:px-6 sm:py-8"
        >
          <ToolbarPresetSettings {...settings} previewTarget={previewTarget} />
        </div>
        <div
          ref={setPreviewTarget}
          data-toolbar-preview-dock
          className="toolbar-settings-preview shrink-0 bg-[var(--chrome-bg)]"
        />
      </div>
    </WorkspacePortal>
  );
}
