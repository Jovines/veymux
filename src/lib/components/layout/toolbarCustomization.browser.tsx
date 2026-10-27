import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { afterEach, expect, it } from 'vitest';
import { commands, page, userEvent } from 'vitest/browser';
import '../../../index.css';
import { type ToolbarSaveState } from '../settings/ToolbarPresetSettings';
import {
  createDefaultToolbarPresets,
  sanitizeToolbarPresets,
  getToolbarRuntimeActions,
  type ToolbarPresetDefinition,
} from '../terminal/mobileKeyboardPresets';
import { MobileKeyboard } from '../terminal/MobileKeyboard';
import { ToolbarSettingsDialog } from '../settings/ToolbarSettingsDialog';

declare module 'vitest/browser' {
  interface BrowserCommands { toolbarActionDrag(from: string, to: string, touch?: boolean): Promise<void> }
}

let root: Root | undefined;
let presets: ToolbarPresetDefinition[];
let setSaveState: (state: ToolbarSaveState) => void;
const terminalInputs: string[] = [];
function Fixture({
  initiallyOpen = true,
  mobile = window.innerWidth <= 768,
}: {
  initiallyOpen?: boolean;
  mobile?: boolean;
}) {
  const [items, setItems] = React.useState(createDefaultToolbarPresets);
  const [selectedPresetId, onSelectPreset] = React.useState('default');
  const [open, setOpen] = React.useState(initiallyOpen);
  const [runtimeMode, setRuntimeMode] = React.useState('auto');
  const runtimePreset = items.find(
    (preset) => preset.id === (runtimeMode === 'auto' ? 'default' : runtimeMode),
  )!;
  const [saveState, updateSaveState] = React.useState<ToolbarSaveState>('saved');
  presets = items;
  setSaveState = updateSaveState;
  return (
    <>
      {!open && (
        <div
          data-runtime-toolbar
          className="fixed inset-x-0 bottom-0"
          style={{ paddingBottom: 'var(--safe-bottom-inset, 0px)' }}
        >
          <MobileKeyboard
            visible
            defaultShowExtended
            presentation={mobile ? 'mobile' : 'desktop-actions'}
            activeModifier={null}
            lockedModifier={null}
            disabled={false}
            presetLabel={runtimePreset.label}
            presetModeLabel="Switch toolbar"
            presetMode={runtimeMode}
            presetOptions={[{ id: 'auto', label: 'Auto' }]}
            includeAlt={runtimePreset.includeAlt}
            presetRowLayout={runtimePreset.rowLayout}
            extraActions={getToolbarRuntimeActions(runtimePreset)}
            onKeyPress={(key) => terminalInputs.push(key)}
            onTextPress={(sequence) => terminalInputs.push(sequence)}
            onPastePress={() => {}}
            onFilePress={() => {}}
            onModifierToggle={() => {}}
            onPresetSelect={() => {}}
            onConfigureToolbar={() => {
              onSelectPreset(runtimePreset.id);
              setOpen(true);
            }}
          />
        </div>
      )}
      {open && (
        <ToolbarSettingsDialog
          presets={items}
          selectedPresetId={selectedPresetId}
          onSelectPreset={onSelectPreset}
          onChange={(next) => setItems(sanitizeToolbarPresets(next))}
          saveState={saveState}
          onRetry={() => updateSaveState('saved')}
          onReload={() => updateSaveState('saved')}
          previewMode={runtimePreset.id === selectedPresetId ? runtimeMode : selectedPresetId}
          onUsePreset={() => {
            setRuntimeMode(runtimePreset.id === selectedPresetId ? runtimeMode : selectedPresetId);
            setOpen(false);
          }}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
afterEach(async () => {
  terminalInputs.length = 0;
  root?.unmount();
  root = undefined;
  document.body.replaceChildren();
  document.documentElement.removeAttribute('style');
  delete document.documentElement.dataset.veymuxTouchViewport;
  await page.viewport(390, 844);
});

it.each([
  [390, 844],
  [320, 568],
  [1280, 900],
])('supports adding, cancelling and editing at %i × %i', async (width, height) => {
  await page.viewport(width, height);
  const host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  flushSync(() => root!.render(<Fixture />));
  const add = page.getByRole('button', { name: 'Add button', exact: true });
  const addElement = Array.from(
    document.querySelectorAll<HTMLButtonElement>('[data-toolbar-settings] button'),
  ).find((button) => button.textContent?.trim() === 'Add button')!;
  expect(addElement.getBoundingClientRect().bottom).toBeLessThan(height);
  expect(
    document.querySelector('[data-toolbar-settings]')!.getBoundingClientRect().right,
  ).toBeLessThanOrEqual(width);
  await add.click();
  const child = document.querySelector('[aria-label="Add button"][role="dialog"]')!;
  const bounds = child.getBoundingClientRect();
  expect(bounds.top).toBeGreaterThanOrEqual(0);
  expect(bounds.bottom).toBeLessThanOrEqual(height);
  expect(
    document.elementFromPoint(bounds.left + 15, bounds.top + 15)?.closest('[role="dialog"]'),
  ).toBe(child);
  await page.getByRole('button', { name: 'Command or text', exact: true }).click();
  await page.getByRole('textbox', { name: 'Text or command to type' }).fill('git status');
  await userEvent.keyboard('{Escape}');
  expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
  expect(presets.find((item) => item.id === 'default')!.actions).toHaveLength(0);
  expect(document.activeElement).toBe(addElement);
  await add.click();
  await page.getByRole('button', { name: 'Command or text', exact: true }).click();
  await page.getByRole('textbox', { name: 'Text or command to type' }).fill('git status');
  await page.getByRole('checkbox', { name: /Press Enter/ }).click();
  await page.getByRole('button', { name: 'Add to toolbar', exact: true }).click();
  expect(presets.find((item) => item.id === 'default')!.actions.at(-1)?.sequence).toBe(
    'git status\\r',
  );
  expect(presets.find((item) => item.id === 'default')!.actions.map((item) => item.label)).toEqual(
    width > 768
      ? ['Esc', 'Ctrl+C', 'Ctrl+D', 'Home', 'End', 'git status']
      : ['Home', 'End', 'Ctrl+D', 'git status'],
  );
  flushSync(() => setSaveState('error'));
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  expect(document.querySelector('[data-toolbar-settings]')!.textContent).toContain('Saved');
  await userEvent.keyboard('{Escape}');
  expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(0);
});

it('keeps editor input and its save action reachable when the viewport shrinks', async () => {
  const host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  flushSync(() => root!.render(<Fixture />));
  await page.getByRole('button', { name: 'Add button', exact: true }).click();
  await page.getByRole('button', { name: 'Command or text', exact: true }).click();
  await page.viewport(390, 430);
  await page.getByRole('textbox', { name: 'Text or command to type' }).fill('/compact');
  const save = document.querySelector<HTMLButtonElement>(
    '[role="dialog"][aria-label="Add button"] footer button:last-child',
  )!;
  expect(save.getBoundingClientRect().bottom).toBeLessThanOrEqual(430);
  expect(save.getBoundingClientRect().top).toBeGreaterThan(0);
  await page.elementLocator(save).click();
  expect(presets.find((item) => item.id === 'default')!.actions.at(-1)?.sequence).toBe('/compact');
});

it.each([320, 390, 1280])('adds a ready-made key in one tap at %i px and can undo it', async width => {
  await page.viewport(width, width === 320 ? 568 : 844);
  const host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  flushSync(() => root!.render(<Fixture />));
  await page.getByRole('button', { name: 'Add button', exact: true }).click();
  const library = document.querySelector<HTMLElement>('[role="dialog"][aria-label="Add button"]')!;
  expect(library.querySelector('input, textarea')).toBeNull();
  expect(library.querySelector('footer')).toBeNull();
  await expect.element(page.getByRole('button', { name: 'Home is on the toolbar', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Add Tab', exact: true }).click();
  expect(document.querySelector('[role="dialog"][aria-label="Add button"]')).toBeNull();
  expect(presets.find(item => item.id === 'default')!.actions.at(-1)).toMatchObject({ label: 'Tab', sequence: '\\t' });
  expect(terminalInputs).toEqual([]);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  expect(presets.find(item => item.id === 'default')!.actions).toEqual([]);
});

it('builds a chord from the visible keyboard and edits the generated keycap name only when requested', async () => {
  await page.viewport(390, 844);
  const host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  flushSync(() => root!.render(<Fixture />));
  await page.getByRole('button', { name: 'Add button', exact: true }).click();
  await page.getByRole('button', { name: 'Key combination', exact: true }).click();
  const editor = document.querySelector<HTMLElement>('[role="dialog"][aria-label="Add button"]')!;
  expect(editor.querySelector('input')?.closest('details')?.open).toBe(false);
  await page.getByRole('button', { name: '→', exact: true }).click();
  await page.getByLabelText('Rename button', { exact: true }).click();
  await page.getByRole('textbox', { name: 'Button name', exact: true }).fill('Select right');
  await page.getByRole('button', { name: 'Add to toolbar', exact: true }).click();
  expect(presets.find(item => item.id === 'default')!.actions.at(-1)).toMatchObject({ label: 'Select right', sequence: '\\u001b[1;2C' });
  expect(terminalInputs).toEqual([]);
});

it.each([390, 1280])(
  'opens configuration from the real terminal toolbar at width %i',
  async (width) => {
    await page.viewport(width, 844);
    const host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    flushSync(() => root!.render(<Fixture initiallyOpen={false} />));
    await page.getByRole('button', { name: 'Switch or customize toolbar', exact: true }).click();
    await page.getByRole('button', { name: 'Customize toolbar…', exact: true }).click();
    expect(document.querySelector('[data-toolbar-settings]')).not.toBeNull();
    await page.getByRole('button', { name: 'Done', exact: true }).click();
    expect(document.querySelector('[data-toolbar-settings]')).toBeNull();
    expect(document.querySelector('[data-mobile-keyboard]')).not.toBeNull();
  },
);

function toolbarGeometry(element: HTMLElement) {
  const bounds = element.getBoundingClientRect();
  return {
    width: bounds.width,
    height: bounds.height,
    left: bounds.left,
    bottom: bounds.bottom,
    primaryRows: element.querySelectorAll('[data-mobile-keyboard-primary-row]').length,
    expandedRows: Array.from(
      element.querySelectorAll('[data-mobile-keyboard-expanded-row]'),
      (row) => getComputedStyle(row).gridTemplateColumns,
    ),
    buttons: Array.from(element.querySelectorAll('button'), (button) => {
      const rect = button.getBoundingClientRect(),
        style = getComputedStyle(button);
      return {
        text: button.textContent,
        x: rect.x - bounds.x,
        y: rect.y - bounds.y,
        width: rect.width,
        height: rect.height,
        font: style.fontSize,
        fontFamily: style.fontFamily,
        background: style.backgroundColor,
        doubleTap: !!button.querySelector('.rounded-full.bg-accent\\/60'),
      };
    }),
  };
}

it.each([320, 390, 1280])('fills every toolbar row, including a single remaining key, at %i px', async width => {
  await page.viewport(width, 844);
  const host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  flushSync(() => root!.render(<MobileKeyboard visible defaultShowExtended presentation="mobile" activeModifier={null} lockedModifier={null} disabled={false}
    presetLabel="Custom" presetModeLabel="Custom" presetMode="manual" presetOptions={[]} includeAlt={false} presetRowLayout={[4]}
    extraActions={Array.from({ length: 4 }, (_, i) => ({ id: `key-${i}`, label: `Key ${i}`, sequence: String(i) }))}
    onKeyPress={() => {}} onTextPress={() => {}} onModifierToggle={() => {}} onPresetSelect={() => {}} onPastePress={() => {}} onFilePress={() => {}} />));
  const rows = [...document.querySelectorAll<HTMLElement>('[data-mobile-keyboard-expanded-row]')];
  expect(rows).toHaveLength(2);
  for (const row of rows) {
    const buttons = [...row.querySelectorAll<HTMLButtonElement>('button')];
    expect(buttons.at(-1)!.getBoundingClientRect().right).toBeCloseTo(row.getBoundingClientRect().right, 1);
  }
  expect(rows[1].querySelector('button')!.getBoundingClientRect().width).toBeCloseTo(rows[1].getBoundingClientRect().width, 1);
});

it.each([
  { width: 390, height: 844, preset: 'codex', safeTop: 47, safeBottom: 34, mobile: true },
  { width: 320, height: 568, preset: 'default', safeTop: 20, safeBottom: 0, mobile: true },
  { width: 844, height: 390, preset: 'customagent', safeTop: 0, safeBottom: 0, mobile: true },
  { width: 1280, height: 900, preset: 'codex', safeTop: 0, safeBottom: 0, mobile: false },
])(
  'matches the applied $preset toolbar at $width × $height, including fixed keys and safe areas',
  async ({ width, height, preset, safeTop, safeBottom, mobile }) => {
    await page.viewport(width, height);
    document.documentElement.style.setProperty('--safe-top-inset', `${safeTop}px`);
    document.documentElement.style.setProperty('--safe-bottom-inset', `${safeBottom}px`);
    const host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    flushSync(() => root!.render(<Fixture mobile={mobile} />));
    await page
      .getByRole('button', {
        name: preset === 'default' ? 'General terminal' : preset === 'codex' ? 'Codex' : 'CustomAgent',
        exact: true,
      })
      .click();
    await page.getByRole('button', { name: mobile ? 'Mobile' : 'Desktop', exact: true }).click();
    if (preset === 'customagent') await page.getByRole('button', { name: '4 per row', exact: true }).click();
    const dialog = document.querySelector('.toolbar-settings-dialog')!;
    expect(dialog.getBoundingClientRect().left).toBe(0);
    expect(dialog.getBoundingClientRect().top).toBe(0);
    expect(dialog.getBoundingClientRect().width).toBe(width);
    expect(dialog.getBoundingClientRect().height).toBe(height);
    const preview = document.querySelector<HTMLElement>(
      '[data-toolbar-preview] [data-mobile-keyboard]',
    )!;
    const before = toolbarGeometry(preview);
    expect(before.width).toBe(width);
    expect(before.bottom).toBe(height - safeBottom);
    expect(before.primaryRows).toBe(mobile ? 1 : 0);
    if (preset === 'codex') {
      const action = preview.querySelector<HTMLButtonElement>('[aria-label="Edit ⇧←"]')!;
      await page.elementLocator(action).click();
      expect(document.querySelector('[role="dialog"][aria-label="Save button"]')).not.toBeNull();
      await userEvent.keyboard('{Escape}');
      expect(terminalInputs).toEqual([]);
    }
    await page.getByRole('button', { name: 'Use in this terminal', exact: true }).click();
    const actual = document.querySelector<HTMLElement>(
      '[data-runtime-toolbar] [data-mobile-keyboard]',
    )!;
    expect(toolbarGeometry(actual)).toEqual(before);
    expect(terminalInputs).toEqual([]);
  },
);

it.each([false, true])(
  'reorders keycaps with a real drag and updates the preview, touch=%s',
  async (touch) => {
    await page.viewport(390, 844);
    const host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    flushSync(() => root!.render(<Fixture />));
    await commands.toolbarActionDrag('default-default-home', 'default-default-end', touch);
    await expect
      .poll(() => presets.find((item) => item.id === 'default')!.actions.map((item) => item.label))
      .toEqual(['End', 'Home', 'Ctrl+D']);
    const previewLabels = Array.from(
      document.querySelectorAll<HTMLButtonElement>(
        '[data-toolbar-preview] [data-mobile-keyboard-expanded-row] button',
      ),
      (button) => button.textContent,
    );
    expect(previewLabels.slice(-3)).toEqual(['End', 'Home', 'Ctrl+D']);
    expect(document.querySelector('[role="dialog"][aria-label="Save button"]')).toBeNull();
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    expect(presets.find((item) => item.id === 'default')!.actions).toEqual([]);
  },
);

it('reorders by keyboard, and Escape cancels only the drag before closing the page', async () => {
  const host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  flushSync(() => root!.render(<Fixture />));
  await page.getByRole('button', { name: 'Reorder Home', exact: true }).click();
  await userEvent.keyboard('[Space]');
  await userEvent.keyboard('[ArrowRight]');
  await userEvent.keyboard('[Escape]');
  expect(document.querySelector('.toolbar-settings-dialog')).not.toBeNull();
  expect(presets.find((item) => item.id === 'default')!.actions).toEqual([]);
  await page.getByRole('button', { name: 'Reorder Home', exact: true }).click();
  await userEvent.keyboard('[Space]');
  await userEvent.keyboard('[ArrowRight]');
  await userEvent.keyboard('[Space]');
  await expect
    .poll(() => presets.find((item) => item.id === 'default')!.actions.map((item) => item.label))
    .toEqual(['End', 'Home', 'Ctrl+D']);
});

it('keeps the selected mobile toolbar visible without a hidden chooser', async () => {
  const host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  flushSync(() => root!.render(<Fixture />));
  await page.getByRole('button', { name: 'Codex', exact: true }).click();
  const strip = document.querySelector('[role="group"][aria-label="Toolbar to customize"]')!;
  const selected = strip.querySelector('[aria-pressed="true"]')!;
  expect(selected.getBoundingClientRect().left).toBeGreaterThanOrEqual(
    strip.getBoundingClientRect().left,
  );
  expect(selected.getBoundingClientRect().right).toBeLessThanOrEqual(
    strip.getBoundingClientRect().right + 1,
  );
  expect(document.querySelector('[data-toolbar-button-canvas]')).not.toBeNull();
  expect(document.querySelector('[data-toolbar-settings] select')).toBeNull();
});
