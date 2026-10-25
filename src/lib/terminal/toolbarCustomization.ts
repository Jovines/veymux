import {
  decodeToolbarSequence,
  splitToolbarSequenceSegments,
  type MobileToolbarAction,
  type ToolbarPresetDefinition,
} from '../components/terminal/mobileKeyboardPresets';
import {
  encodeToolbarKeyCombo,
  getToolbarKeyComboLabel,
  TOOLBAR_CHARACTER_KEYS,
  TOOLBAR_NAMED_KEYS,
  type ToolbarKeyCombo,
} from './toolbarKeyCombo';

export const TOOLBAR_SHORTCUTS = [
  { id: 'interrupt', label: 'Ctrl+C', sequence: '\\u0003' },
  { id: 'tab', label: 'Tab', sequence: '\\t' },
  { id: 'enter', label: 'Enter', sequence: '\\r' },
  { id: 'escape', label: 'Esc', sequence: '\\u001b' },
  { id: 'clear', label: 'Ctrl+L', sequence: '\\u000c' },
  { id: 'search', label: 'Ctrl+R', sequence: '\\u0012' },
  { id: 'up', label: '↑', sequence: '\\u001b[A' },
  { id: 'down', label: '↓', sequence: '\\u001b[B' },
  { id: 'left', label: '←', sequence: '\\u001b[D' },
  { id: 'right', label: '→', sequence: '\\u001b[C' },
  { id: 'home', label: 'Home', sequence: '\\u001b[H' },
  { id: 'end', label: 'End', sequence: '\\u001b[F' },
  { id: 'shiftLeft', label: 'Shift+←', sequence: '\\u001b[1;2D' },
  { id: 'deleteLine', label: 'Ctrl+U', sequence: '\\u0015' },
  { id: 'eof', label: 'Ctrl+D', sequence: '\\u0004' },
] as const;

/** These are the mobile expanded defaults in MobileKeyboard, not the fixed row. */
export function editableToolbarActions(
  preset: ToolbarPresetDefinition,
  desktop = false,
): MobileToolbarAction[] {
  return preset.actions.length
    ? preset.actions
    : (desktop ? ['escape', 'interrupt', 'eof', 'home', 'end'] : ['home', 'end', 'eof']).map(
        (id) => {
          const key = TOOLBAR_SHORTCUTS.find((item) => item.id === id)!;
          return { id: `${preset.id}-default-${id}`, label: key.label, sequence: key.sequence };
        },
      );
}

const combos = new Map<string, ToolbarKeyCombo>();
for (const key of [
  ...TOOLBAR_NAMED_KEYS.map(([key]) => key),
  ...TOOLBAR_CHARACTER_KEYS,
  ...Array.from({ length: 12 }, (_, i) => `F${i + 1}`),
]) {
  for (let mask = 0; mask < 8; mask++) {
    const combo = { key, shift: !!(mask & 1), ctrl: !!(mask & 2), alt: !!(mask & 4) };
    const sequence = encodeToolbarKeyCombo(combo);
    if (sequence !== null && !combos.has(decodeToolbarSequence(sequence)))
      combos.set(decodeToolbarSequence(sequence), combo);
  }
}

export function describeToolbarSequence(sequence: string): {
  kind: 'key' | 'text' | 'advanced';
  value: string;
  enter?: boolean;
  combo?: ToolbarKeyCombo;
} {
  const segmented = sequence.includes('||');
  const decoded = splitToolbarSequenceSegments(sequence).map(decodeToolbarSequence).join('');
  const shortcut = TOOLBAR_SHORTCUTS.find(
    (item) => decodeToolbarSequence(item.sequence) === decoded,
  );
  const combo = combos.get(decoded);
  if (!segmented && (shortcut || combo))
    return { kind: 'key', value: shortcut?.label ?? getToolbarKeyComboLabel(combo!), combo };
  const enter = decoded.endsWith('\r');
  const text = enter ? decoded.slice(0, -1) : decoded;
  return /[\u0000-\u0008\u000b-\u001f\u007f]/.test(text)
    ? { kind: 'advanced', value: sequence }
    : { kind: 'text', value: text, enter };
}

/** Literal user text cannot accidentally become a control key or a delayed segment. */
export function encodeToolbarText(text: string): string {
  return text.replace(
    /[\\|\u0000-\u001f\u007f]/g,
    (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`,
  );
}

/** Keep slash-menu timing when editing an existing delayed command, or adding
 * a command to a toolbar that already uses that interaction. */
export function buildToolbarTextSequence(text: string, enter: boolean, template?: string): string {
  if (template?.startsWith('/||') && text.startsWith('/') && !text.slice(1).includes('/')) {
    const command = text.slice(1);
    return (
      '/||' +
      encodeToolbarText(command.endsWith(' ') ? command : command + ' ') +
      (enter ? '||\\r' : '')
    );
  }
  return encodeToolbarText(text) + (enter ? '\\r' : '');
}
