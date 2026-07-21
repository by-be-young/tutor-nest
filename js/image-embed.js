/**
 * image-embed.js - Markdown 图片嵌入解析器
 * 
 * 功能：
 *   1. 解析 Markdown 中的 ![[图片文件名]] 语法
 *   2. 将图片路径映射到 blogs/图片/ 目录
 *   3. 支持图片尺寸指定：![[图片文件名|宽度x高度]]
 *   4. 支持图片对齐：![[图片文件名|left]] / ![[图片文件名|center]] / ![[图片文件名|right]]
 *   5. 支持图片标题：![[图片文件名|标题文字]]
 * 
 * 语法示例：
 *   ![[image.png]]                    → 基础图片
 *   ![[image.png|300x200]]            → 指定尺寸
 *   ![[image.png|center]]             → 居中
 *   ![[image.png|300x200|center]]     → 指定尺寸并居中
 *   ![[image.png|图片标题]]           → 带标题
 *   ![[image.png|300x200|center|图片标题]] → 完整语法
 * 
 * 依赖：
 *   无外部依赖，纯原生 JavaScript
 */

(function () {
    'use strict';

    // ================================================================
    // 一、配置
    // ================================================================

    /** 图片存储的基础路径（相对于 HTML 文件） */
    const IMAGE_BASE_PATH = 'blogs/图片/';

    /** 默认图片宽度（当未指定时） */
    const DEFAULT_WIDTH = 'auto';

    /** 默认图片高度（当未指定时） */
    const DEFAULT_HEIGHT = 'auto';

    /** 是否启用懒加载 */
    const ENABLE_LAZY_LOAD = true;

    /** 图片加载失败时的占位图（可选） */
    const PLACEHOLDER_IMAGE = null; // 例如: 'data:image/svg+xml,...'

    // ================================================================
    // 二、核心解析函数
    // ================================================================

    /**
     * 解析图片嵌入语法 ![[filename|options]]
     * 
     * @param {string} text - 包含图片语法的文本
     * @returns {string} 替换为 HTML img 标签后的文本
     */
    function parseImageEmbeds(text) {
        if (!text || typeof text !== 'string') {
            return text || '';
        }

        // 正则匹配 ![[...]] 语法
        // 匹配：![[ 内容 ]]，内容中允许包含 | 分隔的选项
        const regex = /!\[\[([^\]]+)\]\]/g;

        return text.replace(regex, function (match, content) {
            // 解析内容
            const parsed = parseImageOptions(content);

            // 生成 HTML
            return generateImageHTML(parsed);
        });
    }

    /**
     * 解析图片选项字符串
     * 
     * @param {string} content - 方括号内的内容，如 "image.png|300x200|center|标题"
     * @returns {Object} 解析后的选项对象
     */
    function parseImageOptions(content) {
        // 按 | 分割选项
        const parts = content.split('|').map(s => s.trim()).filter(s => s !== '');

        // 结果对象
        const result = {
            filename: parts[0] || '',           // 文件名
            width: null,                        // 宽度
            height: null,                       // 高度
            align: null,                        // 对齐方式: left | center | right
            title: null,                        // 标题（alt 属性）
            caption: null,                      // 图注（显示在图片下方）
            lazy: ENABLE_LAZY_LOAD,             // 懒加载
            responsive: true,                   // 响应式
            rounded: false,                     // 圆角
            shadow: false                       // 阴影
        };

        if (parts.length === 0) {
            return result;
        }

        // 第一个是文件名
        result.filename = parts[0];

        // 处理剩余选项
        for (let i = 1; i < parts.length; i++) {
            const option = parts[i];

            // 检查是否为尺寸：数字x数字 或 数字 或 x数字
            const sizeMatch = option.match(/^(\d*)(?:x(\d+))?$/i);
            if (sizeMatch && (sizeMatch[1] || sizeMatch[2])) {
                // 尺寸格式：300x200 或 300 或 x200
                result.width = sizeMatch[1] || null;
                result.height = sizeMatch[2] || null;
                // 如果只有数字，视为宽度
                if (result.width && !result.height) {
                    result.height = result.width; // 正方形
                }
                // 如果只有 x200，视为高度，宽度自动
                if (!result.width && result.height) {
                    result.width = null;
                }
                continue;
            }

            // 检查是否为对齐方式
            const alignMatch = option.match(/^(left|center|right|inline)$/i);
            if (alignMatch) {
                result.align = alignMatch[1].toLowerCase();
                continue;
            }

            // 检查是否为布尔标志
            const boolMatch = option.match(/^(lazy|responsive|rounded|shadow)$/i);
            if (boolMatch) {
                const key = boolMatch[1].toLowerCase();
                result[key] = true;
                continue;
            }

            // 其他内容视为标题/图注
            if (!result.title) {
                result.title = option;
            } else {
                result.caption = option;
            }
        }

        return result;
    }

    /**
     * 生成图片 HTML
     * 
     * @param {Object} options - 图片选项
     * @param {string} options.filename - 文件名
     * @param {string} options.width - 宽度
     * @param {string} options.height - 高度
     * @param {string} options.align - 对齐方式
     * @param {string} options.title - 标题
     * @param {string} options.caption - 图注
     * @param {boolean} options.lazy - 是否懒加载
     * @param {boolean} options.responsive - 是否响应式
     * @param {boolean} options.rounded - 是否圆角
     * @param {boolean} options.shadow - 是否有阴影
     * @returns {string} HTML 字符串
     */
    function generateImageHTML(options) {
        const {
            filename = '',
            width = null,
            height = null,
            align = null,
            title = '',
            caption = '',
            lazy = ENABLE_LAZY_LOAD,
            responsive = true,
            rounded = false,
            shadow = false
        } = options;

        // 如果没有文件名，返回空
        if (!filename) {
            return '';
        }

        // 构建图片路径
        const imagePath = IMAGE_BASE_PATH + filename;

        // 构建 img 标签属性 - 使用 let 而不是 const
        let attributes = [];

        // src 属性（必需）
        attributes.push(`src="${escapeHtml(imagePath)}"`);

        // alt 属性（标题）
        const altText = title || filename.replace(/\.[^.]+$/, '');
        attributes.push(`alt="${escapeHtml(altText)}"`);

        // title 属性（鼠标悬停提示）
        if (title) {
            attributes.push(`title="${escapeHtml(title)}"`);
        }

        // 宽度属性
        if (width && width !== 'auto') {
            attributes.push(`width="${escapeHtml(width)}"`);
        }

        // 高度属性
        if (height && height !== 'auto') {
            attributes.push(`height="${escapeHtml(height)}"`);
        }

        // 懒加载
        if (lazy) {
            attributes.push('loading="lazy"');
        }

        // 收集所有样式
        const styles = [];

        // 响应式
        if (responsive) {
            styles.push('max-width: 100%');
            styles.push('height: auto');
        }

        // 圆角
        if (rounded) {
            styles.push('border-radius: 8px');
        }

        // 阴影
        if (shadow) {
            styles.push('box-shadow: 0 2px 8px rgba(0,0,0,0.15)');
        }

        // 如果有样式，添加到属性中
        if (styles.length > 0) {
            attributes.push(`style="${styles.join('; ')}"`);
        }

        // 对齐类名
        let alignClass = '';
        if (align && align !== 'inline') {
            alignClass = `image-align-${align}`;
        }

        // 构建完整的 HTML
        let html = '';

        // 如果有图注，使用 figure 包装
        if (caption) {
            html += `<figure class="image-figure ${alignClass}">`;
            html += `<img ${attributes.join(' ')} />`;
            html += `<figcaption class="image-caption">${escapeHtml(caption)}</figcaption>`;
            html += `</figure>`;
        } else {
            // 简单图片
            html += `<span class="image-wrapper ${alignClass}">`;
            html += `<img ${attributes.join(' ')} />`;
            html += `</span>`;
        }

        return html;
    }

    // ================================================================
    // 三、HTML 工具函数
    // ================================================================

    /**
     * HTML 转义，防止 XSS 攻击
     * 
     * @param {string} text - 要转义的文本
     * @returns {string} 转义后的文本
     */
    function escapeHtml(text) {
        if (!text) return '';
        const map = {
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#039;'
        };
        return String(text).replace(/[&<>"']/g, function (m) {
            return map[m];
        });
    }

    // ================================================================
    // 四、DOM 操作函数
    // ================================================================

    /**
     * 在 DOM 元素中解析图片嵌入
     * 
     * @param {HTMLElement} element - 包含图片语法的 DOM 元素
     * @returns {void}
     */
    function parseImageEmbedsInElement(element) {
        if (!element) {
            console.warn('parseImageEmbedsInElement: 元素不存在');
            return;
        }

        // 遍历所有文本节点
        function walkTextNodes(node) {
            if (node.nodeType === Node.TEXT_NODE) {
                // 检查是否包含 ![[
                if (node.textContent.includes('! [[') || node.textContent.includes('![[')) {
                    const parent = node.parentNode;
                    const processed = parseImageEmbeds(node.textContent);

                    // 如果内容发生了变化，替换节点
                    if (processed !== node.textContent) {
                        const temp = document.createElement('div');
                        temp.innerHTML = processed;

                        // 将处理后的节点插入
                        while (temp.firstChild) {
                            parent.insertBefore(temp.firstChild, node);
                        }
                        parent.removeChild(node);
                    }
                }
                return;
            }

            if (node.nodeType === Node.ELEMENT_NODE) {
                // 跳过不需要处理的元素
                const skipTags = ['code', 'pre', 'script', 'style', 'img', 'figure'];
                const tagName = node.tagName.toLowerCase();
                if (skipTags.includes(tagName)) {
                    return;
                }

                // 递归处理子节点
                // 使用 childNodes 的副本，避免遍历过程中修改
                const children = Array.from(node.childNodes);
                children.forEach(child => walkTextNodes(child));
            }
        }

        walkTextNodes(element);
    }

    // ================================================================
    // 五、样式注入
    // ================================================================

    /**
     * 注入图片样式
     */
    function injectImageStyles() {
        const styleId = 'image-embed-styles';

        // 避免重复注入
        if (document.getElementById(styleId)) {
            return;
        }

        const styles = `
            /* 图片嵌入样式 */
            
            /* 图片包装容器 */
            .image-wrapper {
                display: inline-block;
                margin: 0.5em 0;
                max-width: 100%;
            }
            
            /* 图片对齐 */
            .image-align-left {
                float: left;
                margin-right: 1em;
                margin-bottom: 0.5em;
                max-width: 50%;
            }
            
            .image-align-right {
                float: right;
                margin-left: 1em;
                margin-bottom: 0.5em;
                max-width: 50%;
            }
            
            .image-align-center {
                display: block;
                text-align: center;
                margin-left: auto;
                margin-right: auto;
                max-width: 80%;
            }
            
            /* 图片 Figure 容器 */
            .image-figure {
                display: block;
                margin: 1em 0;
                text-align: center;
            }
            
            .image-figure.image-align-left {
                float: left;
                margin-right: 1em;
                max-width: 50%;
            }
            
            .image-figure.image-align-right {
                float: right;
                margin-left: 1em;
                max-width: 50%;
            }
            
            .image-figure img {
                display: block;
                margin: 0 auto;
                max-width: 100%;
                height: auto;
            }
            
            /* 图注样式 */
            .image-caption {
                display: block;
                margin-top: 0.5em;
                font-size: 0.9em;
                color: #666;
                text-align: center;
            }
            
            /* 图片本身样式 */
            .image-wrapper img,
            .image-figure img {
                max-width: 100%;
                height: auto;
                border-radius: 4px;
            }
            
            /* 响应式：小屏幕取消浮动 */
            @media (max-width: 640px) {
                .image-align-left,
                .image-align-right,
                .image-figure.image-align-left,
                .image-figure.image-align-right {
                    float: none;
                    display: block;
                    margin-left: auto;
                    margin-right: auto;
                    max-width: 80%;
                }
            }
            
            /* 图片加载动画 */
            .image-wrapper img[loading="lazy"],
            .image-figure img[loading="lazy"] {
                opacity: 0;
                transition: opacity 0.3s ease;
            }
            
            .image-wrapper img[loading="lazy"]:not([src=""]),
            .image-figure img[loading="lazy"]:not([src=""]) {
                opacity: 1;
            }
        `;

        const styleEl = document.createElement('style');
        styleEl.id = styleId;
        styleEl.textContent = styles;
        document.head.appendChild(styleEl);
    }

    // ================================================================
    // 六、观察者模式：自动监听 DOM 变化
    // ================================================================

    /**
     * 观察目标元素，自动解析新增的图片嵌入
     * 
     * @param {HTMLElement} target - 要观察的目标元素
     * @param {string} selector - 观察器的目标选择器（可选）
     */
    function observeImageEmbeds(target, selector = '.detail-body, .post-content, .markdown-body') {
        if (!target) {
            // 如果没有指定目标，查找默认选择器
            const defaultTarget = document.querySelector(selector);
            if (!defaultTarget) {
                // 如果目标还未加载，延迟重试
                setTimeout(() => observeImageEmbeds(null, selector), 500);
                return;
            }
            target = defaultTarget;
        }

        // 如果已有内容，立即解析
        if (target.innerHTML.trim() !== '') {
            parseImageEmbedsInElement(target);
        }

        // 创建观察器，监听内容变化
        const observer = new MutationObserver(() => {
            if (observer._processing) {
                return;
            }
            observer._processing = true;

            // 使用 requestAnimationFrame 让出主线程
            requestAnimationFrame(() => {
                parseImageEmbedsInElement(target);
                observer._processing = false;
            });
        });

        // 配置观察选项
        observer.observe(target, {
            childList: true,    // 监听子节点的添加/删除
            subtree: true,      // 监听所有后代节点
            characterData: true // 监听文本内容变化
        });

        // 保存观察器引用
        target._imageObserver = observer;
    }

    // ================================================================
    // 七、暴露公共 API
    // ================================================================

    /**
     * 暴露全局 API
     * 
     * 使用方法：
     *   window.imageEmbed.parse(text)        // 解析字符串中的图片嵌入
     *   window.imageEmbed.parseElement(el)   // 解析 DOM 元素中的图片嵌入
     *   window.imageEmbed.observe(selector)  // 自动观察并解析
     *   window.imageEmbed.setBasePath(path)  // 设置图片基础路径
     */
    window.imageEmbed = {
        /**
         * 解析字符串中的图片嵌入语法
         * 
         * @param {string} text - 包含图片语法的文本
         * @returns {string} 替换后的 HTML
         */
        parse: parseImageEmbeds,

        /**
         * 解析 DOM 元素中的图片嵌入语法
         * 
         * @param {HTMLElement} element - 要解析的 DOM 元素
         * @returns {void}
         */
        parseElement: parseImageEmbedsInElement,

        /**
         * 自动观察并解析图片嵌入
         * 
         * @param {string|HTMLElement} target - 目标元素或选择器
         * @returns {void}
         */
        observe: observeImageEmbeds,

        /**
         * 设置图片基础路径
         * 
         * @param {string} path - 图片存储路径（如 'blogs/images/'）
         * @returns {void}
         */
        setBasePath: function (path) {
            // 由于 IMAGE_BASE_PATH 是 const，无法直接修改
            // 建议直接修改源文件中的 IMAGE_BASE_PATH 变量
            console.warn('请直接修改 image-embed.js 中的 IMAGE_BASE_PATH 变量');
            console.info('当前路径:', IMAGE_BASE_PATH);
        },

        /**
         * 获取当前图片基础路径
         * 
         * @returns {string} 图片基础路径
         */
        getBasePath: function () {
            return IMAGE_BASE_PATH;
        },

        /**
         * 注入样式
         * 
         * @returns {void}
         */
        injectStyles: injectImageStyles
    };

    // ================================================================
    // 八、自动初始化
    // ================================================================

    /**
     * 页面加载完成后自动初始化
     */
    function autoInit() {
        // 注入样式
        injectImageStyles();

        // 自动观察 .detail-body 元素
        observeImageEmbeds(null, '.detail-body');

        // 如果 Markdown 内容在 .post-content 中，也进行观察
        observeImageEmbeds(null, '.post-content');
        observeImageEmbeds(null, '.markdown-body');
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', autoInit);
    } else {
        autoInit();
    }

    // ================================================================
    // 九、导出（ES Module 兼容）
    // ================================================================

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = {
            parseImageEmbeds,
            parseImageEmbedsInElement,
            observeImageEmbeds,
            injectImageStyles
        };
    }

})();