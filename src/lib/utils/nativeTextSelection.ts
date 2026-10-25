/** A native reading selection belongs to its document, including retained
 * service frames. Never substitute an editor's cached caret or draft state. */
export function hasNativeSelectionWithin(root: HTMLElement): boolean {
  const selection = root.ownerDocument.getSelection();
  return !!selection && !selection.isCollapsed && root.contains(selection.anchorNode) && root.contains(selection.focusNode);
}
