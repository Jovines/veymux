// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToolbarPresetSettings, type ToolbarSaveState } from './ToolbarPresetSettings';
import { MobileKeyboard } from '../terminal/MobileKeyboard';
import {
  createDefaultToolbarPresets,
  decodeToolbarSequence,
  sanitizeToolbarPresets,
  splitToolbarSequenceSegments,
  type ToolbarPresetDefinition,
} from '../terminal/mobileKeyboardPresets';

beforeEach(() => vi.stubGlobal('innerWidth', 390));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function Fixture({
  presetId = 'customagent',
  saveState,
  onRetry,
  onReload,
}: {
  presetId?: string;
  saveState?: ToolbarSaveState;
  onRetry?: () => void;
  onReload?: () => void;
}) {
  const [presets, setPresets] = React.useState(createDefaultToolbarPresets);
  const [selectedPresetId, onSelectPreset] = React.useState(presetId);
  return (
    <>
      <ToolbarPresetSettings
        {...{ presets, selectedPresetId, onSelectPreset, saveState, onRetry, onReload }}
        onChange={(next) => setPresets(sanitizeToolbarPresets(next))}
      />
      <button
        onClick={() =>
          setPresets((current) =>
            current.map((preset) =>
              preset.id === 'customagent'
                ? {
                    ...preset,
                    actions: preset.actions.map((action, index) =>
                      index === 0 ? { ...action, sequence: 'remote' } : action,
                    ),
                  }
                : preset,
            ),
          )
        }
      >
        Remote edit
      </button>
      <output data-testid="presets">{JSON.stringify(presets)}</output>
    </>
  );
}
function getPresets() {
  return JSON.parse(screen.getByTestId('presets').textContent!) as ToolbarPresetDefinition[];
}
function getPreset(id = 'customagent') {
  return getPresets().find((preset) => preset.id === id)!;
}
function dialog() {
  return within(screen.getByRole('dialog'));
}
function addCombo() {
  fireEvent.click(screen.getByRole('button', { name: 'Add button' }));
  fireEvent.click(dialog().getByRole('button', { name: 'Key combination' }));
}
function saveNew() {
  fireEvent.click(dialog().getByRole('button', { name: 'Add to toolbar' }));
}
function openAdvanced() {
  fireEvent.click(dialog().getByText('Advanced settings', { selector: 'summary' }));
}

