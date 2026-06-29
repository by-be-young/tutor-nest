// ============================================================
//  KaTeX 自动加载与渲染 (独立模块)
//  依赖：无，自动从 CDN 加载 KaTeX 核心库与 auto-render
//  用法：在 HTML 中引入此文件，它会自动监听 .detail-body 元素
//        当内容变化时重新渲染公式，支持 $...$、$$...$$ 等语法
// ============================================================

(function () {
    // ----- 配置 -----
    const KATEX_CSS = 'https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css';
    const KATEX_JS = 'https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.js';
    const AUTORENDER_JS = 'https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/contrib/auto-render.min.js';

    let isLoaded = false;
    let loadPromise = null;

    // ----- 辅助：加载 CSS / JS -----
    function loadCSS(href) {
        if (document.querySelector(`link[href="${href}"]`)) return;
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = href;
        document.head.appendChild(link);
    }

    function loadScript(src) {
        return new Promise((resolve, reject) => {
            // 检查是否已存在相同 src 的脚本
            const existing = document.querySelector(`script[src="${src}"]`);
            if (existing) {
                // 如果已加载完成则立即 resolve
                if (existing.dataset.loaded === 'true') {
                    resolve();
                    return;
                }
                // 否则监听 load 事件
                existing.addEventListener('load', resolve);
                existing.addEventListener('error', reject);
                return;
            }
            const script = document.createElement('script');
            script.src = src;
            script.async = true;
            script.onload = () => {
                script.dataset.loaded = 'true';
                resolve();
            };
            script.onerror = reject;
            document.head.appendChild(script);
        });
    }

    // ----- 加载 KaTeX + auto-render -----
    function loadKatex() {
        if (isLoaded) return Promise.resolve();
        if (loadPromise) return loadPromise;

        loadCSS(KATEX_CSS);

        loadPromise = loadScript(KATEX_JS)
            .then(() => loadScript(AUTORENDER_JS))
            .then(() => {
                isLoaded = true;
                return window.katex;
            })
            .catch(err => {
                console.warn('KaTeX 加载失败:', err);
                loadPromise = null;
                throw err;
            });
        return loadPromise;
    }

    // ----- 渲染指定容器内的公式 -----
    function renderMath(element) {
        if (!element) return;
        if (!window.renderMathInElement) {
            // 如果未加载，尝试加载
            loadKatex().then(() => renderMath(element));
            return;
        }
        try {
            window.renderMathInElement(element, {
                delimiters: [
                    { left: '$$', right: '$$', display: true },
                    { left: '$', right: '$', display: false },
                    { left: '\\(', right: '\\)', display: false },
                    { left: '\\[', right: '\\]', display: true }
                ],
                throwOnError: false
            });
        } catch (e) {
            console.warn('KaTeX 渲染出错:', e);
        }
    }

    // ----- 自动监听目标容器 -----
    function observeDetailBody() {
        const target = document.querySelector('.detail-body');
        if (!target) {
            // 如果当前页面没有 .detail-body，稍后重试一次
            setTimeout(observeDetailBody, 500);
            return;
        }

        // 首次加载时渲染
        if (target.innerHTML.trim() !== '') {
            loadKatex().then(() => renderMath(target));
        }

        // 监听内容变化（由 main.js 动态插入）
        const observer = new MutationObserver(() => {
            // 内容改变时重新渲染
            loadKatex().then(() => renderMath(target));
        });
        observer.observe(target, {
            childList: true,
            subtree: true,
            characterData: true
        });
    }

    // ----- 暴露公共 API（方便手动调用） -----
    window.katexLoader = {
        load: loadKatex,
        render: renderMath,
        loadAndRender: function (element) {
            return loadKatex().then(() => renderMath(element));
        }
    };

    // ----- 启动（等待 DOM 就绪） -----
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', observeDetailBody);
    } else {
        observeDetailBody();
    }
})();