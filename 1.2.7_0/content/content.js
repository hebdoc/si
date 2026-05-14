/**
 * 验证码检测器
 * 通过启发式规则扫描页面，定位可能的验证码图片
 */

const CAPTCHA_KEYWORDS = [
  'captcha', 'verify', 'verification', 'vcode', 'validcode', 'checkcode',
  'authcode', 'seccode', 'imgcode', 'verifycode', 'yzm', 'yanzhengma',
  '验证码', '校验码', '识别码',
];

// Keywords that indicate false positives (documentation, articles, repos, etc.)
const FALSE_POSITIVE_INDICATORS = [
  'readme', 'markdown', 'article', 'wiki', 'blog', 'post', 'comment',
  'avatar', 'emoji', 'badge', 'shield', 'logo', 'icon', 'screenshot',
  'preview', 'thumbnail', 'banner', 'illustration', 'diagram', 'chart',
  'github', 'githubusercontent', 'camo.githubusercontent',
];

// Domains where captcha detection should be skipped entirely
const SKIP_DOMAINS = [
  'github.com', 'gitlab.com', 'bitbucket.org',
  'stackoverflow.com', 'stackexchange.com',
  'google.com', 'youtube.com', 'twitter.com', 'x.com',
  'facebook.com', 'reddit.com', 'wikipedia.org',
  'medium.com', 'dev.to', 'npmjs.com',
];

const CAPTCHA_SIZE = {
  minWidth: 50,
  maxWidth: 350,
  minHeight: 20,
  maxHeight: 100,
};

/**
 * 检测页面中的验证码元素
 * @returns {HTMLElement[]} 疑似验证码的元素列表
 */
function detectCaptchaElements() {
  // Skip detection on known non-captcha domains
  const hostname = window.location.hostname;
  if (SKIP_DOMAINS.some(domain => hostname === domain || hostname.endsWith('.' + domain))) {
    return [];
  }

  const candidates = [];

  // Scan all <img> elements
  const images = document.querySelectorAll('img');
  for (const img of images) {
    if (isCaptchaCandidate(img)) {
      candidates.push(img);
    }
  }

  // Scan all <canvas> elements
  const canvases = document.querySelectorAll('canvas');
  for (const canvas of canvases) {
    if (isCaptchaCandidate(canvas)) {
      candidates.push(canvas);
    }
  }

  return candidates;
}

/**
 * 判断元素是否可能是验证码
 */
function isCaptchaCandidate(el) {
  // Check visibility
  if (el.offsetWidth === 0 || el.offsetHeight === 0) return false;
  const style = window.getComputedStyle(el);
  if (style.display === 'none' || style.visibility === 'hidden') return false;

  // Check size constraints
  const rect = el.getBoundingClientRect();
  const width = rect.width;
  const height = rect.height;

  if (width < CAPTCHA_SIZE.minWidth || width > CAPTCHA_SIZE.maxWidth) return false;
  if (height < CAPTCHA_SIZE.minHeight || height > CAPTCHA_SIZE.maxHeight) return false;

  // Check aspect ratio (captchas are usually wider than tall)
  const ratio = width / height;
  if (ratio < 1.5 || ratio > 7) return false;

  // Build attribute string for matching
  const elAttrs = [
    el.id, el.className, el.name, el.alt, el.title,
  ].filter(Boolean).join(' ').toLowerCase();

  const src = (el.getAttribute('src') || el.getAttribute('data-src') || '').toLowerCase();

  const parentAttrs = [
    el.parentElement?.id, el.parentElement?.className,
  ].filter(Boolean).join(' ').toLowerCase();

  const allAttrs = `${elAttrs} ${src} ${parentAttrs}`;

  // Check for false positive indicators first
  for (const fp of FALSE_POSITIVE_INDICATORS) {
    if (allAttrs.includes(fp)) return false;
  }

  // Exclude images loaded from CDNs or external documentation sources
  if (src.startsWith('http') && !src.includes(window.location.hostname)) {
    // External image — likely not a captcha unless it's from a known captcha API
    const isCaptchaAPI = src.includes('/captcha') || src.includes('/verify') || src.includes('/vcode');
    if (!isCaptchaAPI) return false;
  }

  // Check by keyword matching on element's own attributes (NOT src URL to avoid README image false positives)
  const matchAttrs = `${elAttrs} ${parentAttrs}`;
  let keywordMatch = false;
  for (const keyword of CAPTCHA_KEYWORDS) {
    if (matchAttrs.includes(keyword)) {
      keywordMatch = true;
      break;
    }
  }

  // Also check src path segments (e.g. /captcha.php, /verify.html)
  if (!keywordMatch && src && !src.startsWith('data:')) {
    const srcPath = src.split('?')[0]; // ignore query params
    const pathSegments = srcPath.split('/');
    const lastSegment = pathSegments[pathSegments.length - 1] || '';
    for (const keyword of CAPTCHA_KEYWORDS) {
      if (lastSegment.includes(keyword)) {
        keywordMatch = true;
        break;
      }
    }
  }

  if (keywordMatch) return true;

  // Check nearby elements for captcha-related inputs (strict: must be in a form)
  const form = el.closest('form');
  if (form) {
    const inputs = form.querySelectorAll('input[type="text"], input:not([type])');
    for (const input of inputs) {
      const inputAttrs = [input.id, input.className, input.name, input.placeholder]
        .filter(Boolean).join(' ').toLowerCase();
      for (const keyword of CAPTCHA_KEYWORDS) {
        if (inputAttrs.includes(keyword)) return true;
      }
    }
  }

  return false;
}

