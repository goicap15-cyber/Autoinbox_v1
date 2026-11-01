// Dispatch ArrowDown một lần cho mention listbox hiện tại
async function dispatchMentionSelect(tabId, name) {
  const target = { tabId };
  try {
    await chrome.debugger.attach(target, '1.3');
    // Wait cho dropdown có thời gian mở
    await new Promise(r => setTimeout(r, 200));
    // Down 1 hàng
    for (const type of ['keyDown', 'keyUp']) {
      await chrome.debugger.sendCommand(target, 'Input.dispatchKeyEvent', {
        type, key: 'ArrowDown', code: 'ArrowDown', keyCode: 40, windowsVirtualKeyCode: 40
      });
    }
    // Enter
    for (const type of ['keyDown', 'keyUp']) {
      await chrome.debugger.sendCommand(target, 'Input.dispatchKeyEvent', {
        type, key: 'Enter', code: 'Enter', keyCode: 13, windowsVirtualKeyCode: 13, modifiers: 4
      });
    }
  } catch (error) {
    console.error('[dispatchMentionSelect] Error:', error.message);
    return false;
  } finally {
    try { await chrome.debugger.detach(target); } catch (e) {}
  }
  return true;
}
