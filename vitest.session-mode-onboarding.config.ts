import { defineConfig } from 'vitest/config';
import chat from './vitest.chat-mode.config';
import { chatDelivery } from './src/server/shared/chatDelivery';
import type { TransportDiagnostic } from './src/server/agent/collaborationProtocol';

export default defineConfig({
  ...chat,
  cacheDir: 'node_modules/.vite/session-mode-onboarding-tests',
  test: { ...chat.test, include: ['src/lib/components/chat/sessionModeOnboarding.browser.tsx'],
    browser: { ...chat.test?.browser, commands: { ...chat.test?.browser?.commands,
      async setChatReducedMotion(context, reduce: boolean) { await context.page.emulateMedia({ reducedMotion: reduce ? 'reduce' : 'no-preference' }); },
      async pendingChatDelivery(_context, stage: string, error: string) {
        return chatDelivery('pending', { relay_online: null, peer_reachable: true, attempt_count: 1,
          next_retry_at: null, last_error: error, checked_at: Date.now(), write_stage: stage as TransportDiagnostic['write_stage'] }, 'fixture', true) ?? null;
      },
    } },
  },
});