/**
 * 寻找验证码对应的输入框
 * @param {HTMLElement} captchaEl - 验证码元素
 * @returns {HTMLInputElement|null}
 */
function findRelatedInput(captchaEl) {
  // First try to find a form
  let container = captchaEl.closest('form');
  
  // Walk up DOM tree until we find a container with text inputs (max 6 levels)
  if (!container) {
    let current = captchaEl.parentElement;
    let depth = 0;
    while (current && depth < 6) {
      if (current.querySelector('input[type="text"], input:not([type]), input[type="number"]')) {
        container = current;
        break;
      }
      current = current.parentElement;
      depth++;
    }
  }

  if (!container) return null;

  const inputs = container.querySelectorAll('input[type="text"], input:not([type]), input[type="number"]');
  for (const input of inputs) {
    const attrs = [input.id, input.className, input.name, input.placeholder]
      .filter(Boolean).join(' ').toLowerCase();
    for (const keyword of CAPTCHA_KEYWORDS) {
      if (attrs.includes(keyword)) return input;
    }
  }

  // Fallback: find the closest text input by DOM proximity
  const allInputs = Array.from(inputs);
  if (allInputs.length === 1) return allInputs[0];

  // Find by proximity
  let closest = null;
  let minDist = Infinity;
  const captchaRect = captchaEl.getBoundingClientRect();

  for (const input of allInputs) {
    const inputRect = input.getBoundingClientRect();
    const dist = Math.hypot(
      captchaRect.left - inputRect.left,
      captchaRect.top - inputRect.top
    );
    if (dist < minDist) {
      minDist = dist;
      closest = input;
    }
  }

  return closest;
}

/**
 * 验证码图像截取器
 * 将验证码元素绘制到 Canvas 并导出为 Base64
 */

/**
 * 截取元素图像为 Base64
 * @param {HTMLElement} el - 目标元素 (img 或 canvas)
 * @returns {Promise<string>} Base64 图像数据
 */
async function captureElement(el) {
  if (el instanceof HTMLCanvasElement) {
    return captureCanvas(el);
  }

  if (el instanceof HTMLImageElement) {
    return captureImage(el);
  }

  throw new Error('Unsupported element type');
}

/**
 * 截取 Canvas 元素
 */
function captureCanvas(canvas) {
  return canvas.toDataURL('image/png');
}

/**
 * 截取 Image 元素
 */
async function captureImage(img) {
  // Try direct canvas draw first
  try {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = img.naturalWidth || img.width;
    canvas.height = img.naturalHeight || img.height;
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

    // Test if we can read the canvas (will fail if CORS-tainted)
    ctx.getImageData(0, 0, 1, 1);
    return canvas.toDataURL('image/png');
  } catch (e) {
    // CORS issue - try fetching via background script
    console.log('[Auto Verify] Canvas tainted, fetching via background...');
    return fetchImageAsBase64(img.src);
  }
}

/**
 * 通过 fetch 获取图像并转为 Base64（处理跨域）
 */
async function fetchImageAsBase64(url) {
  try {
    const response = await fetch(url, { mode: 'cors' });
    const blob = await response.blob();
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  } catch (e) {
    // Last resort: use the img src directly
    console.warn('[Auto Verify] Failed to fetch image, using src URL');
    return url;
  }
}

