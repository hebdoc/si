/**
 * Popup 主逻辑
 */

// Helper: get i18n message
const i18n = (key, ...args) => chrome.i18n.getMessage(key, args) || key;

// Apply i18n to all elements with data-i18n attribute
function applyI18n(container = document) {
  container.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    const msg = i18n(key);
    if (msg) el.textContent = msg;
  });
  
  container.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    const key = el.getAttribute('data-i18n-placeholder');
    const msg = i18n(key);
    if (msg) el.placeholder = msg;
  });
}

// Elements
const btnScan = document.getElementById('btn-scan');
const btnCopy = document.getElementById('btn-copy');

const langSelect = document.getElementById('lang-select');
const themeSelect = document.getElementById('theme-select');
const caseSelect = document.getElementById('case-select');
const resultSection = document.getElementById('result-section');
const resultText = document.getElementById('result-text');
const resultConfidence = document.getElementById('result-confidence');

// Settings Elements
const blacklistSetting = document.getElementById('blacklist-setting');
const blacklistToggle = document.getElementById('blacklist-toggle');
const currentDomainText = document.getElementById('current-domain-text');

// Blacklist Management
const blacklistContainer = document.getElementById('blacklist-container');
const newDomainInput = document.getElementById('new-domain');
const btnAddDomain = document.getElementById('btn-add-domain');

let currentResult = null;

/**
 * 初始化
 */
async function init() {
  applyI18n();
  loadBlacklist();

  const appVersionEl = document.getElementById('app-version');
  if (appVersionEl) {
    appVersionEl.textContent = `CaptchaX v${chrome.runtime.getManifest().version}`;
  }

  // Load saved preferences
  const { lang, theme, blacklistDoc, textCase } = await chrome.storage.local.get(['lang', 'theme', 'blacklistDoc', 'textCase']);
  if (lang) langSelect.value = lang;
  if (textCase) caseSelect.value = textCase;
  
  if (theme) {
    themeSelect.value = theme;
  } else {
    themeSelect.value = 'system';
  }
  applyTheme(themeSelect.value);

  // Init Blacklist Toggle for current tab
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const activeTab = tabs[0];
    if (activeTab && activeTab.url && activeTab.url.startsWith('http')) {
      try {
        const urlObj = new URL(activeTab.url);
        const host = urlObj.hostname;
        
        blacklistSetting.style.display = 'flex';
        currentDomainText.style.display = 'block';
        currentDomainText.textContent = host;

        const blacklist = blacklistDoc || [];
        // If host is IN blacklist, auto-detect is OFF (checkbox unchecked)
        // If host is NOT in blacklist, auto-detect is ON (checkbox checked)
        blacklistToggle.checked = !blacklist.includes(host);
        blacklistToggle.dataset.host = host;

      } catch (e) {
        console.error('Invalid URL:', activeTab.url);
      }
    }
  });

  setupEventListeners();
}

/**
 * 绑定事件
 */
