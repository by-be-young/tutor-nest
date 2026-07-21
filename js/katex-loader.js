/**
 * katex-loader.js - 公式滚动终极修复版（纯 JS 强制）
 * 
 * 核心策略：
 * 1. 用 JS 强制所有父容器 overflow: visible
 * 2. 公式强制不换行
 * 3. 创建滚动容器并强制滚动生效
 * 4. 支持鼠标滚轮、拖拽、触摸
 */

(function () {
    'use strict';

    // ================================================================
    // 一、CDN 资源地址配置
    // ================================================================

    const KATEX_CSS = 'https://cdn.bootcdn.net/ajax/libs/KaTeX/0.16.9/katex.min.css';
    const KATEX_JS = 'https://cdn.bootcdn.net/ajax/libs/KaTeX/0.16.9/katex.min.js';
    const AUTORENDER_JS = 'https://cdn.bootcdn.net/ajax/libs/KaTeX/0.16.9/contrib/auto-render.min.js';

    const RENDER_TIMEOUT = 8000;
    let isLoaded = false;
    let loadPromise = null;

    // ================================================================
    // 二、资源加载
    // ================================================================

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
        if (isLoaded) return Promise.resolve(window.katex);
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

    // ================================================================
    // 三、公式预处理
    // ================================================================

    function preprocessMathContent(text) {
        if (!text || typeof text !== 'string') return text || '';
        let result = text.replace(/\\cdotp/g, '\\cdot');
        result = result.replace(/(\\text\{[^}]*?)\\cdotp/g, '$1\\cdot');
        return result;
    }

    function preprocessElementContent(element) {
        const clone = element.cloneNode(true);

        function walkTextNodes(node) {
            if (node.nodeType === Node.TEXT_NODE) {
                node.textContent = preprocessMathContent(node.textContent);
                return;
            }
            if (node.nodeType === Node.ELEMENT_NODE) {
                const skipTags = ['code', 'pre', 'script', 'style', 'katex'];
                if (skipTags.includes(node.tagName.toLowerCase()) ||
                    node.classList.contains('katex')) {
                    return;
                }
                node.childNodes.forEach(child => walkTextNodes(child));
            }
        }

        walkTextNodes(clone);
        element.innerHTML = clone.innerHTML;
    }

    // ================================================================
    // 四、获取主栏宽度
    // ================================================================

    function getMainColumnWidth(element) {
        if (!element) return window.innerWidth - 40;

        // 查找 detail-main-column
        let container = element.closest('.detail-main-column');
        if (container) {
            const rect = container.getBoundingClientRect();
            if (rect.width > 0) return rect.width - 16;
        }

        // 查找 detail-section-two-column
        container = element.closest('.detail-section-two-column');
        if (container) {
            const mc = container.querySelector('.detail-main-column');
            if (mc) {
                const rect = mc.getBoundingClientRect();
                if (rect.width > 0) return rect.width - 16;
            }
        }

        // 查找 detail-body
        container = element.closest('.detail-body');
        if (container) {
            const rect = container.getBoundingClientRect();
            if (rect.width > 0) return rect.width - 32;
        }

        return window.innerWidth - 40;
    }

    // ================================================================
    // 五、强制修复所有父容器（纯 JS 强制）
    // ================================================================

    function forceFixContainers(container) {
        if (!container) return;

        // 修复所有可能阻止滚动的父元素
        // 注意：不去修改 .detail-main-column（保持 overflow:hidden 以防止公式溢出）
        // 也不去修改 .detail-section-two-column（防止破坏侧栏 position:sticky）
        const elementsToFix = container.querySelectorAll(
            '.detail-body, .detail-container'
        );

        elementsToFix.forEach(el => {
            el.style.overflow = 'visible';
            el.style.overflowX = 'visible';
            el.style.overflowY = 'visible';
            el.style.maxWidth = '100%';
        });

        // 也修复 container 本身
        container.style.overflow = 'visible';
        container.style.overflowX = 'visible';
        container.style.overflowY = 'visible';
    }

    // ================================================================
    // 六、创建滚动容器（核心）
    // ================================================================

    function wrapWithScrollContainer(element, maxWidth) {
        const parent = element.parentElement;

        // 如果已经是滚动容器
        if (parent.classList.contains('formula-scroll-wrapper')) {
            parent.style.maxWidth = maxWidth + 'px';
            parent.style.width = '100%';
            parent.style.overflowX = 'auto';
            parent.style.overflowY = 'hidden';
            return parent;
        }

        // 创建滚动容器
        const wrapper = document.createElement('div');
        wrapper.className = 'formula-scroll-wrapper';

        // 强制样式
        wrapper.style.cssText = `
            overflow-x: auto !important;
            overflow-y: hidden !important;
            padding: 6px 2px !important;
            margin: 4px 0 !important;
            max-width: ${maxWidth}px !important;
            width: 100% !important;
            min-width: 50px !important;
            -webkit-overflow-scrolling: touch !important;
            touch-action: pan-x !important;
            cursor: grab !important;
            display: block !important;
            scrollbar-width: thin !important;
            scrollbar-color: #ccc #f0f0f0 !important;
            min-height: 40px !important;
            background: transparent !important;
            border: none !important;
            outline: none !important;
            box-sizing: border-box !important;
        `;

        // 替换
        parent.replaceChild(wrapper, element);
        wrapper.appendChild(element);

        // ===== 确保滚动生效：强制触发重排 =====
        // 先设置 scrollLeft 为 0，然后读取 scrollWidth 触发重排
        wrapper.scrollLeft = 0;
        const hasScroll = wrapper.scrollWidth > wrapper.clientWidth + 2;

        if (hasScroll) {
            wrapper.classList.add('has-scroll');
        }

        // ===== 触控笔标记（通过 pointerdown 可靠检测，TouchEvent 无 pointerType） =====
        let _isPenInteraction = false;

        wrapper.addEventListener('pointerdown', function (e) {
            if (e.pointerType === 'pen') {
                _isPenInteraction = true;
                // 阻止触控笔继续传播事件
                e.preventDefault();
                e.stopPropagation();
                return;
            }
            // 手指/鼠标：清除标记
            _isPenInteraction = false;
        }, { passive: false, capture: true });

        wrapper.addEventListener('pointerup', function () {
            _isPenInteraction = false;
        });
        wrapper.addEventListener('pointercancel', function () {
            _isPenInteraction = false;
        });

        // ===== 滚轮支持（阻止触控笔） =====
        wrapper.addEventListener('wheel', function (e) {
            if (_isPenInteraction) return;
            if (wrapper.scrollWidth <= wrapper.clientWidth + 2) return;

            e.preventDefault();
            e.stopPropagation();

            const deltaX = e.deltaY || e.detail || 0;
            wrapper.scrollLeft += deltaX;
        }, { passive: false, capture: true });

        // ===== 鼠标拖拽（阻止触控笔） =====
        let isDragging = false;
        let startX = 0;
        let startScrollLeft = 0;

        wrapper.addEventListener('mousedown', function (e) {
            if (_isPenInteraction) return;
            if (e.button !== 0) return;
            if (wrapper.scrollWidth <= wrapper.clientWidth + 2) return;

            isDragging = true;
            startX = e.clientX;
            startScrollLeft = wrapper.scrollLeft;
            wrapper.style.cursor = 'grabbing';
            wrapper.style.userSelect = 'none';
            e.preventDefault();
        });

        document.addEventListener('mousemove', function (e) {
            if (!isDragging) return;
            const deltaX = startX - e.clientX;
            wrapper.scrollLeft = startScrollLeft + deltaX;
            e.preventDefault();
        });

        document.addEventListener('mouseup', function () {
            if (isDragging) {
                isDragging = false;
                wrapper.style.cursor = 'grab';
                wrapper.style.userSelect = '';
            }
        });

        // ===== 触摸支持（手指滑动，触控笔被标记拦截） =====
        let touchStartX = 0;
        let touchStartScrollLeft = 0;
        let isTouching = false;

        wrapper.addEventListener('touchstart', function (e) {
            if (_isPenInteraction) return;
            const touch = e.touches[0];
            if (!touch) return;
            if (wrapper.scrollWidth <= wrapper.clientWidth + 2) return;

            isTouching = true;
            touchStartX = touch.clientX;
            touchStartScrollLeft = wrapper.scrollLeft;
        }, { passive: true });

        wrapper.addEventListener('touchmove', function (e) {
            if (!isTouching || _isPenInteraction) return;

            const touch = e.touches[0];
            if (!touch) return;

            const deltaX = touchStartX - touch.clientX;
            wrapper.scrollLeft = touchStartScrollLeft + deltaX;
            e.preventDefault();
        }, { passive: false });

        wrapper.addEventListener('touchend', function () {
            isTouching = false;
        }, { passive: true });

        // ===== 键盘 =====
        wrapper.setAttribute('tabindex', '0');
        wrapper.addEventListener('keydown', function (e) {
            if (e.key === 'ArrowLeft') {
                wrapper.scrollLeft -= 50;
                e.preventDefault();
            } else if (e.key === 'ArrowRight') {
                wrapper.scrollLeft += 50;
                e.preventDefault();
            }
        });

        return wrapper;
    }

    // ================================================================
    // 七、处理超长公式
    // ================================================================

    function handleOverflowFormulas(container) {
        if (!container) return;

        // 1. 强制修复所有父容器
        forceFixContainers(container);

        // 2. 处理所有块级公式
        const formulas = container.querySelectorAll('.katex-display');

        formulas.forEach((formula) => {
            // 跳过已处理的
            if (formula.dataset.overflowHandled === 'true') return;

            // 强制公式不换行
            formula.style.whiteSpace = 'nowrap';
            formula.style.display = 'inline-block';
            formula.style.maxWidth = 'none';
            formula.style.overflow = 'visible';

            const katexEl = formula.querySelector('.katex');
            if (katexEl) {
                katexEl.style.whiteSpace = 'nowrap';
                katexEl.style.display = 'inline-block';
                katexEl.style.maxWidth = 'none';
                katexEl.style.overflow = 'visible';
            }

            // 获取可用宽度
            const maxWidth = getMainColumnWidth(formula);
            if (maxWidth <= 10) return;

            // 获取公式宽度
            const formulaWidth = formula.scrollWidth || formula.offsetWidth || 0;

            // 如果超出，包装为滚动容器
            if (formulaWidth > maxWidth - 6) {
                wrapWithScrollContainer(formula, maxWidth - 4);
                formula.dataset.overflowHandled = 'true';
            }
        });

        // 3. 处理行内公式
        const inlineFormulas = container.querySelectorAll('.katex:not(.katex-display)');
        inlineFormulas.forEach((formula) => {
            if (formula.dataset.overflowHandled === 'true') return;

            const maxWidth = getMainColumnWidth(formula);
            if (maxWidth <= 10) return;

            if (formula.scrollWidth > maxWidth - 20) {
                const parent = formula.parentElement;
                if (!parent.classList.contains('inline-formula-wrap')) {
                    const wrapper = document.createElement('span');
                    wrapper.className = 'inline-formula-wrap';
                    wrapper.style.cssText = `
                        display: inline-block !important;
                        max-width: ${maxWidth - 8}px !important;
                        overflow-x: auto !important;
                        overflow-y: hidden !important;
                        padding: 2px 0 !important;
                        vertical-align: middle !important;
                        scrollbar-width: thin !important;
                        -webkit-overflow-scrolling: touch !important;
                    `;
                    parent.replaceChild(wrapper, formula);
                    wrapper.appendChild(formula);
                    formula.dataset.overflowHandled = 'true';
                }
            }
        });
    }

    // ================================================================
    // 八、注入样式
    // ================================================================

    function injectFormulaStyles() {
        const styleId = 'katex-overflow-styles';
        if (document.getElementById(styleId)) return;

        const styles = `
            .detail-main-column {
                /* 左栏公式绝不能溢出到右栏，故隐藏主列溢出 */
                overflow: hidden !important;
                position: relative !important;
            }
            .detail-body {
                overflow: visible !important;
            }
            .detail-container {
                overflow: visible !important;
            }

            .detail-main-column .katex-display {
                display: inline-block !important;
                padding: 4px 2px !important;
                margin: 4px 0 !important;
                max-width: none !important;
                white-space: nowrap !important;
                overflow: visible !important;
            }
            
            .detail-main-column .katex-display .katex {
                display: inline-block !important;
                white-space: nowrap !important;
                overflow: visible !important;
            }
            
            .formula-scroll-wrapper {
                overflow-x: auto !important;
                overflow-y: hidden !important;
                padding: 6px 2px !important;
                margin: 4px 0 !important;
                max-width: 100% !important;
                width: 100% !important;
                -webkit-overflow-scrolling: touch !important;
                touch-action: pan-x !important;
                cursor: grab !important;
                display: block !important;
                scrollbar-width: thin !important;
                scrollbar-color: #ccc #f0f0f0 !important;
                min-height: 40px !important;
                background: transparent !important;
            }
            
            .formula-scroll-wrapper::-webkit-scrollbar {
                height: 5px !important;
            }
            .formula-scroll-wrapper::-webkit-scrollbar-track {
                background: #f0f0f0 !important;
                border-radius: 3px !important;
            }
            .formula-scroll-wrapper::-webkit-scrollbar-thumb {
                background: #ccc !important;
                border-radius: 3px !important;
            }
            .formula-scroll-wrapper::-webkit-scrollbar-thumb:hover {
                background: #999 !important;
            }
            
            .formula-scroll-wrapper.has-scroll::after {
                content: '↔ 滑动查看完整公式';
                display: block !important;
                text-align: center !important;
                font-size: 11px !important;
                color: #bbb !important;
                padding: 2px 0 0 !important;
                user-select: none !important;
                pointer-events: none !important;
            }
            
            @media (max-width: 767px) {
                .formula-scroll-wrapper.has-scroll::after {
                    font-size: 10px !important;
                }
                .formula-scroll-wrapper {
                    min-height: 36px !important;
                }
            }
            
            @media print {
                .formula-scroll-wrapper {
                    overflow: visible !important;
                    padding: 0 !important;
                }
                .formula-scroll-wrapper.has-scroll::after {
                    display: none !important;
                }
                .detail-main-column .katex-display {
                    white-space: normal !important;
                }
            }
        `;

        const styleEl = document.createElement('style');
        styleEl.id = styleId;
        styleEl.textContent = styles;
        document.head.appendChild(styleEl);
    }

    // ================================================================
    // 九、窗口变化
    // ================================================================

    let resizeTimeout = null;

    function handleResize() {
        clearTimeout(resizeTimeout);
        resizeTimeout = setTimeout(() => {
            const containers = document.querySelectorAll('.detail-body');
            containers.forEach(container => {
                container.querySelectorAll('.katex-display, .katex').forEach(el => {
                    el.dataset.overflowHandled = 'false';
                });
                container.querySelectorAll('.formula-scroll-wrapper').forEach(wrapper => {
                    const formula = wrapper.querySelector('.katex-display');
                    if (formula) {
                        const parent = wrapper.parentElement;
                        parent.replaceChild(formula, wrapper);
                        formula.dataset.overflowHandled = 'false';
                    }
                });
                handleOverflowFormulas(container);
            });
        }, 300);
    }

    // ================================================================
    // 十、渲染器
    // ================================================================

    function renderMath(element) {
        if (!element) {
            console.warn('renderMath: 元素不存在');
            return;
        }

        if (!window.renderMathInElement) {
            loadKatex()
                .then(() => renderMath(element))
                .catch(() => {
                    element.innerHTML = element.textContent || element.innerHTML;
                });
            return;
        }

        const originalContent = element.innerHTML;

        try {
            preprocessElementContent(element);

            let isTimeout = false;
            const timeoutId = setTimeout(() => {
                isTimeout = true;
                console.warn('KaTeX 渲染超时');
                element.innerHTML = originalContent.replace(/\$/g, '');
                element.querySelectorAll('.katex, .katex-display').forEach(el => el.remove());
            }, RENDER_TIMEOUT);

            window.renderMathInElement(element, {
                delimiters: [
                    { left: '$$', right: '$$', display: true },
                    { left: '$', right: '$', display: false },
                    { left: '\\(', right: '\\)', display: false },
                    { left: '\\[', right: '\\]', display: true }
                ],
                throwOnError: false,
                ignoredClasses: ['question-slot'],
                strict: false,
                errorCallback: function (msg, err) {
                    console.warn('KaTeX 公式渲染失败:', msg);
                    return msg;
                }
            });

            clearTimeout(timeoutId);

            if (isTimeout) {
                if (!element.innerHTML || element.innerHTML.trim() === '') {
                    element.innerHTML = originalContent.replace(/\$/g, '');
                }
            }

            setTimeout(() => {
                handleOverflowFormulas(element);
            }, 200);

        } catch (error) {
            console.warn('KaTeX 渲染出错:', error);
            if (element) {
                const textContent = element.textContent || originalContent;
                element.innerHTML = textContent.replace(/\$/g, '');
            }
        }
    }

    // ================================================================
    // 十一、批量渲染
    // ================================================================

    function renderMathInBatches(container, batchSize = 3) {
        if (!container) return;

        const candidates = container.querySelectorAll(
            'p, li, div:not(.question-slot):not(.katex):not(.katex-display), ' +
            'td, th, blockquote, .detail-main-column, .detail-sidebar-column'
        );

        const targets = Array.from(candidates).filter(el => {
            return el.textContent && el.textContent.includes('$');
        });

        if (targets.length === 0) return;

        let index = 0;

        function processBatch() {
            const end = Math.min(index + batchSize, targets.length);
            const batch = targets.slice(index, end);

            batch.forEach((el) => {
                try {
                    renderMath(el);
                } catch (e) {
                    console.warn('跳过有问题的公式块:', e);
                    if (el) {
                        el.innerHTML = el.textContent.replace(/\$/g, '');
                    }
                }
            });

            index = end;

            if (index < targets.length) {
                requestAnimationFrame(processBatch);
            } else {
                setTimeout(() => {
                    handleOverflowFormulas(container);
                }, 300);
            }
        }

        requestAnimationFrame(processBatch);
    }

    // ================================================================
    // 十二、观察者
    // ================================================================

    function observeDetailBody() {
        const target = document.querySelector('.detail-body');
        if (!target) {
            setTimeout(observeDetailBody, 500);
            return;
        }

        // 先强制修复父容器
        forceFixContainers(target);

        if (target.innerHTML.trim() !== '') {
            loadKatex()
                .then(() => {
                    renderMathInBatches(target);
                })
                .catch(() => {
                    target.innerHTML = target.textContent || target.innerHTML;
                });
        }

        const observer = new MutationObserver(() => {
            if (observer._rendering) return;
            observer._rendering = true;

            loadKatex()
                .then(() => {
                    renderMathInBatches(target);
                    observer._rendering = false;
                })
                .catch(() => {
                    observer._rendering = false;
                });
        });

        observer.observe(target, {
            childList: true,
            subtree: true
        });
    }

    // ================================================================
    // 十三、公共 API
    // ================================================================

    window.katexLoader = {
        load: loadKatex,
        render: renderMath,
        loadAndRender: function (element) {
            return loadKatex().then(() => renderMath(element));
        },
        renderInBatches: renderMathInBatches,
        handleOverflow: handleOverflowFormulas,
        forceFix: forceFixContainers
    };

    // ================================================================
    // 十四、初始化
    // ================================================================

    function autoInit() {
        injectFormulaStyles();

        // 立即修复所有容器
        setTimeout(() => {
            const containers = document.querySelectorAll('.detail-body');
            containers.forEach(container => {
                forceFixContainers(container);
            });
        }, 50);

        setTimeout(() => {
            observeDetailBody();
        }, 100);

        window.addEventListener('resize', handleResize);
        window.addEventListener('orientationchange', () => {
            setTimeout(handleResize, 500);
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', autoInit);
    } else {
        autoInit();
    }

    // ================================================================
    // 十五、导出
    // ================================================================

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = {
            loadKatex,
            renderMath,
            renderMathInBatches,
            handleOverflowFormulas,
            forceFixContainers
        };
    }

})();