/**
 * 验证码结果填充器
 * 将 OCR 结果自动填入对应输入框
 */

/**
 * 填充识别结果到输入框
 * @param {HTMLInputElement} input - 目标输入框
 * @param {string} text - OCR 识别的文本
 */
function fillResult(input, text) {
  if (!input || !text) return false;

  // Clean up OCR result (remove whitespace, special chars that are likely noise)
  const cleanText = text
    .replace(/\s+/g, '')
    .replace(/[^\w\u4e00-\u9fff]/g, '');

  if (!cleanText) return false;

  // Focus the input
  input.focus();

  // Set value using native setter to work with React/Vue etc.
  const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype, 'value'
  )?.set;

  if (nativeInputValueSetter) {
    nativeInputValueSetter.call(input, cleanText);
  } else {
    input.value = cleanText;
  }

  // Dispatch events to trigger framework reactivity
  const events = ['input', 'change', 'keydown', 'keyup', 'keypress'];
  for (const eventType of events) {
    const event = new Event(eventType, { bubbles: true, cancelable: true });
    input.dispatchEvent(event);
  }

  return true;
}

/**
 * Content Script 主入口
 * 协调验证码检测 → 截取 → 识别 → 填充流程
 */


let detectedCaptchas = [];
let overlayElements = [];

// Helper: get i18n message
const i18n = (key, ...args) => chrome.i18n.getMessage(key, args) || key;

// --- Theme Management ---
function applyTheme(theme) {
  if (theme === 'system') {
    const isDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light');
  } else {
    document.documentElement.setAttribute('data-theme', theme);
  }
}

// Initial theme load
chrome.storage.local.get(['theme'], (result) => {
  const theme = result.theme || 'system';
  applyTheme(theme);
});

// Watch for theme changes from popup
chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace === 'local' && changes.theme) {
    applyTheme(changes.theme.newValue || 'system');
  }
});

// Watch for system theme changes
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  chrome.storage.local.get(['theme'], (result) => {
    if (!result.theme || result.theme === 'system') {
      applyTheme('system');
    }
  });
});

/**
 * 扫描并标记验证码
 */
function scanAndMark() {
  // Clean previous overlays
  clearOverlays();

  detectedCaptchas = detectCaptchaElements();

  if (detectedCaptchas.length === 0) {
    console.log('[Auto Verify] No captcha elements detected');
    return;
  }

  console.log(`[Auto Verify] Detected ${detectedCaptchas.length} captcha(s)`);

  // Add overlay buttons to each detected captcha
  detectedCaptchas.forEach((el, index) => {
    createOverlay(el, index);
  });
}

/**
 * 创建识别按钮覆盖层
 */
function createOverlay(captchaEl, index) {
  const rect = captchaEl.getBoundingClientRect();

  const wrapper = document.createElement('div');
  wrapper.className = 'av-overlay-wrapper';
  wrapper.style.position = 'absolute';
  wrapper.style.left = `${rect.left + window.scrollX}px`;
  wrapper.style.top = `${rect.top + window.scrollY}px`;
  wrapper.style.width = `${rect.width}px`;
  wrapper.style.height = `${rect.height}px`;
  wrapper.style.pointerEvents = 'none';
  wrapper.style.zIndex = '2147483647';

  // Highlight border
  const highlight = document.createElement('div');
  highlight.className = 'av-highlight';
  wrapper.appendChild(highlight);

  // Recognize button
  const btn = document.createElement('button');
  btn.className = 'av-recognize-btn';
  btn.textContent = i18n('btnRecognizeLabel');
  btn.style.pointerEvents = 'auto';
  btn.dataset.index = index;
  btn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    recognizeSingle(index, btn);
  });
  wrapper.appendChild(btn);

  document.body.appendChild(wrapper);
  overlayElements.push(wrapper);
}