describe('toolbar customization journeys', () => {
  it.each(['mobile', 'desktop-actions'] as const)(
    'chooses Shift+Left without codes and sends it from %s',
    (presentation) => {
      const view = render(<Fixture />);
      addCombo();
      expect(getPreset().actions).toHaveLength(6);
      saveNew();
      const preset = getPreset(),
        action = preset.actions.at(-1)!;
      expect(action).toMatchObject({ label: 'Shift+←', sequence: '\\u001b[1;2D' });
      view.unmount();
      const onTextPress = vi.fn();
      render(
        <MobileKeyboard
          visible
          defaultShowExtended
          presentation={presentation}
          activeModifier={null}
          lockedModifier={null}
          disabled={false}
          presetLabel={preset.label}
          presetModeLabel={preset.label}
          presetMode={preset.id}
          presetOptions={[]}
          includeAlt={false}
          presetRowLayout={preset.rowLayout}
          extraActions={preset.actions}
          onKeyPress={vi.fn()}
          onTextPress={onTextPress}
          onPastePress={vi.fn()}
          onFilePress={vi.fn()}
          onModifierToggle={vi.fn()}
          onPresetSelect={vi.fn()}
        />,
      );
      fireEvent.pointerDown(screen.getByRole('button', { name: 'Shift+←' }), {
        pointerType: 'touch',
      });
      expect(decodeToolbarSequence(onTextPress.mock.calls[0][0])).toBe('\x1b[1;2D');
    },
  );

  it.each(['cancel', 'escape', 'backdrop'])(
    'keeps unfinished additions out of the live toolbar (%s)',
    (exit) => {
      render(<Fixture />);
      const before = getPresets();
      fireEvent.click(screen.getByRole('button', { name: 'Add button' }));
      fireEvent.click(dialog().getByRole('button', { name: 'Command or text' }));
      expect((dialog().getByRole('button', { name: 'Add to toolbar' }) as HTMLButtonElement).disabled).toBe(true);
      fireEvent.change(dialog().getByRole('textbox', { name: 'Text or command to type' }), { target: { value: 'unfinished command' } });
      if (exit === 'cancel')
        fireEvent.click(dialog().getAllByRole('button', { name: 'Cancel' })[0]);
      if (exit === 'escape') fireEvent.keyDown(document, { key: 'Escape' });
      if (exit === 'backdrop') fireEvent.mouseDown(screen.getByRole('dialog').parentElement!);
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(getPresets()).toEqual(before);
    },
  );

  it('types literal text, including backslashes and pipes, and optionally presses Enter', () => {
    render(<Fixture />);
    fireEvent.click(screen.getByRole('button', { name: 'Add button' }));
    fireEvent.click(dialog().getByRole('button', { name: 'Command or text' }));
    const text = String.raw`printf '\t' || echo done`;
    fireEvent.change(dialog().getByRole('textbox', { name: 'Text or command to type' }), {
      target: { value: text },
    });
    fireEvent.click(dialog().getByRole('checkbox', { name: /Press Enter/ }));
    fireEvent.click(dialog().getByLabelText('Rename button'));
    fireEvent.change(dialog().getByRole('textbox', { name: 'Button name' }), {
      target: { value: 'My command' },
    });
    saveNew();
    const action = getPreset().actions.at(-1)!;
    expect(action.label).toBe('My command');
    expect(splitToolbarSequenceSegments(action.sequence)).toHaveLength(1);
    expect(decodeToolbarSequence(action.sequence)).toBe(text + '\r');
  });

  it('keeps the default keys when the first custom button is added, and supports undo', () => {
    render(<Fixture presetId="default" />);
    fireEvent.click(screen.getByRole('button', { name: 'Add button' }));
    fireEvent.click(dialog().getByRole('button', { name: 'Add Tab' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(getPreset('default').actions.map((action) => action.label)).toEqual([
      'Home',
      'End',
      'Ctrl+D',
      'Tab',
    ]);
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(getPreset('default').actions).toEqual([]);
  });

  it('adds a common key immediately, recognizes existing keys by sequence, and supports undo', () => {
    render(<Fixture />);
    fireEvent.click(screen.getByRole('button', { name: 'Add button' }));
    expect(dialog().queryByRole('textbox')).toBeNull();
    expect(dialog().queryByRole('button', { name: 'Add to toolbar' })).toBeNull();
    expect((dialog().getByRole('button', { name: 'Shift+← is on the toolbar' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(dialog().getByRole('button', { name: 'Add Home' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(getPreset().actions.at(-1)).toMatchObject({ label: 'Home', sequence: String.raw`\u001b[H` });
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(getPreset().actions).toHaveLength(6);
  });

  it('preserves a command draft while returning to the library and derives its name automatically', () => {
    render(<Fixture />);
    fireEvent.click(screen.getByRole('button', { name: 'Add button' }));
    fireEvent.click(dialog().getByRole('button', { name: 'Command or text' }));
    fireEvent.change(dialog().getByRole('textbox', { name: 'Text or command to type' }), { target: { value: 'git status' } });
    expect(dialog().getByRole('textbox', { name: 'Button name' }).closest('details')?.open).toBe(false);
    fireEvent.click(dialog().getByRole('button', { name: 'Back to button library' }));
    fireEvent.click(dialog().getByRole('button', { name: 'Command or text' }));
    expect(dialog().getByRole('textbox', { name: 'Text or command to type' })).toHaveProperty('value', 'git status');
    saveNew();
    expect(getPreset().actions.at(-1)).toMatchObject({ label: 'git status', sequence: 'git status' });
  });

  it('preserves complex existing sequences and double-tap behavior when renaming', () => {
    render(<Fixture />);
    const before = getPreset().actions[1];
    fireEvent.click(screen.getAllByRole('button', { name: 'Edit /undo' })[0]);
    fireEvent.change(dialog().getByRole('textbox', { name: 'Button name' }), {
      target: { value: 'Undo task' },
    });
    fireEvent.click(dialog().getByRole('button', { name: 'Save button' }));
    expect(getPreset().actions[1]).toEqual({ ...before, label: 'Undo task' });
  });

  it('clears the old double-tap command when a button is changed to a different key', () => {
    render(<Fixture />);
    fireEvent.click(screen.getAllByRole('button', { name: 'Edit /undo' })[0]);
    fireEvent.click(dialog().getByRole('button', { name: 'Common keys' }));
    fireEvent.click(dialog().getByRole('button', { name: /Ctrl\+C Interrupt/ }));
    fireEvent.click(dialog().getByRole('button', { name: 'Save button' }));
    expect(getPreset().actions[1]).toMatchObject({ label: 'Ctrl+C', sequence: '\\u0003' });
    expect(getPreset().actions[1].doubleTapSequence).toBeUndefined();
  });

  it('edits delayed slash commands as ordinary text while retaining timing and double-tap submission', () => {
    render(<Fixture />);
    fireEvent.click(screen.getAllByRole('button', { name: 'Edit /undo' })[0]);
    expect(
      (dialog().getByRole('textbox', { name: 'Text or command to type' }) as HTMLTextAreaElement)
        .value,
    ).toBe('/undo ');
    fireEvent.change(dialog().getByRole('textbox', { name: 'Text or command to type' }), {
      target: { value: '/compact' },
    });
    fireEvent.click(dialog().getByRole('button', { name: 'Save button' }));
    expect(getPreset().actions[1]).toMatchObject({
      label: '/compact',
      sequence: '/||compact ',
      doubleTapSequence: '/||compact ||\\r',
    });
  });

  it('allows advanced sequences and appends chords to the single and double-tap actions', () => {
    render(<Fixture />);
    addCombo();
    openAdvanced();
    fireEvent.change(dialog().getByRole('textbox', { name: 'Sequence' }), {
      target: { value: '/edit||' },
    });
    let picker = dialog()
      .getAllByText('Key combination', { selector: 'summary' })[0]
      .closest('details')!;
    fireEvent.click(within(picker).getByText('Key combination'));
    fireEvent.click(within(picker).getByRole('button', { name: 'Ctrl' }));
    fireEvent.change(within(picker).getByRole('combobox'), { target: { value: 'ArrowRight' } });
    fireEvent.click(within(picker).getByRole('button', { name: 'Insert key combination' }));
    fireEvent.change(dialog().getByRole('textbox', { name: 'Double-tap sequence' }), {
      target: { value: '/edit\\r' },
    });
    picker = dialog()
      .getAllByText('Key combination', { selector: 'summary' })[1]
      .closest('details')!;
    fireEvent.click(within(picker).getByText('Key combination'));
    fireEvent.change(within(picker).getByRole('combobox'), { target: { value: 'F12' } });
    fireEvent.click(within(picker).getByRole('button', { name: 'Alt' }));
    fireEvent.click(within(picker).getByRole('button', { name: 'Insert key combination' }));
    saveNew();
    expect(getPreset().actions.at(-1)).toMatchObject({
      sequence: '/edit||\\u001b[1;6C',
      doubleTapSequence: '/edit\\r\\u001b[24;4~',
    });
  });

  it('blocks an unsupported combination instead of saving a different key', () => {
    render(<Fixture />);
    addCombo();
    fireEvent.click(dialog().getAllByRole('button', { name: 'Ctrl' })[0]);
    fireEvent.change(dialog().getAllByRole('combobox', { name: 'Key' })[0], {
      target: { value: 'Tab' },
    });
    expect(
      (dialog().getByRole('button', { name: 'Add to toolbar' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(dialog().getByText(/The terminal cannot distinguish/)).toBeTruthy();
    expect(getPreset().actions).toHaveLength(6);
  });

  it('does not overwrite a newer remote edit with a stale open editor', () => {
    render(<Fixture />);
    fireEvent.click(screen.getAllByRole('button', { name: 'Edit ⇧←' })[0]);
    fireEvent.change(dialog().getByRole('textbox', { name: 'Button name' }), {
      target: { value: 'Old draft' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Remote edit' }));
    fireEvent.click(dialog().getByRole('button', { name: 'Save button' }));
    expect(getPreset().actions[0].sequence).toBe('remote');
    expect(getPreset().actions[0].label).toBe('⇧←');
    expect(screen.getAllByText(/changed while you were editing/).length).toBeGreaterThan(0);
  });

  it('removes a button from its editor and restores it with undo', () => {
    render(<Fixture />);
    const before = getPreset().actions;
    fireEvent.click(screen.getAllByRole('button', { name: 'Edit ⇧←' })[0]);
    fireEvent.click(dialog().getByRole('button', { name: 'Delete button' }));
    expect(getPreset().actions).toHaveLength(5);
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(getPreset().actions).toEqual(before);
  });

  it('copies a ready-to-use toolbar and confirms destructive resets before applying them', () => {
    render(<Fixture />);
    fireEvent.click(screen.getByRole('button', { name: 'Make a copy' }));
    const copy = getPresets().at(-1)!;
    expect(copy.label).toBe('CustomAgent copy');
    expect(copy.programs).toEqual([]);
    expect(copy.actions.map((action) => action.sequence)).toEqual(
      getPreset().actions.map((action) => action.sequence),
    );
    expect(copy.actions[0].id).not.toBe(getPreset().actions[0].id);
    if (
      screen.getByRole('button', { name: 'Toolbar options' }).getAttribute('aria-expanded') !==
      'true'
    )
      fireEvent.click(screen.getByRole('button', { name: 'Toolbar options' }));
    fireEvent.click(screen.getByRole('button', { name: 'Restore all default toolbars' }));
    fireEvent.click(dialog().getByRole('button', { name: 'Cancel' }));
    expect(getPresets().at(-1)?.id).toBe(copy.id);
    if (
      screen.getByRole('button', { name: 'Toolbar options' }).getAttribute('aria-expanded') !==
      'true'
    )
      fireEvent.click(screen.getByRole('button', { name: 'Toolbar options' }));
    fireEvent.click(screen.getByRole('button', { name: 'Restore all default toolbars' }));
    fireEvent.click(dialog().getByRole('button', { name: 'Confirm' }));
    expect(getPresets()).toHaveLength(7);
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(getPresets().at(-1)?.id).toBe(copy.id);
  });

  it('asks before discarding unsaved local edits after a conflict', () => {
    const onReload = vi.fn();
    render(<Fixture saveState="conflict" onReload={onReload} />);
    fireEvent.click(screen.getByRole('button', { name: 'Reload' }));
    expect(screen.getByRole('dialog', { name: 'Reload saved toolbars?' })).toBeTruthy();
    fireEvent.click(dialog().getByRole('button', { name: 'Cancel' }));
    expect(onReload).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Reload' }));
    fireEvent.click(dialog().getByRole('button', { name: 'Confirm' }));
    expect(onReload).toHaveBeenCalledOnce();
  });

  it('shows save failures with retry and blocks editing when loading failed', () => {
    const onRetry = vi.fn(),
      onReload = vi.fn();
    const view = render(<Fixture saveState="error" onRetry={onRetry} />);
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledOnce();
    view.rerender(<Fixture saveState="load-error" onReload={onReload} />);
    expect(screen.getByRole('button', { name: 'Add button' }).closest('fieldset')?.disabled).toBe(
      true,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Reload' }));
    expect(onReload).toHaveBeenCalledOnce();
  });
});
