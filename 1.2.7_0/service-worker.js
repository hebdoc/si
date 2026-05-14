/**
 * Service Worker - 消息路由与 Offscreen Document 生命周期管理
 */

let pendingRequests = new Map();
let requestIdCounter = 0;

let creatingOffscreenPromise = null;

/**
 * 确保 Offscreen Document 已创建
 */
async function ensureOffscreenDocument() {
  if (creatingOffscreenPromise) {
    await creatingOffscreenPromise;
    return;
  }

  const existingContexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
  });

  if (existingContexts.length > 0) {
    return;
  }

  creatingOffscreenPromise = chrome.offscreen.createDocument({
    url: 'offscreen/offscreen.html',
    reasons: ['DOM_PARSER'],
    justification: 'Run Tesseract.js OCR engine for CAPTCHA recognition',
  }).then(() => {
    console.log('[Auto Verify] Offscreen document created');
  });

  try {
    await creatingOffscreenPromise;
  } finally {
    creatingOffscreenPromise = null;
  }
}

/**
 * 发送 OCR 识别请求到 Offscreen Document
 */
async function requestOCR(imageBase64, options = {}) {
  await ensureOffscreenDocument();

  const requestId = ++requestIdCounter;

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pendingRequests.delete(requestId);
      reject(new Error('OCR request timed out (60s)'));
    }, 60000);

    pendingRequests.set(requestId, { resolve, reject, timeout });

    chrome.runtime.sendMessage({
      target: 'offscreen',
      type: 'OCR_RECOGNIZE',
      requestId,
      imageBase64,
      options,
    });
  });
}

/**
 * 保存识别历史
 */
async function saveHistory(entry) {
  const { history = [] } = await chrome.storage.local.get('history');
  history.unshift({
    ...entry,
    timestamp: Date.now(),
    id: Date.now().toString(36),
  });
  // Keep only last 50 entries
  if (history.length > 50) history.length = 50;
  await chrome.storage.local.set({ history });
}

/**
 * 验证 OCR 结果
 * 如果只有 1-2 位字母或数字，大概率识别错误
 */
function isValidResult(text) {
  if (!text) return false;
  
  // 如果包含非 ASCII 字符（如中文），说明大概率识别正确（因为中文识别比字母难，且不常发生 1-2 位的误报）
  const hasNonAscii = /[^\x00-\x7F]/.test(text);
  if (hasNonAscii) return true;

  // 如果只有 1-2 位且是字母或数字，判定为不可信
  if (text.length <= 2 && /^[a-zA-Z0-9]+$/.test(text)) {
    return false;
  }

  return true;
}

/**
 * 监听消息
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Handle OCR results from offscreen document
  if (message.type === 'OCR_RESULT' && pendingRequests.has(message.requestId)) {
    const { resolve, timeout } = pendingRequests.get(message.requestId);
    clearTimeout(timeout);
    pendingRequests.delete(message.requestId);
    resolve(message.result);
    return;
  }

  if (message.type === 'OCR_ERROR' && pendingRequests.has(message.requestId)) {
    const { reject, timeout } = pendingRequests.get(message.requestId);
    clearTimeout(timeout);
    pendingRequests.delete(message.requestId);
    reject(new Error(message.error));
    return;
  }

  if (message.type === 'OCR_PROGRESS') {
    // Forward progress to popup and content script
    chrome.runtime.sendMessage({
      type: 'OCR_PROGRESS_UPDATE',
      progress: message.progress,
    }).catch(() => {});
    return;
  }

  // Handle requests from content script or popup
  if (message.type === 'RECOGNIZE_CAPTCHA') {
    sendResponse({ status: "ok" });
    requestOCR(message.imageBase64, message.options)
      .then(async (result) => {
        // Apply text case conversion if configured
        const { textCase } = await chrome.storage.local.get('textCase');
        if (textCase === 'lowercase') {
          result.text = result.text.toLowerCase();
        } else if (textCase === 'uppercase') {
          result.text = result.text.toUpperCase();
        }

        // Validate result
        if (!isValidResult(result.text)) {
          console.warn(`[Auto Verify] Filtering short/suspicious result: "${result.text}"`);
          const ignoredResult = { ...result, ignored: true };
          
          if (sender.tab?.id) {
            chrome.tabs.sendMessage(sender.tab.id, {
              type: 'CAPTCHA_RESULT',
              result: ignoredResult,
              captchaIndex: message.captchaIndex
            }).catch(() => {});
          }
          chrome.runtime.sendMessage({
            type: 'CAPTCHA_RESULT',
            result: ignoredResult,
            captchaIndex: message.captchaIndex
          }).catch(() => {});
          return;
        }

        // Save to history
        await saveHistory({
          text: result.text,
          confidence: result.confidence,
          url: sender.tab?.url || 'manual',
          thumbnail: message.imageBase64.substring(0, 200) + '...', // Truncated
        });

        // Send result back to requesting tab
        if (sender.tab?.id) {
          chrome.tabs.sendMessage(sender.tab.id, {
            type: 'CAPTCHA_RESULT',
            result,
            captchaIndex: message.captchaIndex
          }).catch(() => {});
        }

        // Also notify popup
        chrome.runtime.sendMessage({
          type: 'CAPTCHA_RESULT',
          result,
          captchaIndex: message.captchaIndex
        }).catch(() => {});
      })
      .catch((err) => {
        const errorMsg = { 
          type: 'CAPTCHA_ERROR', 
          error: err.message,
          captchaIndex: message.captchaIndex 
        };
        if (sender.tab?.id) {
          chrome.tabs.sendMessage(sender.tab.id, errorMsg).catch(() => {});
        }
        chrome.runtime.sendMessage(errorMsg).catch(() => {});
      });
    return true; // Keep message channel open
  }

  // Handle popup request to recognize from current tab
  if (message.type === 'TRIGGER_RECOGNIZE') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]?.id) {
        chrome.tabs.sendMessage(tabs[0].id, {
          type: 'TRIGGER_DETECT_AND_RECOGNIZE',
        }, () => {
          // If content script is NOT injected (e.g. chrome:// or unsupported page)
          if (chrome.runtime.lastError) {
            chrome.runtime.sendMessage({
              type: 'CAPTCHA_ERROR',
              error: chrome.i18n.getMessage('pageUnsupported') || 'Cannot recognize on this page.'
            }).catch(() => {});
          }
        });
      } else {
        chrome.runtime.sendMessage({
          type: 'CAPTCHA_ERROR',
          error: chrome.i18n.getMessage('pageUnsupported') || 'No active tab found.'
        }).catch(() => {});
      }
    });
    return;
  }

  // Handle history request
  if (message.type === 'GET_HISTORY') {
    chrome.storage.local.get('history').then(({ history = [] }) => {
      sendResponse({ history });
    });
    return true;
  }

  // Handle clear history
  if (message.type === 'CLEAR_HISTORY') {
    chrome.storage.local.set({ history: [] }).then(() => {
      sendResponse({ success: true });
    });
    return true;
  }
});

// Log extension startup
console.log('[Auto Verify] Service worker started');
