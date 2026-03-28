// ====================================================
// AI 工具包桥接助手 - 后台脚本
// 职责：接收工具包的消息，找到 Flow 标签页，执行填入
// ====================================================

// 平台 URL 映射
const PLATFORM_URLS = {
  'flow': 'https://labs.google/fx/tools/flow',
  'image-fx': 'https://labs.google/fx/tools/image-fx',
};

// 监听来自 content-toolkit.js 的消息
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'fillPrompt') {
    handleFillPrompt(message)
      .then(result => sendResponse(result))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true; // 异步响应
  }
});

async function handleFillPrompt({ platform, prompt, autoGenerate }) {
  const targetUrl = PLATFORM_URLS[platform];
  if (!targetUrl) {
    throw new Error('不支持的平台: ' + platform);
  }

  // 1. 查找已打开的目标标签页
  const tabs = await chrome.tabs.query({ url: targetUrl + '*' });
  let tabId;

  if (tabs.length > 0) {
    // 已有标签页，切换到它
    tabId = tabs[0].id;
    await chrome.tabs.update(tabId, { active: true });
  } else {
    // 没有，打开新标签页
    const tab = await chrome.tabs.create({ url: targetUrl });
    tabId = tab.id;
    await waitForTabLoad(tabId);
    // 等待生图插件设置好 window.setPrompt（它需要时间初始化）
    await sleep(5000);
  }

  // 2. 在目标标签页上执行填入脚本
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN', // 关键：必须用 MAIN 世界才能访问 window.setPrompt
      func: fillPromptOnPage,
      args: [prompt, !!autoGenerate]
    });
    return results[0]?.result || { success: true };
  } catch (err) {
    return { success: false, error: '执行失败: ' + err.message };
  }
}

// 这个函数会在目标网站（Flow）的页面上执行
function fillPromptOnPage(prompt, autoGenerate) {
  try {
    // 优先使用生图插件暴露的 setPrompt 函数
    if (typeof window.setPrompt === 'function') {
      window.setPrompt(prompt);
      if (autoGenerate && typeof window.generate === 'function') {
        setTimeout(() => window.generate(), 1500);
      }
      return { success: true, method: 'plugin' };
    }

    // 降级方案：直接操作 DOM
    const textbox = document.querySelector('div[role="textbox"]');
    if (textbox) {
      textbox.focus();
      textbox.textContent = prompt;
      textbox.dispatchEvent(new Event('input', { bubbles: true }));
      return { success: true, method: 'dom-fallback' };
    }

    return {
      success: false,
      error: '找不到输入框。请确保：1) 页面已加载完成 2) 生图插件已安装'
    };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// 工具函数
function waitForTabLoad(tabId) {
  return new Promise(resolve => {
    chrome.tabs.onUpdated.addListener(function listener(id, info) {
      if (id === tabId && info.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    });
  });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