// Global mouse tracker to handle hover state for overlays without blocking actual element clicks
let isMouseTrackerAdded = false;
function initMouseTracker() {
  if (isMouseTrackerAdded) return;
  isMouseTrackerAdded = true;
  
  document.addEventListener('mousemove', (e) => {
    if (detectedCaptchas.length === 0) return;
    
    detectedCaptchas.forEach((captchaEl, i) => {
      const wrapper = overlayElements[i];
      if (!wrapper) return;
      
      const rect = captchaEl.getBoundingClientRect();
      const isHoveringImg = e.clientX >= rect.left && e.clientX <= rect.right && 
                            e.clientY >= rect.top && e.clientY <= rect.bottom;
      
      const btn = wrapper.querySelector('.av-recognize-btn');
      let isHoveringBtn = false;
      if (btn) {
        const btnRect = btn.getBoundingClientRect();
        isHoveringBtn = e.clientX >= btnRect.left && e.clientX <= btnRect.right && 
                        e.clientY >= btnRect.top && e.clientY <= btnRect.bottom;
      }

      if (isHoveringImg || isHoveringBtn) {
        wrapper.classList.add('av-hover');
      } else {
        wrapper.classList.remove('av-hover');
      }
    });
  }, { passive: true });
}
initMouseTracker();

/**
 * 清除覆盖层
 */
function clearOverlays() {
  overlayElements.forEach(el => el.remove());
  overlayElements = [];
}

/**
 * 更新覆盖层位置
 */
function updateOverlayPositions() {
  if (detectedCaptchas.length === 0 || overlayElements.length === 0) return;
  
  detectedCaptchas.forEach((captchaEl, index) => {
    const wrapper = overlayElements[index];
    if (!wrapper || !document.body.contains(captchaEl)) return;
    
    const rect = captchaEl.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;

    wrapper.style.left = `${rect.left + window.scrollX}px`;
    wrapper.style.top = `${rect.top + window.scrollY}px`;
    wrapper.style.width = `${rect.width}px`;
    wrapper.style.height = `${rect.height}px`;
  });
}

// Global listeners for responsive overlays
window.addEventListener('resize', updateOverlayPositions, { passive: true });
// Optional: also track scroll for cases where images are inside scrollable sub-containers
window.addEventListener('scroll', updateOverlayPositions, { passive: true, capture: true });

/**
 * 识别单个验证码
 */
async function recognizeSingle(index, btn) {
  const captchaEl = detectedCaptchas[index];
  if (!captchaEl) return;

  // Keep the button active and unchanged during processing
  // btn.disabled = true;
  // btn.classList.add('av-loading');

  try {
    // Capture the image
    const imageBase64 = await captureElement(captchaEl);

    // Send to background for OCR
    chrome.runtime.sendMessage({
      type: 'RECOGNIZE_CAPTCHA',
      imageBase64,
      options: {
        lang: 'eng',
        preprocess: true,
      },
      captchaIndex: index,
    });
  } catch (err) {
    console.error('[Auto Verify] Capture failed:', err);
    btn.textContent = i18n('btnFailed');
    btn.classList.add('av-error');
    setTimeout(() => {
      btn.textContent = i18n('btnRecognizeLabel');
      btn.disabled = false;
      btn.classList.remove('av-error');
    }, 2000);
  }
}

/**
 * 识别所有检测到的验证码
 */
async function recognizeAll() {
  for (let i = 0; i < detectedCaptchas.length; i++) {
    const btn = document.querySelector(`.av-recognize-btn[data-index="${i}"]`);
    if (btn) {
      await recognizeSingle(i, btn);
    }
  }
}

