// ====================================================
// 注入到工具包页面的桥接脚本
// 职责：监听工具包发出的 postMessage，转发给后台脚本
// ====================================================

// 监听工具包页面发出的消息
window.addEventListener('message', (event) => {
  // 只处理来自本页面的消息
  if (event.source !== window) return;
  if (!event.data || event.data.type !== 'TOOLKIT_BRIDGE') return;

  // 转发给后台脚本
  chrome.runtime.sendMessage({
    action: event.data.action,
    platform: event.data.platform,
    prompt: event.data.prompt,
    autoGenerate: event.data.autoGenerate
  }, (response) => {
    // 把结果传回工具包页面
    window.postMessage({
      type: 'TOOLKIT_BRIDGE_RESPONSE',
      requestId: event.data.requestId,
      ...(response || { success: false, error: '无响应' })
    }, '*');
  });
});

// 通知工具包页面：桥接已就绪
window.postMessage({ type: 'TOOLKIT_BRIDGE_READY' }, '*');
