(function() {
    if (window.hasCaptchaXInjected) return;
    window.hasCaptchaXInjected = true;

    // 填充验证码逻辑
    function fillCaptchaResult(text, captchaElement, retryCount = 0) {
        if (!captchaElement || !text) return;

        // 寻找包含验证码的容器，增加医疗系统常见的类名支持
        const container = captchaElement.closest('form, .qbd_register_item_con, .login-box, div[class*="login"], .el-form, #loginForm, .login_form') || 
                          captchaElement.parentElement?.parentElement || 
                          document.body;

        const inputs = Array.from(container.querySelectorAll('input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"])'))
                            .filter(input => {
                                const style = window.getComputedStyle(input);
                                return style.display !== 'none' && style.visibility !== 'hidden' && !input.readOnly;
                            });

        let targetInput = null;
        let bestScore = -1;

        inputs.forEach(input => {
            const id = (input.id || '').toLowerCase();
            const name = (input.name || '').toLowerCase();
            const placeholder = (input.placeholder || '').toLowerCase();
            const className = (input.className || '').toLowerCase();
            const combinedAttr = `${id} ${name} ${placeholder} ${className}`;

            const excludeKeywords = ['user', 'name', 'phone', 'mobile', 'mail', 'search', 'password', 'pass', 'pwd'];
            if (excludeKeywords.some(key => combinedAttr.includes(key) && !combinedAttr.includes('verify'))) {
                return;
            }

            let score = 0;
            // 针对验证码输入框的特征打分
            if (combinedAttr.includes('verify') || combinedAttr.includes('cap') || combinedAttr.includes('code') || combinedAttr.includes('yzm') || combinedAttr.includes('check')) {
                score += 100;
            }
            
            // 物理距离打分
            const imgRect = captchaElement.getBoundingClientRect();
            const inputRect = input.getBoundingClientRect();
            const distance = Math.sqrt(Math.pow(imgRect.left - inputRect.left, 2) + Math.pow(imgRect.top - inputRect.top, 2));
            score += (1000 - Math.min(distance, 1000)) / 10;

            if (input.maxLength > 0 && input.maxLength <= 6) score += 20;

            if (score > bestScore) {
                bestScore = score;
                targetInput = input;
            }
        });

        if (targetInput) {
            targetInput.focus();
            targetInput.value = text;
            
            // 触发事件以适配 Vue/React 等框架
            ['input', 'change', 'blur'].forEach(name => {
                targetInput.dispatchEvent(new Event(name, { bubbles: true }));
            });

            if (typeof jQuery !== 'undefined') {
                const $input = jQuery(targetInput);
                $input.val(text).trigger('change').trigger('input');
            }
            console.log('[CaptchaX] 填充成功');
        } else if (retryCount < 5) {
            setTimeout(() => fillCaptchaResult(text, captchaElement, retryCount + 1), 500);
        }
    }

    // 监听后台消息
    chrome.runtime.onMessage.addListener((message) => {
        if (message.type === 'CAPTCHA_RESULT' && message.result && !message.result.ignored) {
            const captchaImg = document.querySelector(`[data-captcha-id="${message.captchaIndex}"]`);
            if (captchaImg) fillCaptchaResult(message.result.text, captchaImg);
        }
        if (message.type === 'TRIGGER_DETECT_AND_RECOGNIZE') detectAndSendCaptcha();
    });

    // 检测验证码图片
    function detectAndSendCaptcha() {
        const images = document.querySelectorAll('img, canvas');
        images.forEach(img => {
            if (img.offsetParent === null) return; 
            const style = window.getComputedStyle(img);
            if (style.display === 'none' || style.visibility === 'hidden') return;

            const src = img.src || '';
            // 增加尺寸判定，适配部分不带关键字的验证码
            const isCaptcha = /captcha|verify|yzm|code|check/i.test(src) || 
                              (img.width >= 40 && img.width <= 160 && img.height >= 20 && img.height <= 80);

            if (isCaptcha && !img.dataset.captchaId) {
                img.dataset.captchaId = 'captcha_' + Date.now() + '_' + Math.floor(Math.random() * 1000);
                getBase64(img).then(base64 => {
                    chrome.runtime.sendMessage({
                        type: 'RECOGNIZE_CAPTCHA',
                        imageBase64: base64,
                        captchaIndex: img.dataset.captchaId
                    });
                }).catch(() => {});
            }
        });
    }

    // 图片转 Base64，处理跨域
    async function getBase64(img) {
        if (img.src && img.src.startsWith('data:image')) return img.src;

        // 1. 优先尝试 Canvas (最快，不触发刷新)
        try {
            const canvas = document.createElement('canvas');
            canvas.width = img.naturalWidth || img.width;
            canvas.height = img.naturalHeight || img.height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0);
            return canvas.toDataURL('image/png');
        } catch (e) {
            // 2. 跨域失败时尝试 Fetch
            const response = await fetch(img.src, { mode: 'cors' });
            const blob = await response.blob();
            return new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onloadend = () => resolve(reader.result);
                reader.onerror = reject;
                reader.readAsDataURL(blob);
            });
        }
    }

    // 安全初始化：解决参数 1 不是 Node 的报错
    const startObserver = () => {
        if (!document.body) {
            // 如果 body 还没出来，等 100ms 再试
            setTimeout(startObserver, 100);
            return;
        }

        // 立即执行一次
        detectAndSendCaptcha();

        // 监听动态加载的内容
        const observer = new MutationObserver(() => {
            clearTimeout(window.captchaTimer);
            window.captchaTimer = setTimeout(detectAndSendCaptcha, 800);
        });

        observer.observe(document.body, { childList: true, subtree: true });
    };

    // 确保在页面加载后执行
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', startObserver);
    } else {
        startObserver();
    }
})();