/**
 * katex-loader.js - 超长公式强制换行（纯 JS 内联样式覆盖版）
 * 彻底解决 CSS 被覆盖的问题
 */
(function () {
    'use strict';

    const KATEX_CSS = 'https://cdn.bootcdn.net/ajax/libs/KaTeX/0.16.9/katex.min.css';
    const KATEX_JS = 'https://cdn.bootcdn.net/ajax/libs/KaTeX/0.16.9/katex.min.js';
    const AUTORENDER_JS = 'https://cdn.bootcdn.net/ajax/libs/KaTeX/0.16.9/contrib/auto-render.min.js';
    const RENDER_TIMEOUT = 8000;

    let isLoaded = false, loadPromise = null;

    // ---------- 加载 ----------
    function loadCSS(href) {
        if (document.querySelector(`link[href="${href}"]`)) return;
        const link = document.createElement('link');
        link.rel = 'stylesheet'; link.href = href;
        document.head.appendChild(link);
    }
    function loadScript(src) {
        return new Promise((resolve, reject) => {
            const exist = document.querySelector(`script[src="${src}"]`);
            if (exist) {
                exist.dataset.loaded === 'true' ? resolve() :
                    (exist.addEventListener('load', resolve), exist.addEventListener('error', reject));
                return;
            }
            const s = document.createElement('script');
            s.src = src; s.async = true;
            s.onload = () => { s.dataset.loaded = 'true'; resolve(); };
            s.onerror = reject;
            document.head.appendChild(s);
        });
    }
    function loadKatex() {
        if (isLoaded) return Promise.resolve(window.katex);
        if (loadPromise) return loadPromise;
        loadCSS(KATEX_CSS);
        loadPromise = loadScript(KATEX_JS).then(() => loadScript(AUTORENDER_JS))
            .then(() => { isLoaded = true; return window.katex; })
            .catch(e => { loadPromise = null; throw e; });
        return loadPromise;
    }

    // ---------- 预处理 ----------
    function preprocessMathContent(text) {
        return (typeof text === 'string') ? text.replace(/\\cdotp/g, '\\cdot') : text || '';
    }
    function preprocessElementContent(el) {
        const clone = el.cloneNode(true);
        function walk(node) {
            if (node.nodeType === 3) { node.textContent = preprocessMathContent(node.textContent); return; }
            if (node.nodeType === 1) {
                const tag = node.tagName.toLowerCase();
                if (['code', 'pre', 'script', 'style'].includes(tag) || node.classList.contains('katex')) return;
                node.childNodes.forEach(walk);
            }
        }
        walk(clone);
        el.innerHTML = clone.innerHTML;
    }

    /**
 * 加强版：不仅修正 KaTeX 内部，还强制修正父容器的 nowrap
 */
    function forceBreakAllKatex(container) {
        if (!container) return;

        // ========== 1. 先处理所有 KaTeX 内部元素 ==========
        const allKatex = container.querySelectorAll('[class*="katex"]');
        allKatex.forEach(el => {
            // 清除可能的内联 nowrap，并强制设置换行
            if (el.style.whiteSpace === 'nowrap') el.style.whiteSpace = 'normal';
            el.style.setProperty('white-space', 'normal', 'important');
            el.style.setProperty('word-break', 'break-all', 'important');
            el.style.setProperty('overflow-wrap', 'anywhere', 'important');
            el.style.setProperty('max-width', '100%', 'important');
        });

        // .katex-display 设为块级，限制宽度
        const displays = container.querySelectorAll('.katex-display');
        displays.forEach(disp => {
            disp.style.setProperty('display', 'block', 'important');
            disp.style.setProperty('max-width', '100%', 'important');
            disp.style.setProperty('overflow', 'visible', 'important');
        });

        // 关键：.katex-display .base 必须变成 block + width:100%
        const bases = container.querySelectorAll('.katex-display .base');
        bases.forEach(base => {
            base.style.setProperty('display', 'block', 'important');
            base.style.setProperty('width', '100%', 'important');
            base.style.setProperty('max-width', '100%', 'important');
            base.style.setProperty('white-space', 'normal', 'important');
            base.style.setProperty('word-break', 'break-all', 'important');
            base.style.setProperty('overflow-wrap', 'anywhere', 'important');
        });

        // ========== 2. 向上追溯父容器，强制清除 nowrap ==========
        // 找到每个公式的最近父元素（p, li, div, td, th 等）
        const formulaParents = new Set();
        container.querySelectorAll('.katex-display, .katex').forEach(formula => {
            let parent = formula.parentElement;
            while (parent && parent !== container && !parent.classList.contains('detail-body')) {
                // 只处理常见的文本容器
                if (['P', 'LI', 'DIV', 'TD', 'TH', 'BLOCKQUOTE', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'SECTION'].includes(parent.tagName)) {
                    formulaParents.add(parent);
                }
                parent = parent.parentElement;
            }
        });

        formulaParents.forEach(parent => {
            // 移除 nowrap，允许换行
            parent.style.setProperty('white-space', 'normal', 'important');
            parent.style.setProperty('word-break', 'break-all', 'important');
            parent.style.setProperty('overflow-wrap', 'anywhere', 'important');
            // 限制最大宽度，防止被内容撑开
            parent.style.setProperty('max-width', '100%', 'important');
            // 若需要，也可以设置宽度
            parent.style.setProperty('width', '100%', 'important'); // 小心使用，可能破坏布局，但为了断行可以尝试
            // 确保 overflow 可见
            parent.style.setProperty('overflow', 'visible', 'important');
        });

        // ========== 3. 最终确保 .detail-body 不限制 ==========
        const body = container.closest('.detail-body') || container;
        body.style.setProperty('overflow', 'visible', 'important');
        body.style.setProperty('overflow-x', 'visible', 'important');
    }

    // ---------- 渲染器 ----------
    function renderMath(el) {
        if (!el) return;
        if (!window.renderMathInElement) {
            return loadKatex().then(() => renderMath(el)).catch(() => {
                el.innerHTML = (el.textContent || '').replace(/\$/g, '');
            });
        }
        const original = el.innerHTML;
        try {
            preprocessElementContent(el);
            let timedOut = false;
            const timer = setTimeout(() => {
                timedOut = true;
                el.innerHTML = original.replace(/\$/g, '');
                el.querySelectorAll('.katex, .katex-display').forEach(e => e.remove());
            }, RENDER_TIMEOUT);
            window.renderMathInElement(el, {
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
            if (timedOut && !el.innerHTML.trim()) el.innerHTML = original.replace(/\$/g, '');
        } catch (e) {
            el.innerHTML = (el.textContent || '').replace(/\$/g, '');
        }
        // 立即修补
        forceBreakAllKatex(el);
        // 再次修补，确保异步渲染覆盖
        setTimeout(() => forceBreakAllKatex(el), 100);
    }

    function renderInBatches(container, size = 3) {
        if (!container) return;
        const candidates = Array.from(container.querySelectorAll(
            'p,li,div:not(.question-slot):not(.katex):not(.katex-display),td,th,blockquote'
        )).filter(el => el.textContent && el.textContent.includes('$'));
        if (!candidates.length) {
            forceBreakAllKatex(container);  // 对已有公式也修补
            return;
        }
        let i = 0;
        function batch() {
            const end = Math.min(i + size, candidates.length);
            candidates.slice(i, end).forEach(el => { try { renderMath(el) } catch (e) { } });
            i = end;
            if (i < candidates.length) requestAnimationFrame(batch);
            else setTimeout(() => forceBreakAllKatex(container), 300);
        }
        requestAnimationFrame(batch);
    }

    // ---------- 观察者 ----------
    function observe() {
        const target = document.querySelector('.detail-body');
        if (!target) { setTimeout(observe, 500); return; }
        // 初始加载
        if (target.innerHTML.trim()) {
            loadKatex().then(() => renderInBatches(target)).catch(() => {
                target.innerHTML = (target.textContent || '').replace(/\$/g, '');
            });
        }
        const mo = new MutationObserver(() => {
            if (mo._rendering) return;
            mo._rendering = true;
            loadKatex().then(() => { renderInBatches(target); mo._rendering = false; })
                .catch(() => { mo._rendering = false; });
        });
        mo.observe(target, { childList: true, subtree: true });
    }

    // ---------- 窗口变化重新修补 ----------
    window.addEventListener('resize', () => {
        clearTimeout(window._katexResize);
        window._katexResize = setTimeout(() => {
            document.querySelectorAll('.detail-body').forEach(forceBreakAllKatex);
        }, 300);
    });

    // ---------- 全局 API ----------
    window.katexLoader = {
        load: loadKatex,
        render: renderMath,
        loadAndRender: el => loadKatex().then(() => renderMath(el)),
        renderInBatches,
        forceBreak: forceBreakAllKatex
    };

    // ---------- 自动初始化 ----------
    function autoInit() {
        // 不再注入 CSS，因为我们会用 JS 直接写内联样式，但保留 .detail-main-column overflow:hidden 的原始规则（如果有的话）
        // 如果页面原本有 .detail-main-column { overflow: hidden; } 不需改动，因为我们保证了内部公式已换行不会超出。
        setTimeout(observe, 100);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', autoInit);
    } else {
        autoInit();
    }

})();