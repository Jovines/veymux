import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === 'server' ? [] : sources(path);
    return /\.(?:tsx?|cts|js)$/.test(path) && !/\.test\.|\.d\.ts$/.test(path) ? [path] : [];
  });
}

describe('encrypted transport architecture', () => {
  it('keeps native business transports and native uploads out of UI code', () => {
    const violations: string[] = [];
    for (const path of [...sources(join(root, 'src')), ...sources(join(root, 'desktop-rust', 'renderer'))]) {
      const name = relative(root, path);
      const source = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true);
      const visit = (node: ts.Node) => {
        if (ts.isNewExpression(node)) {
          const constructor = node.expression.getText(source).split('.').pop();
          const transport = ['WebSocket', 'WebTransport', 'EventSource', 'XMLHttpRequest'].includes(constructor ?? '');
          const allowedSocket = constructor === 'WebSocket' && [
            'src/lib/federation/secureClient.ts', 'src/lib/federation/relaySocket.ts',
          ].includes(name);
          const allowedQuic = constructor === 'WebTransport' && name === 'src/lib/federation/webTransportClient.ts';
          if (transport && !allowedSocket && !allowedQuic) violations.push(`${name}: native ${constructor}`);
        }
        if (ts.isCallExpression(node) && /(?:pasteClipboardImage|uploadClipboardImage|uploadDroppedFiles|sendBeacon)$/.test(node.expression.getText(source))) {
          violations.push(`${name}: ${node.expression.getText(source)}`);
        }
        // Rust's injected page bridge explicitly uses the current page's
        // encrypted window.fetch wrapper; it never owns a native uploader.
        const encryptedPageFetch = name === 'desktop-rust/renderer/bridge.js'
          && ts.isCallExpression(node) && node.expression.getText(source) === 'window.fetch';
        if (name.startsWith('desktop-rust/renderer/') && ts.isCallExpression(node) && !encryptedPageFetch
          && /(?:^|\.)(?:fetch|fetchRequest)$/.test(node.expression.getText(source))
          && node.arguments[0]?.getText(source).includes('/api/')) violations.push(`${name}: native business fetch`);
        ts.forEachChild(node, visit);
      };
      visit(source);
    }
    expect(violations).toEqual([]);
  });

  it('does not make cookie-authenticated business requests from background workers', () => {
    for (const path of sources(join(root, 'public'))) {
      const source = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true);
      const violations: string[] = [];
      const visit = (node: ts.Node) => {
        if (ts.isCallExpression(node) && /(?:^|\.)fetch$/.test(node.expression.getText(source))
          && node.arguments[0]?.getText(source).includes('/api/')) violations.push(node.getText(source));
        ts.forEachChild(node, visit);
      };
      visit(source);
      expect(violations, relative(root, path)).toEqual([]);
    }
  });
});
