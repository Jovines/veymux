// refractor v2 captures `global` before initializing its worker-safe Prism.
// Keep this first in the worker's static imports so bundled and dev execution
// agree, without adding a Node global to the application page.
(globalThis as typeof globalThis & { global: typeof globalThis }).global = globalThis;
export {};