/**
 * 监听来自 Service Worker 的消息
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'CAPTCHA_RESULT') {
    const { result, captchaIndex } = message;
    
    // If ignored, just reset the button state and stop
    if (result.ignored) {
      const btnSelector = captchaIndex !== undefined 
        ? `.av-recognize-btn[data-index="${captchaIndex}"]`
        : '.av-recognize-btn';
      document.querySelectorAll(btnSelector).forEach(btn => {
        btn.textContent = i18n('btnRecognizeLabel');
        btn.disabled = false;
        btn.classList.remove('av-loading');
      });
      return;
    }

    console.log(`[Auto Verify] OCR Result: "${result.text}" (confidence: ${result.confidence}%)`);

    // Target the specific captcha if index is provided, otherwise fallback to first
    const targetIndex = captchaIndex !== undefined ? captchaIndex : 0;
    
    // Try to fill the result
    if (detectedCaptchas.length > targetIndex) {
      const captchaEl = detectedCaptchas[targetIndex];
      const input = findRelatedInput(captchaEl);
      if (input) {
        fillResult(input, result.text);
      }
    }

    // Update the specific button state
    const btnSelector = captchaIndex !== undefined 
      ? `.av-recognize-btn[data-index="${captchaIndex}"]`
      : '.av-recognize-btn';
    
    document.querySelectorAll(btnSelector).forEach(btn => {
      btn.innerHTML = `
        <span class="av-btn-icon">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="20 6 9 17 4 12"></polyline>
          </svg>
        </span>
        <span class="av-btn-text" style="font-size:12px">${result.text}</span>
      `;
      btn.classList.add('av-success');
      setTimeout(() => {
        btn.textContent = i18n('btnRecognizeLabel');
        btn.classList.remove('av-success');
      }, 1500);
    });
  }

  if (message.type === 'CAPTCHA_ERROR') {
    const { error, captchaIndex } = message;
    console.error('[Auto Verify] OCR Error:', error);

    const btnSelector = captchaIndex !== undefined 
      ? `.av-recognize-btn[data-index="${captchaIndex}"]`
      : '.av-recognize-btn';

    document.querySelectorAll(btnSelector).forEach(btn => {
      btn.textContent = i18n('btnFailed');
      setTimeout(() => {
        btn.textContent = i18n('btnRecognizeLabel');
      }, 2000);
    });
  }

  if (message.type === 'TRIGGER_DETECT_AND_RECOGNIZE') {
    scanAndMark();
    if (detectedCaptchas.length > 0) {
      recognizeAll();
    } else {
      const msg = i18n('toastFailed', 'No Captcha Detected');
      showToast(msg, 'error');
      chrome.runtime.sendMessage({
        type: 'CAPTCHA_ERROR',
        error: 'No Captcha Detected' // Keep simple for popup
      }).catch(() => {});
    }
  }
});

/**
 * 显示提示 Toast
 */
function showToast(text, type = 'info') {
  // Remove existing toast
  document.querySelector('.av-toast')?.remove();

  const toast = document.createElement('div');
  toast.className = `av-toast av-toast-${type}`;
  toast.textContent = text;
  document.body.appendChild(toast);

  // Animate in
  requestAnimationFrame(() => {
    toast.classList.add('av-toast-show');
  });

  // Auto remove
  setTimeout(() => {
    toast.classList.remove('av-toast-show');
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

/**
 * 初始化自动检测
 */
function initAutoDetect() {
  // Initial scan on load
  setTimeout(() => {
    scanAndMark();
    if (detectedCaptchas.length > 0) {
      recognizeAll();
    }
  }, 1000);

  // Global flag to track if we need to recognize due to attribute changes
  let pendingSrcChange = false;

  // Re-scan on dynamic content changes
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type === 'attributes' && mutation.attributeName === 'src') {
        const target = mutation.target;
        if (detectedCaptchas.includes(target)) {
          pendingSrcChange = true;
          break;
        }
      }
    }

    // Debounce
    clearTimeout(observer._timeout);
    observer._timeout = setTimeout(() => {
      // DISCONNECT before scanning to avoid infinite loop where our overlay triggers mutations
      observer.disconnect();

      const prevCount = detectedCaptchas.length;
      scanAndMark();
      
      // Auto-recognize if new captchas were found, or an existing captcha's src changed
      if (detectedCaptchas.length > 0 && (detectedCaptchas.length !== prevCount || pendingSrcChange)) {
        pendingSrcChange = false; // reset flag
        recognizeAll();
      }

      // RECONNECT after scanning
      observer.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['src']
      });
    }, 800); // reduced debounce slightly for better UX
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['src']
  });

  // Store globally so we can disconnect if blacklisted
  window._captchaObserver = observer;
  console.log('[Auto Verify] Content script loaded and auto-detect enabled');
}

/**
 * 检查黑名单并决定是否初始化
 */
function checkBlacklistAndInit() {
  chrome.storage.local.get(['blacklistDoc'], (result) => {
    const list = result.blacklistDoc || [];
    const host = window.location.hostname;
    
    if (list.includes(host)) {
      console.log(`[Auto Verify] Auto-detect disabled for ${host} via blacklist.`);
      if (window._captchaObserver) {
        window._captchaObserver.disconnect();
        // Clear references and pending timeouts
        clearTimeout(window._captchaObserver._timeout);
        window._captchaObserver = null;
      }
      clearOverlays();
      detectedCaptchas = [];
    } else {
      if (!window._captchaObserver) {
        initAutoDetect();
      }
    }
  });
}

// Check on load
checkBlacklistAndInit();

// Listen for blacklist changes from popup/options
chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace === 'local' && changes.blacklistDoc) {
    checkBlacklistAndInit();
  }
});
