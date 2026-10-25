/** Start the clipboard write in the click task, even while the invitation is
 * being generated. Promise-backed items preserve activation in Safari. */
export async function copyInvitationLink(link: string | Promise<string>): Promise<boolean> {
  const value = Promise.resolve(link);
  // Generation and clipboard are awaited independently by the dialog.
  void value.catch(() => {});
  try {
    if (typeof ClipboardItem !== 'undefined' && typeof navigator.clipboard?.write === 'function') {
      await navigator.clipboard.write([new ClipboardItem({ 'text/plain': value.then(text => new Blob([text], { type: 'text/plain' })) })]);
    } else {
      await navigator.clipboard.writeText(await value);
    }
    return true;
  } catch { return false; }
}
