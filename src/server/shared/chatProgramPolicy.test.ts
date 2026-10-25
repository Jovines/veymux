import { expect, it } from 'vitest';
import { chatProgramName, validChatProgramName } from './chatProgramPolicy';

it.each([
  ['/opt/bin/my-agent --model test', 'my-agent'],
  ['TOKEN=abc env FOO=bar /opt/my-agent', 'my-agent'],
  ['node "/home/me/my agent/agent.js" --port 123', 'agent.js'],
  ['python3 /opt/my_agent.py', 'my_agent.py'],
  ['npx my-agent', 'my-agent'],
  ['bash /opt/my-agent.sh', 'my-agent.sh'],
  ['bash', null], ['node', null], ['zsh -c my-agent', null], ['node --eval my-agent', null],
  ['cat codex.md', 'cat'],
])('identifies only the executable or direct script in %s', (command, expected) => {
  expect(chatProgramName(command)).toBe(expected);
});
it('rejects shells, interpreter-wide rules, paths and arguments', () => {
  for (const name of ['node', 'python3', 'bash', '/usr/bin/my-agent', 'my-agent --x', '', 'foo;bar']) expect(validChatProgramName(name)).toBe(false);
  expect(validChatProgramName('agent.py')).toBe(true);
  expect(validChatProgramName('custom-shell', ['custom-shell'])).toBe(false);
});
