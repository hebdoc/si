(function() {
    if (window.hasCaptchaXInjected) return;
    window.hasCaptchaXInjected = true;

    function fillCaptchaResult(text, captchaElement, retryCount = 0) {
        if (!captchaElement || !text) return;

        const container = captchaElement.closest('form, .qbd_register_item_con, .login-box, div[class*="login"], .el-form') || 
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
            if (combinedAttr.includes('verify') || combinedAttr.includes('cap') || combinedAttr.includes('code') || combinedAttr.includes('yzm') || combinedAttr.includes('check')) {
                score += 100;
            }
            
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
            
            ['input', 'change', 'blur'].forEach(name => {
                targetInput.dispatchEvent(new Event(name, { bubbles: true }));
            });

            if (typeof jQuery !== 'undefined') {
                const $input = jQuery(targetInput);
                $input.val(text).trigger('change').trigger('input');
            }
            console.log('[CaptchaX] 验证码填充成功');
        } else {
            if (retryCount < 5) {
                setTimeout(() => fillCaptchaResult(text, captchaElement, retryCount + 1), 500);
            }
        }
    }

    chrome.runtime.onMessage.addListener((message) => {
        if (message.type === 'CAPTCHA_RESULT') {
            if (message.result && !message.result.ignored) {
                const captchaImg = document.querySelector(`[data-captcha-id="${message.captchaIndex}"]`);
                if (captchaImg) fillCaptchaResult(message.result.text, captchaImg);
            }
        }
    });

    function detectAndSendCaptcha() {
        const images = document.querySelectorAll('img, canvas');
        images.forEach(img => {
            if (img.offsetParent === null || img.dataset.captchaId) return; 
            
            const src = img.src || '';
            // 过滤掉明显的导航图标和非验证码图片（参考你的日志，排除 nav*.png）
            if (src.includes('nav') || src.includes('arrow') || src.includes('icon')) return;

            const isCaptcha = /captcha|verify|yzm|code/i.test(src) || 
                              (img.width >= 30 && img.width <= 160 && img.height >= 20 && img.height <= 80);

            if (isCaptcha) {
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

    async function getBase64(img) {
        if (img.src && img.src.startsWith('data:image')) return img.src;

        // 1. 尝试 Canvas 提取
        try {
            const canvas = document.createElement('canvas');
            canvas.width = img.naturalWidth || img.width;
            canvas.height = img.naturalHeight || img.height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0);
            return canvas.toDataURL('image/png');
        } catch (e) {
            // 2. CORS 失败时尝试 Fetch，不带 credentials 以符合 '*' 策略
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

    // 安全启动监听
    const init = () => {
        if (!document.body) {
            setTimeout(init, 100);
            return;
        }
        detectAndSendCaptcha();
        const observer = new MutationObserver(() => {
            clearTimeout(window.captchaTimer);
            window.captchaTimer = setTimeout(detectAndSendCaptcha, 800);
        });
        observer.observe(document.body, { childList: true, subtree: true });
    };

    init();
})();