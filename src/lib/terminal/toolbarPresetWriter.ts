import type { ToolbarPresetDefinition } from '../components/terminal/mobileKeyboardPresets';

/** One server revision per write; rapid edits coalesce behind the in-flight save. */
export function createToolbarPresetWriter(options: {
  save: (presets: ToolbarPresetDefinition[]) => Promise<{ updatedAt?: number }>;
  acknowledged: (
    updatedAt: number | undefined,
    presets: ToolbarPresetDefinition[],
    current: boolean,
  ) => void;
  state: (state: 'saved' | 'saving' | 'error' | 'conflict') => void;
}) {
  let pending: ToolbarPresetDefinition[] | null = null;
  let running = false;
  let failed: 'error' | 'conflict' | null = null;
  const drain = async () => {
    if (running || failed || !pending) return;
    running = true;
    options.state('saving');
    try {
      while (pending) {
        const sent = pending;
        pending = null;
        try {
          const doc = await options.save(sent);
          options.acknowledged(doc.updatedAt, sent, !pending);
        } catch (error) {
          pending ??= sent;
          failed =
            error instanceof Error && 'current' in error && error.current ? 'conflict' : 'error';
          options.state(failed);
          return;
        }
      }
      options.state('saved');
    } finally {
      running = false;
    }
  };
  return {
    dirty: () => running || pending !== null,
    enqueue(presets: ToolbarPresetDefinition[]) {
      pending = presets;
      if (failed === 'error') failed = null;
      void drain();
    },
    retry() {
      if (failed !== 'conflict') {
        failed = null;
        void drain();
      }
    },
    reset() {
      if (!running) {
        pending = null;
        failed = null;
      }
    },
  };
}