function setupEventListeners() {
  // Scan button (Merged functionality)
  btnScan.addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'TRIGGER_RECOGNIZE' });
    showProgress();
  });

  // Copy button
  btnCopy.addEventListener('click', () => {
    if (currentResult) {
      navigator.clipboard.writeText(currentResult.text).then(() => {
        const originalHtml = btnCopy.innerHTML;
        btnCopy.innerHTML = `
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:4px">
            <polyline points="20 6 9 17 4 12"></polyline>
          </svg>
          <span data-i18n="btnCopied">${i18n('btnCopied')}</span>
        `;
        setTimeout(() => { btnCopy.innerHTML = originalHtml; }, 1500);
      });
    }
  });



  // Language select
  langSelect.addEventListener('change', () => {
    chrome.storage.local.set({ lang: langSelect.value });
  });

  // Output Case select
  caseSelect.addEventListener('change', () => {
    chrome.storage.local.set({ textCase: caseSelect.value });
  });

  // Theme select
  themeSelect.addEventListener('change', () => {
    const selectedTheme = themeSelect.value;
    chrome.storage.local.set({ theme: selectedTheme });
    applyTheme(selectedTheme);
  });

  // Listen for system theme changes if set to 'system'
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (themeSelect.value === 'system') {
      applyTheme('system');
    }
  });

  // Blacklist toggle
  blacklistToggle.addEventListener('change', async (e) => {
    const host = e.target.dataset.host;
    if (!host) return;

    const isEnabled = e.target.checked;
    
    // Get latest storage
    const { blacklistDoc } = await chrome.storage.local.get('blacklistDoc');
    let blacklist = blacklistDoc || [];
    
    if (isEnabled) {
      // Remove from blacklist
      blacklist = blacklist.filter(h => h !== host);
    } else {
      // Add to blacklist
      if (!blacklist.includes(host)) {
        blacklist.push(host);
      }
    }
    
    await chrome.storage.local.set({ blacklistDoc: blacklist });
    loadBlacklist(); // Re-render the list
  });

  // Add Domain
  btnAddDomain.addEventListener('click', async () => {
    const val = newDomainInput.value.trim().toLowerCase();
    if (!val) return;
    
    let domain = val;
    if (domain.startsWith('http')) {
      try {
        domain = new URL(domain).hostname;
      } catch(e) {}
    } else {
      domain = domain.replace(/\/$/, '');
    }

    const { blacklistDoc } = await chrome.storage.local.get('blacklistDoc');
    let blacklist = blacklistDoc || [];
    
    if (!blacklist.includes(domain)) {
      blacklist.push(domain);
      await chrome.storage.local.set({ blacklistDoc: blacklist });
      newDomainInput.value = '';
      loadBlacklist();
      
      // Update quick toggle if this is the active domain
      if (domain === blacklistToggle.dataset.host) {
        blacklistToggle.checked = false;
      }
    }
  });

  newDomainInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') btnAddDomain.click();
  });



  // Listen for results from background
  chrome.runtime.onMessage.addListener((message) => {
    // Note: OCR_PROGRESS_UPDATE is ignored entirely now for UI speed
    
    if (message.type === 'CAPTCHA_RESULT') {
      hideProgress();
      if (message.result.ignored) {
        resultSection.classList.remove('hidden');
        resultText.textContent = i18n('resultUnreliable') || 'Result unreliable (too short)';
        resultText.style.fontSize = '14px';
        resultConfidence.textContent = '';
        return;
      }
      showResult(message.result);
    }

    if (message.type === 'CAPTCHA_ERROR') {
      hideProgress();
      resultSection.classList.remove('hidden');
      resultText.textContent = message.error;
      resultText.style.fontSize = '14px';
      resultConfidence.textContent = '';
    }
  });
}



/**
 * 显示按钮加载状态
 */
function showProgress() {
  btnScan.disabled = true;
  btnScan.innerHTML = `
    <span class="btn-icon spinner">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M21 12a9 9 0 1 1-6.219-8.56"></path>
      </svg>
    </span>
    <span class="btn-text" style="opacity: 0.9">${i18n('btnRecognizePage')}</span>
  `;
  resultSection.classList.add('hidden');
}

/**
 * 隐藏按钮加载状态
 */
function hideProgress() {
  btnScan.disabled = false;
  btnScan.innerHTML = `
    <span class="btn-icon">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M3 7V5a2 2 0 0 1 2-2h2"></path>
        <path d="M17 3h2a2 2 0 0 1 2 2v2"></path>
        <path d="M21 17v2a2 2 0 0 1-2 2h-2"></path>
        <path d="M7 21H5a2 2 0 0 1-2-2v-2"></path>
        <line x1="7" y1="12" x2="17" y2="12"></line>
      </svg>
    </span>
    <span class="btn-text" data-i18n="btnRecognizePage">${i18n('btnRecognizePage')}</span>
  `;
}

/**
 * 显示识别结果
 */
