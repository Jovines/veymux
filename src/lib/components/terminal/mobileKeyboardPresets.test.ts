import { describe, expect, it } from 'vitest';
import {
  buildDesktopToolbarPresetOptions,
  createDefaultToolbarPresets,
  materializeToolbarPresets,
  sanitizeToolbarPresets,
  type ToolbarPresetDefinition,
} from './mobileKeyboardPresets';

describe('toolbar preset desktop visibility', () => {
  it('keeps built-in AI presets desktop-visible and base hidden', () => {
    const defaults = createDefaultToolbarPresets();

    expect(defaults.find((preset) => preset.id === 'default')?.showOnDesktop).toBe(false);
    expect(defaults.find((preset) => preset.id === 'claude')?.showOnDesktop).toBe(true);
    expect(defaults.find((preset) => preset.id === 'opencode')?.showOnDesktop).toBe(true);
    expect(defaults.find((preset) => preset.id === 'codex')?.showOnDesktop).toBe(true);
    expect(defaults.find((preset) => preset.id === 'customcli')?.showOnDesktop).toBe(true);
    expect(defaults.find((preset) => preset.id === 'customagent')?.showOnDesktop).toBe(true);
    expect(defaults.find((preset) => preset.id === 'kimi')?.showOnDesktop).toBe(true);
  });

  it('defaults legacy custom presets to hidden on desktop', () => {
    const sanitized = sanitizeToolbarPresets([
      {
        id: 'custom-ai',
        label: 'Custom AI',
        programs: ['custom-ai'],
        includeAlt: false,
        rowLayout: [3],
        actions: [{ id: 'custom-undo', label: '/undo', sequence: '/undo' }],
      },
    ]);
    const legacyPreset = sanitized.find((preset) => preset.id === 'custom-ai');

    expect(legacyPreset?.showOnDesktop).toBe(false);
  });

  it('preserves explicit desktop visibility flags', () => {
    const sanitized = sanitizeToolbarPresets([
      {
        id: 'custom-ai',
        label: 'Custom AI',
        programs: ['custom-ai'],
        includeAlt: false,
        rowLayout: [3],
        actions: [],
        showOnDesktop: true,
      },
    ]);
    const desktopPreset = sanitized.find((preset) => preset.id === 'custom-ai');

    expect(desktopPreset?.showOnDesktop).toBe(true);
  });

  it('keeps the base preset available alongside desktop-visible presets', () => {
    const presets: ToolbarPresetDefinition[] = [
      {
        id: 'default',
        label: 'Base',
        programs: [],
        includeAlt: true,
        rowLayout: [3],
        actions: [],
        showOnDesktop: false,
      },
      {
        id: 'claude',
        label: 'Claude',
        programs: ['claude'],
        includeAlt: false,
        rowLayout: [4],
        actions: [{ id: 'undo', label: '/undo', sequence: '/undo' }],
        showOnDesktop: true,
      },
    ];

    expect(buildDesktopToolbarPresetOptions(presets)).toEqual([
      { id: 'auto', label: 'Auto' },
      { id: 'default', label: 'Base' },
      { id: 'claude', label: 'Claude' },
    ]);
  });
});

describe('CustomAgent Shift+Left preset migration', () => {
  it('includes the shortcut and enough default slots', () => {
    const customagent = createDefaultToolbarPresets().find(preset => preset.id === 'customagent')!;
    expect(customagent.actions[0]).toEqual({ id: 'customagent-shift-left', label: '⇧←', sequence: '\x1b[1;2D' });
    expect(customagent.rowLayout).toEqual([customagent.actions.length + 1]);
  });

  it('adds only the missing shortcut to version 18, keeping customized presets intact', () => {
    const stored = createDefaultToolbarPresets();
    const customagent = stored.find(preset => preset.id === 'customagent')!;
    customagent.actions = [{ id: 'mine', label: 'My command', sequence: '/mine' }];
    customagent.label = 'My custom-agent';
    customagent.programs = ['my-custom-agent'];
    customagent.rowLayout = [4, 4];
    customagent.showOnDesktop = false;
    stored.find(preset => preset.id === 'codex')!.actions = [{ id: 'custom', label: 'Keep me', sequence: 'hello' }];
    const migrated = materializeToolbarPresets(stored, 18);
    expect(migrated.find(preset => preset.id === 'customagent')).toEqual({
      ...customagent,
      actions: [{ id: 'customagent-shift-left', label: '⇧←', sequence: '\x1b[1;2D' }, ...customagent.actions],
    });
    expect(migrated.filter(preset => preset.id !== 'customagent')).toEqual(stored.filter(preset => preset.id !== 'customagent'));
    expect(materializeToolbarPresets(migrated, 18)).toEqual(migrated);
  });

  it('fits the previous default row and preserves an equivalent user shortcut', () => {
    const stored = createDefaultToolbarPresets();
    const customagent = stored.find(preset => preset.id === 'customagent')!;
    customagent.rowLayout = [6];
    customagent.actions.shift();
    expect(materializeToolbarPresets(stored, 18).find(preset => preset.id === 'customagent')?.rowLayout).toEqual([7]);
    customagent.actions.unshift({ id: 'my-shift-left', label: 'Select', sequence: '\\u001b[1;2D' });
    expect(materializeToolbarPresets(stored, 18).find(preset => preset.id === 'customagent')).toEqual(customagent);
  });

  it('keeps a deliberate deletion after upgrading and preserves older migration behavior', () => {
    const stored = createDefaultToolbarPresets();
    stored.find(preset => preset.id === 'customagent')!.actions.shift();
    expect(materializeToolbarPresets(stored, 19)).toEqual(stored);
    expect(materializeToolbarPresets(stored, 17).find(preset => preset.id === 'customagent')?.actions[0].id).toBe('customagent-shift-left');
  });
});
