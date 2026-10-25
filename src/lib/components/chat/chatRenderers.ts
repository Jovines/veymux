// Resolve each optional renderer once, before committing history that needs it.
let loaded: typeof import('./ChatRichContent') | undefined;
export const getChatRichContent = () => loaded?.ChatRichContent;
let full: typeof import('./ChatFullContent') | undefined;
export const getChatFullContent = () => full?.ChatFullContent;
let rich: Promise<typeof import('./ChatRichContent')> | undefined;
export function loadChatRichContent() {
  return rich ??= Promise.all([import('./ChatRichContent'), import('./ChatFullContent')]).then(([module, complete]) => { loaded = module; full = complete; return module; }).catch(error => { rich = undefined; throw error; });
}
