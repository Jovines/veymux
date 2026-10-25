// @vitest-environment jsdom
import { useRef, useState } from 'react';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getActiveKeyboardLayer, isKeyboardLayerOpen, useKeyboardLayer, useKeyboardLayerOpen } from './useKeyboardLayer';

beforeEach(() => { vi.spyOn(document, 'hasFocus').mockReturnValue(true); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

function Layer({ children, onClose }: { children?: React.ReactNode; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useKeyboardLayer(ref, true, onClose);
  return <div ref={ref} tabIndex={-1}><button>First</button>{children}<button>Last</button></div>;
}
function Harness() {
  const [open, setOpen] = useState(false);
  const [child, setChild] = useState(false);
  const paused = useKeyboardLayerOpen();
  return <><input aria-label="Background input" /><button onClick={() => setOpen(true)}>Open</button>
    <output>{paused ? 'Input paused' : 'Input available'}</output>
    {open && <Layer onClose={() => setOpen(false)}><button onClick={() => setChild(true)}>Choose directory</button>
      {child && <Layer onClose={() => setChild(false)} />}</Layer>}</>;
}

describe('keyboard layers', () => {
  it('contains focus, loops Tab and releases only the topmost layer on Escape', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: 'Open' }));
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'First' }));
    await user.tab({ shift: true });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Last' }));
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'First' }));
    screen.getByRole('textbox').focus();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'First' }));
    await user.click(screen.getByRole('button', { name: 'Choose directory' }));
    fireEvent.keyDown(document.activeElement!, { key: 'Escape', isComposing: true });
    expect(screen.getAllByRole('button', { name: 'First' })).toHaveLength(2);
    await user.keyboard('{Escape}');
    expect(screen.getAllByRole('button', { name: 'First' })).toHaveLength(1);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Choose directory' }));
    expect(isKeyboardLayerOpen()).toBe(true);
    await user.keyboard('{Escape}');
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Open' }));
    expect(isKeyboardLayerOpen()).toBe(false);
  });

  it('keeps a child on top when parent and child mount in the same commit', async () => {
    const user = userEvent.setup();
    function Nested() {
      const [child, setChild] = useState(true);
      return <><input aria-label="Background" /><Layer onClose={() => undefined}>
        {child && <div data-testid="child"><Layer onClose={() => setChild(false)} /></div>}
      </Layer></>;
    }
    render(<Nested />);
    const child = screen.getByTestId('child');
    expect(child.contains(document.activeElement)).toBe(true);
    screen.getByRole('textbox').focus();
    expect(child.contains(document.activeElement)).toBe(true);
    within(child).getByRole('button', { name: 'Last' }).focus();
    await user.tab();
    expect(document.activeElement).toBe(within(child).getByRole('button', { name: 'First' }));
    await user.keyboard('{Escape}');
    expect(screen.queryByTestId('child')).toBeNull();
    expect(isKeyboardLayerOpen()).toBe(true);
  });

  it('restores focus when the hook stays mounted after its conditional dialog is removed', async () => {
    function Conditional() {
      const [open, setOpen] = useState(false);
      const ref = useRef<HTMLDivElement>(null);
      useKeyboardLayer(ref, open, () => setOpen(false));
      return <><button onClick={() => setOpen(true)}>Open conditional</button>
        {open && <div ref={ref} role="dialog"><input aria-label="Conditional editor" /></div>}</>;
    }
    const user = userEvent.setup(); render(<Conditional />);
    const trigger = screen.getByRole('button'); await user.click(trigger);
    expect(document.activeElement).toBe(screen.getByRole('textbox'));
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('skips controls hidden by an ancestor and disabled fieldsets when wrapping Tab', async () => {
    const user = userEvent.setup();
    render(<Layer onClose={() => undefined}><div style={{ display: 'none' }}><button>Invisible</button></div>
      <fieldset disabled><button>Disabled</button></fieldset></Layer>);
    const first = screen.getByRole('button', { name: 'First' });
    await user.tab({ shift: true });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Last' }));
    await user.tab();
    expect(document.activeElement).toBe(first);
  });

  it('respects a nested control that has already handled Escape', () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    const control = screen.getByRole('button', { name: 'First' });
    control.addEventListener('keydown', (event) => event.preventDefault());
    fireEvent.keyDown(control, { key: 'Escape' });
    expect(isKeyboardLayerOpen()).toBe(true);
  });

  it('does not trap focus or Escape in a retained hidden workspace', () => {
    const closed = { calls: 0 };
    function Retained({ hidden }: { hidden: boolean }) {
      return <><input aria-label="Foreground editor" /><div hidden={hidden}><Layer onClose={() => { closed.calls++; }} /></div></>;
    }
    const view = render(<Retained hidden={false} />);
    view.rerender(<Retained hidden />);
    const editor = screen.getByRole('textbox'); editor.focus();
    expect(document.activeElement).toBe(editor);
    expect(isKeyboardLayerOpen()).toBe(false);
    fireEvent.keyDown(editor, { key: 'Escape' });
    expect(closed.calls).toBe(0);
  });

  it('leaves focus chosen by a newer action alone when a layer closes', async () => {
    const view = render(<><input aria-label="Previous" /><input aria-label="New owner" /></>);
    screen.getByLabelText('Previous').focus();
    view.rerender(<><input aria-label="Previous" /><input aria-label="New owner" /><Layer onClose={() => undefined} /></>);
    view.rerender(<><input aria-label="Previous" /><input aria-label="New owner" /></>);
    const next = screen.getByLabelText('New owner'); next.focus();
    await act(async () => { await Promise.resolve(); });
    expect(document.activeElement).toBe(next);
  });

  it('yields to the desktop bridge confirmation above a React layer', () => {
    render(<Layer onClose={() => undefined} />);
    const native = document.createElement('section'); native.dataset.desktopConfirmation = 'true';
    const cancel = document.createElement('button'); native.append(cancel); document.body.append(native);
    try {
      cancel.focus();
      expect(document.activeElement).toBe(cancel);
      expect(getActiveKeyboardLayer()?.element).toBe(native);
    } finally { native.remove(); }
  });
});
