(function() {
    if (window.hasCaptchaXInjected) return;
    window.hasCaptchaXInjected = true;

    // 1. 配置过滤规则：与成功脚本保持一致
    const KEYWORDS = ['captcha', 'verify', 'code', 'yzm', 'check', '验证码'];
    const BLACKLIST = ['logo', 'icon', 'nav', 'avatar', 'banner', 'arrow', 'doctor', 'bg', 'readme', 'markdown'];
    const SIZE = { minW: 40, maxW: 350, minH: 15, maxH: 120 };

    // 2. 图像提取核心：强制标准化（解决识别成 D/1 的关键）
    async function getStandardBase64(el) {
        try {
            // 创建一个干净的 Canvas
            const canvas = document.createElement('canvas');
            const w = el.naturalWidth || el.width || el.offsetWidth;
            const h = el.naturalHeight || el.height || el.offsetHeight;
            canvas.width = w;
            canvas.height = h;
            const ctx = canvas.getContext('2d');

            // 【关键步骤】强制填充纯白背景
            // 离线网页 Canvas 默认透明，Tesseract 处理透明图片极易出错，
            // 填充白底后，AI 看到的图片会变得极其清晰。
            ctx.fillStyle = "#FFFFFF";
            ctx.fillRect(0, 0, w, h);
            
            // 绘制原始图像
            ctx.drawImage(el, 0, 0, w, h);

            // 导出 Base64
            const dataUrl = canvas.toDataURL('image/png');
            // 如果数据长度太短（说明提取被拦截），返回 null
            return dataUrl.length > 500 ? dataUrl : null;
        } catch (e) {
            // 针对在线跨域图片（如好医生）使用 Fetch 模式
            if (el.tagName === 'IMG' && el.src && !el.src.startsWith('data:')) {
                try {
                    const resp = await fetch(el.src, { mode: 'cors' });
                    const blob = await resp.blob();
                    return new Promise(res => {
                        const r = new FileReader();
                        r.onloadend = () => res(r.result);
                        r.readAsDataURL(blob);
                    });
                } catch (f) { return null; }
            }
            return null;
        }
    }

    // 3. 自动填充逻辑：适配成功脚本的 Service Worker 消息格式
    function fillCaptcha(text, captchaEl) {
        const container = captchaEl.closest('form, .login-box, .captcha-container, #loginForm') || document.body;
        const inputs = Array.from(container.querySelectorAll('input:not([type="hidden"])'))
            .filter(i => {
                const s = window.getComputedStyle(i);
                return s.display !== 'none' && !i.readOnly;
            });

        let target = null;
        let maxScore = -1;

        inputs.forEach(input => {
            const str = `${input.id} ${input.name} ${input.placeholder}`.toLowerCase();
            let score = 0;
            if (KEYWORDS.some(k => str.includes(k)) || str.includes('input')) score += 100;
            
            const r1 = captchaEl.getBoundingClientRect();
            const r2 = input.getBoundingClientRect();
            const d = Math.sqrt(Math.pow(r1.x - r2.x, 2) + Math.pow(r1.y - r2.y, 2));
            score += (1000 - Math.min(d, 1000)) / 10;

            if (score > maxScore) { maxScore = score; target = input; }
        });

        if (target) {
            target.focus();
            target.value = text;
            ['input', 'change', 'blur'].forEach(n => target.dispatchEvent(new Event(n, { bubbles: true })));
            console.log('[CaptchaX] 离线识别成功并填入:', text);
        }
    }

    // 4. 扫描函数
    function scan() {
        const elements = document.querySelectorAll('img, canvas');
        elements.forEach(el => {
            if (el.offsetParent === null || el.dataset.captchaId) return;

            const attr = `${el.id} ${el.className} ${el.src || ''}`.toLowerCase();
            
            // 过滤黑名单，防止识别 Logo（防止识别成“一”）
            if (BLACKLIST.some(b => attr.includes(b))) return;

            const isSizeMatch = el.width >= SIZE.minW && el.width <= SIZE.maxW && 
                                el.height >= SIZE.minH && el.height <= SIZE.maxH;
            const hasKey = KEYWORDS.some(k => attr.includes(k));

            if (isSizeMatch || hasKey) {
                el.dataset.captchaId = 'captcha_' + Date.now();
                getStandardBase64(el).then(base64 => {
                    if (base64) {
                        // 发送给 service-worker.js
                        chrome.runtime.sendMessage({
                            type: 'RECOGNIZE_CAPTCHA',
                            imageBase64: base64,
                            captchaIndex: el.dataset.captchaId
                        });
                    }
                });
            }
        });
    }

    // 5. 监听 Service Worker 返回的结果
    chrome.runtime.onMessage.addListener(msg => {
        if (msg.type === 'CAPTCHA_RESULT') {
            const el = document.querySelector(`[data-captcha-id="${msg.captchaIndex}"]`);
            if (el) fillCaptcha(msg.result.text, el);
        }
    });

    // 6. 动态监听（适配离线页点击更换验证码）
    const runner = () => {
        if (!document.body) { setTimeout(runner, 100); return; }
        scan();
        const observer = new MutationObserver(mutations => {
            mutations.forEach(m => {
                // 当 Canvas 重绘或图片 src 变化时，清除标记以便重新识别
                if (m.target.tagName === 'CANVAS' || m.attributeName === 'src') {
                    delete m.target.dataset.captchaId;
                }
            });
            clearTimeout(window.capT);
            window.capT = setTimeout(scan, 800);
        });
        observer.observe(document.body, { 
            childList: true, subtree: true, attributes: true, 
            attributeFilter: ['src', 'id', 'class'] 
        });
    };

    runner();
})();