function showResult(result) {
  currentResult = result;
  resultSection.classList.remove('hidden');

  resultText.textContent = result.text || i18n('resultEmpty');
  resultText.style.fontSize = '';

  const confidence = Math.round(result.confidence);
  resultConfidence.textContent = i18n('confidenceLabel', String(confidence));
  resultConfidence.className = 'confidence-badge';

  if (confidence >= 80) {
    resultConfidence.classList.add('confidence-high');
  } else if (confidence >= 50) {
    resultConfidence.classList.add('confidence-medium');
  } else {
    resultConfidence.classList.add('confidence-low');
  }
}



/**
 * 加载黑名单并渲染可编辑列表
 */
async function loadBlacklist() {
  const { blacklistDoc } = await chrome.storage.local.get('blacklistDoc');
  const blacklist = blacklistDoc || [];
  
  blacklistContainer.innerHTML = '';
  
  if (blacklist.length === 0) {
    blacklistContainer.innerHTML = `<p class="empty-hint">${i18n('optionsBlacklistEmpty')}</p>`;
    return;
  }
  
  blacklist.forEach((domain, index) => {
    const item = document.createElement('div');
    item.className = 'blacklist-item';
    item.innerHTML = `
      <span class="blacklist-item-text" title="${domain}">${escapeHtml(domain)}</span>
      <div class="blacklist-actions">
        <button class="btn-small btn-ghost edit-btn" data-index="${index}" data-domain="${escapeHtml(domain)}">${i18n('btnEdit')}</button>
        <button class="btn-small btn-ghost delete-btn" data-index="${index}">${i18n('btnRemove')}</button>
      </div>
    `;
    blacklistContainer.appendChild(item);
  });

  // Bind edit/delete handlers
  blacklistContainer.querySelectorAll('.delete-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const idx = e.target.dataset.index;
      blacklist.splice(idx, 1);
      await chrome.storage.local.set({ blacklistDoc: blacklist });
      
      // sync quick toggle
      const hostToggle = blacklistToggle.dataset.host;
      if (hostToggle && !blacklist.includes(hostToggle)) {
        blacklistToggle.checked = true;
      }
      
      loadBlacklist();
    });
  });

  blacklistContainer.querySelectorAll('.edit-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const itemDiv = e.target.closest('.blacklist-item');
      const domain = e.target.dataset.domain;
      const idx = e.target.dataset.index;
      
      // Switch to edit mode
      itemDiv.innerHTML = `
        <input type="text" class="blacklist-item-input" value="${domain}" />
        <div class="blacklist-actions">
          <button class="btn-small btn-ghost save-btn">${i18n('btnSave')}</button>
          <button class="btn-small btn-ghost cancel-btn">${i18n('btnCancel')}</button>
        </div>
      `;
      
      const input = itemDiv.querySelector('input');
      input.focus();
      
      // Save handler
      const saveEdit = async () => {
        const newVal = input.value.trim().toLowerCase().replace(/\/$/, '');
        if (newVal && newVal !== domain) {
           // Prevent duplicates
           if (!blacklist.includes(newVal)) {
               blacklist[idx] = newVal;
           } else {
               blacklist.splice(idx, 1); // Remove if changed to existing
           }
           await chrome.storage.local.set({ blacklistDoc: blacklist });
           
           // sync quick toggle
           const hostToggle = blacklistToggle.dataset.host;
           if (hostToggle) {
             blacklistToggle.checked = !blacklist.includes(hostToggle);
           }
        }
        loadBlacklist();
      };
      
      itemDiv.querySelector('.save-btn').addEventListener('click', saveEdit);
      itemDiv.querySelector('.cancel-btn').addEventListener('click', loadBlacklist);
      input.addEventListener('keypress', (ev) => {
        if (ev.key === 'Enter') saveEdit();
      });
    });
  });
}

/**
 * HTML 转义
 */
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// Initialize
init();

// --- Theme Management ---
function applyTheme(theme) {
  if (theme === 'system') {
    const isDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light');
  } else {
    document.documentElement.setAttribute('data-theme', theme);
  }
}
