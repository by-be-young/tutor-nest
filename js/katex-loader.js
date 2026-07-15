// ============================================================
//  KaTeX 自动加载与渲染 (独立模块)
//  使用 bootcdn 国内镜像，避免 Tracking Prevention 拦截
// ============================================================

(function () {
    const KATEX_CSS = 'https://cdn.bootcdn.net/ajax/libs/KaTeX/0.16.9/katex.min.css';
    const KATEX_JS = 'https://cdn.bootcdn.net/ajax/libs/KaTeX/0.16.9/katex.min.js';
    const AUTORENDER_JS = 'https://cdn.bootcdn.net/ajax/libs/KaTeX/0.16.9/contrib/auto-render.min.js';

    let isLoaded = false;
    let loadPromise = null;

    function loadCSS(href) {
        if (document.querySelector(`link[href="${href}"]`)) return;
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = href;
        document.head.appendChild(link);
    }

    function loadScript(src) {
        return new Promise((resolve, reject) => {
            const existing = document.querySelector(`script[src="${src}"]`);
            if (existing) {
                if (existing.dataset.loaded === 'true') {
                    resolve();
                    return;
                }
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

    function renderMath(element) {
        if (!element) return;
        if (!window.renderMathInElement) {
            loadKatex().then(() => renderMath(element));
            return;
        }
        try {
            // 使用 ignoredClasses 跳过 question-slot，避免移除/重新插入导致 observer 循环触发
            window.renderMathInElement(element, {
                delimiters: [
                    { left: '$$', right: '$$', display: true },
                    { left: '$', right: '$', display: false },
                    { left: '\\(', right: '\\)', display: false },
                    { left: '\\[', right: '\\]', display: true }
                ],
                throwOnError: false,
                ignoredClasses: ['question-slot']
            });
        } catch (e) {
            console.warn('KaTeX 渲染出错:', e);
        }
    }

    function observeDetailBody() {
        const target = document.querySelector('.detail-body');
        if (!target) {
            setTimeout(observeDetailBody, 500);
            return;
        }

        if (target.innerHTML.trim() !== '') {
            loadKatex().then(() => renderMath(target));
        }

        const observer = new MutationObserver(() => {
            if (observer._rendering) return;
            observer._rendering = true;
            loadKatex().then(() => {
                renderMath(target);
                observer._rendering = false;
            }).catch(() => {
                observer._rendering = false;
            });
        });
        observer.observe(target, {
            childList: true,
            subtree: true
        });
    }

    window.katexLoader = {
        load: loadKatex,
        render: renderMath,
        loadAndRender: function (element) {
            return loadKatex().then(() => renderMath(element));
        }
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', observeDetailBody);
    } else {
        observeDetailBody();
    }
})();