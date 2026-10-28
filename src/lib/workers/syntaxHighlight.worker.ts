import './highlightWorkerGlobal';
import refractor from 'refractor';
import type { RefractorNode } from '../utils/syntaxHighlight';

self.onmessage = (event: MessageEvent<{ content: string; language: string }>) => {
  try {
    const { content, language } = event.data;
    if (content.length > 64 * 1024 || !refractor.registered(language)) { self.postMessage(null); return; }
    const ast = refractor.highlight(content, language) as RefractorNode[];
    let count = 0;
    const stack = [...ast];
    while (stack.length) {
      const node = stack.pop()!;
      // Bound both structured-clone work and the React spans made by the host.
      count += node.type === 'text' ? node.value.split('\n').length : 1;
      if (count > 4000) { self.postMessage(null); return; }
      if (node.type === 'element') {
        if (stack.length + node.children.length > 4000) { self.postMessage(null); return; }
        stack.push(...node.children);
      }
    }
    self.postMessage(ast);
  } catch { self.postMessage(null); }
};
