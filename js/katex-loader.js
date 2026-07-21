/**
 * katex-loader.js (加速版)
 * - 一次性渲染整个容器
 * - 文本节点预处理，无克隆
 * - 预连接 CDN，缩短超时
 * - 保留超长公式强制换行（内联样式覆盖）
 */
(function () {
    'use strict';

    const KATEX_CSS = 'https://cdn.bootcdn.net/ajax/libs/KaTeX/0.16.9/katex.min.css';
    const KATEX_JS = 'https://cdn.bootcdn.net/ajax/libs/KaTeX/0.16.9/katex.min.js';
    const AUTORENDER_JS = 'https://cdn.bootcdn.net/ajax/libs/KaTeX/0.16.9/contrib/auto-render.min.js';
    const RENDER_TIMEOUT = 5000;  // 缩短到 5s

    let isLoaded = false, loadPromise = null;

    // ---------- 预连接 ----------
    function preconnect(url) {
        const link = document.createElement('link');
        link.rel = 'preconnect';
        link.href = url;
        link.crossOrigin = 'anonymous';
        document.head.appendChild(link);
    }
    preconnect('https://cdn.bootcdn.net');

    // ---------- 资源加载 ----------
    function loadCSS(href) {
        if (document.querySelector(`link[href="${href}"]`)) return;
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = href;
        document.head.appendChild(link);
    }

    function loadScript(src) {
        return new Promise((resolve, reject) => {
            const exist = document.querySelector(`script[src="${src}"]`);
            if (exist) {
                if (exist.dataset.loaded === 'true') return resolve();
                exist.addEventListener('load', resolve, { once: true });
                exist.addEventListener('error', reject, { once: true });
                return;
            }
            const s = document.createElement('script');
            s.src = src;
            s.async = true;
            s.onload = () => { s.dataset.loaded = 'true'; resolve(); };
            s.onerror = reject;
            document.head.appendChild(s);
        });
    }

    function loadKatex() {
        if (isLoaded) return Promise.resolve(window.katex);
        if (loadPromise) return loadPromise;
        loadCSS(KATEX_CSS);
        loadPromise = loadScript(KATEX_JS)
            .then(() => loadScript(AUTORENDER_JS))
            .then(() => { isLoaded = true; return window.katex; })
            .catch(e => { loadPromise = null; throw e; });
        return loadPromise;
    }

    // ---------- 预处理：仅遍历文本节点 ----------
    function preprocessTextNodes(root) {
        const walker = document.createTreeWalker(
            root,
            NodeFilter.SHOW_TEXT,
            {
                acceptNode: function (node) {
                    // 跳过公式已渲染区域、代码块等
                    let parent = node.parentElement;
                    while (parent && parent !== root) {
                        const tag = parent.tagName.toLowerCase();
                        if (['code', 'pre', 'script', 'style', 'textarea'].includes(tag) ||
                            parent.classList.contains('katex')) {
                            return NodeFilter.FILTER_REJECT;
                        }
                        parent = parent.parentElement;
                    }
                    return NodeFilter.FILTER_ACCEPT;
                }
            }
        );
        let node;
        while ((node = walker.nextNode())) {
            node.textContent = node.textContent.replace(/\\cdotp/g, '\\cdot');
        }
    }

    // ---------- 强制换行（精简版，一次性处理） ----------
    function forceBreakAllKatex(container) {
        if (!container) return;

        // 所有 katex 相关元素
        container.querySelectorAll('[class*="katex"]').forEach(el => {
            el.style.setProperty('white-space', 'normal', 'important');
            el.style.setProperty('word-break', 'break-all', 'important');
            el.style.setProperty('overflow-wrap', 'anywhere', 'important');
        });

        // 块级公式
        container.querySelectorAll('.katex-display').forEach(disp => {
            disp.style.setProperty('display', 'block', 'important');
            disp.style.setProperty('max-width', '100%', 'important');
            disp.style.setProperty('overflow', 'visible', 'important');
        });

        // .base 必须变成块
        container.querySelectorAll('.katex-display .base').forEach(base => {
            base.style.setProperty('display', 'block', 'important');
            base.style.setProperty('width', '100%', 'important');
            base.style.setProperty('white-space', 'normal', 'important');
            base.style.setProperty('word-break', 'break-all', 'important');
            base.style.setProperty('overflow-wrap', 'anywhere', 'important');
        });

        // 向上修正父容器 nowrap
        const parents = new Set();
        container.querySelectorAll('.katex-display, .katex').forEach(formula => {
            let p = formula.parentElement;
            while (p && p !== container && !p.classList.contains('detail-body')) {
                if (['P', 'LI', 'DIV', 'TD', 'TH', 'BLOCKQUOTE', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'SECTION'].includes(p.tagName)) {
                    parents.add(p);
                }
                p = p.parentElement;
            }
        });
        parents.forEach(p => {
            p.style.setProperty('white-space', 'normal', 'important');
            p.style.setProperty('word-break', 'break-all', 'important');
            p.style.setProperty('overflow-wrap', 'anywhere', 'important');
            p.style.setProperty('max-width', '100%', 'important');
        });

        // 容器溢出
        const body = container.closest('.detail-body') || container;
        body.style.setProperty('overflow', 'visible', 'important');
        body.style.setProperty('overflow-x', 'visible', 'important');
    }

    // ---------- 核心：一次性渲染容器 ----------
    async function renderContainer(container) {
        if (!container) return;
        // 等待 KaTeX 就绪
        await loadKatex();
        if (!window.renderMathInElement) return;

        // 预处理文本节点
        preprocessTextNodes(container);

        const originalHTML = container.innerHTML;
        let timedOut = false;

        const timer = setTimeout(() => {
            timedOut = true;
            container.innerHTML = originalHTML.replace(/\$/g, '');
            container.querySelectorAll('.katex,.katex-display').forEach(e => e.remove());
        }, RENDER_TIMEOUT);

        try {
            window.renderMathInElement(container, {
                delimiters: [
                    { left: '$$', right: '$$', display: true },
                    { left: '$', right: '$', display: false },
                    { left: '\\(', right: '\\)', display: false },
                    { left: '\\[', right: '\\]', display: true }
                ],
                throwOnError: false,
                ignoredClasses: ['question-slot'],
                strict: false
            });
            clearTimeout(timer);
            if (timedOut) throw new Error('Render timed out');
        } catch (e) {
            // 恢复原始内容（已去除公式标记）
            container.innerHTML = originalHTML.replace(/\$/g, '');
            return;
        }

        // 强制换行
        forceBreakAllKatex(container);
    }

    // ---------- 观察 DOM ----------
    function observe() {
        const target = document.querySelector('.detail-body');
        if (!target) {
            setTimeout(observe, 500);
            return;
        }

        // 初始渲染
        if (target.innerHTML.trim()) {
            renderContainer(target).catch(() => {
                target.innerHTML = (target.textContent || '').replace(/\$/g, '');
            });
        }

        // 后续变动防抖渲染
        let debounceTimer;
        const mo = new MutationObserver(() => {
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => {
                renderContainer(target).catch(() => { });
            }, 300);
        });
        mo.observe(target, { childList: true, subtree: true });
    }

    // ---------- resize 重新修补 ----------
    window.addEventListener('resize', () => {
        clearTimeout(window._katexResize);
        window._katexResize = setTimeout(() => {
            document.querySelectorAll('.detail-body').forEach(forceBreakAllKatex);
        }, 200);
    });

    // 全局 API
    window.katexLoader = {
        load: loadKatex,
        render: renderContainer,
        forceBreak: forceBreakAllKatex
    };

    // 自动启动
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => setTimeout(observe, 100));
    } else {
        setTimeout(observe, 100);
    }
})();