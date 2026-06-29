let blogData = [];

function getQueryParam(name) {
    const url = new URL(window.location.href);
    return url.searchParams.get(name);
}

function formatDate(dateStr) {
    const d = new Date(dateStr);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

async function loadData() {
    try {
        const res = await fetch('data/blogs.json');
        if (!res.ok) throw new Error('数据加载失败');
        blogData = await res.json();
    } catch (e) {
        console.error(e);
        blogData = [];
    }
}

async function loadMarkdownContent(relativePath) {
    try {
        const res = await fetch(`blogs/${relativePath}`);
        if (!res.ok) throw new Error('文件加载失败');
        return await res.text();
    } catch (e) {
        console.error('加载 Markdown 失败:', e);
        return '# 加载失败\n\n无法读取文章内容，请稍后重试。';
    }
}

function renderMarkdown(markdown) {
    if (typeof marked !== 'undefined') {
        return marked.parse(markdown);
    }
    return `<pre>${markdown}</pre>`;
}

/**
 * 解析 Markdown，为每个 h1 标题提取侧边栏内容
 * 规则：每个 h1 标题下的两个 "---" 之间的内容作为该 h1 的侧边栏
 * 返回 [{ h1: '标题内容', mainContent: '正文', sidebarContent: '侧边栏' }]
 */
function parseMarkdownWithSidebar(markdown) {
    const lines = markdown.split('\n');
    const sections = [];
    let currentSection = null;
    let i = 0;

    while (i < lines.length) {
        const trimmed = lines[i].trim();

        // 找到 h1 标题
        if (trimmed.startsWith('# ')) {
            // 保存之前的 section
            if (currentSection) {
                sections.push(currentSection);
            }

            // 创建新的 section
            currentSection = {
                h1: trimmed,
                mainContent: [],
                sidebarContent: [],
                isCollectingMain: true,
                hasSeenFirstSep: false,
                hasSeenSecondSep: false
            };

            // h1 之后的内容开始收集到 main
            currentSection.isCollectingMain = true;
            i++;
            continue;
        }

        // 如果当前没有 section，跳过
        if (!currentSection) {
            i++;
            continue;
        }

        // 处理分割线
        if (trimmed === '---') {
            if (!currentSection.hasSeenFirstSep) {
                // 第一个分割线：开始收集侧边栏
                currentSection.hasSeenFirstSep = true;
                currentSection.isCollectingMain = false;
                i++;
                continue;
            } else if (!currentSection.hasSeenSecondSep) {
                // 第二个分割线：结束侧边栏，回到正文
                currentSection.hasSeenSecondSep = true;
                currentSection.isCollectingMain = true;
                i++;
                continue;
            } else {
                // 第三个及以后的分割线：当作普通内容
                if (currentSection.isCollectingMain) {
                    currentSection.mainContent.push(lines[i]);
                } else {
                    currentSection.sidebarContent.push(lines[i]);
                }
                i++;
                continue;
            }
        }

        // 收集内容
        if (currentSection.isCollectingMain) {
            currentSection.mainContent.push(lines[i]);
        } else {
            currentSection.sidebarContent.push(lines[i]);
        }

        i++;
    }

    // 保存最后一个 section
    if (currentSection) {
        sections.push(currentSection);
    }

    return sections;
}

/**
 * 渲染带有侧边栏的 Markdown
 */
function renderMarkdownWithSidebar(markdown, isDesktop) {
    if (!isDesktop) {
        // 手机端：直接渲染全部内容（移除所有 ---）
        const cleaned = markdown.replace(/^---\s*$/gm, '');
        return renderMarkdown(cleaned);
    }

    // 电脑端：解析每个 h1 的侧边栏
    const sections = parseMarkdownWithSidebar(markdown);

    if (sections.length === 0) {
        return renderMarkdown(markdown);
    }

    let html = '';

    sections.forEach(section => {
        const mainMd = section.mainContent.join('\n').trim();
        const sidebarMd = section.sidebarContent.join('\n').trim();

        // 如果侧边栏为空，直接渲染正文
        if (!sidebarMd) {
            html += renderMarkdown(section.h1 + '\n' + mainMd);
            return;
        }

        // 有侧边栏：两栏布局
        const mainHtml = renderMarkdown(section.h1 + '\n' + mainMd);
        const sidebarHtml = renderMarkdown(sidebarMd);

        html += `
            <div class="detail-section-two-column">
                <div class="detail-main-column">
                    ${mainHtml}
                </div>
                <div class="detail-sidebar-column">
                    ${sidebarHtml}
                </div>
            </div>
        `;
    });

    return html;
}

function buildTree(blogs) {
    const root = { children: [] };

    blogs.forEach(blog => {
        const parts = blog.path.split('/');
        const dirParts = parts.slice(1);
        const title = blog.title;

        let current = root;
        for (let i = 0; i < dirParts.length; i++) {
            const part = dirParts[i];
            if (i === dirParts.length - 1) {
                const existing = current.children.find(child => child.name === title && child.isFile);
                if (!existing) {
                    current.children.push({
                        name: title,
                        isFile: true,
                        blogId: blog.id,
                        date: blog.date,
                        series: blog.series
                    });
                }
            } else {
                let dirNode = current.children.find(child => child.name === part && !child.isFile);
                if (!dirNode) {
                    dirNode = {
                        name: part,
                        isFile: false,
                        children: []
                    };
                    current.children.push(dirNode);
                }
                current = dirNode;
            }
        }
    });

    function sortNode(node) {
        if (!node.children) return;
        node.children.sort((a, b) => {
            if (a.isFile !== b.isFile) {
                return a.isFile ? 1 : -1;
            }
            return a.name.localeCompare(b.name);
        });
        node.children.forEach(child => {
            if (!child.isFile) sortNode(child);
        });
    }
    sortNode(root);

    return root;
}

function renderTree(children, depth = 0) {
    if (!children || children.length === 0) return '';
    let html = '';
    children.forEach(node => {
        const indent = depth * 20;
        const padding = `padding-left: ${indent + 8}px;`;
        if (node.isFile) {
            html += `
                <div class="tree-item tree-file" style="${padding}" data-id="${node.blogId}">
                    <span class="file-icon"><i class="fas fa-file-alt"></i></span>
                    <span class="file-name">${node.name}</span>
                    <span class="file-arrow"><i class="fas fa-chevron-right"></i></span>
                </div>
            `;
        } else {
            const childHtml = renderTree(node.children, depth + 1);
            html += `
                <div class="tree-folder-wrapper" style="${padding}">
                    <div class="tree-item tree-folder" data-path="${node.name}">
                        <span class="folder-toggle"><i class="fas fa-chevron-right"></i></span>
                        <span class="folder-icon"><i class="fas fa-folder"></i></span>
                        <span class="folder-name">${node.name}</span>
                        <span class="folder-count">(${node.children.filter(c => c.isFile).length})</span>
                    </div>
                    <div class="tree-children" style="display: none; padding-left: 20px;">
                        ${childHtml}
                    </div>
                </div>
            `;
        }
    });
    return html;
}

async function initCategory() {
    await loadData();
    const subject = getQueryParam('subject');
    const container = document.querySelector('.category-container');
    if (!subject) {
        container.innerHTML = `<div class="empty-tip">请从首页选择科目。<br><a href="index.html" style="color: var(--blue-dark);">返回首页</a></div>`;
        return;
    }

    const blogs = blogData.filter(b => b.series === subject).sort((a, b) => new Date(b.date) - new Date(a.date));

    document.querySelector('.subject-title').innerHTML = `${subject} <span class="subject-badge">📂</span>`;
    document.querySelector('.post-count').textContent = `${blogs.length} 篇`;

    const listEl = document.querySelector('.blog-list');
    if (blogs.length === 0) {
        listEl.innerHTML = `<div class="empty-tip">该科目暂无文章。</div>`;
        return;
    }

    const tree = buildTree(blogs);
    const html = renderTree(tree.children, 0);
    listEl.innerHTML = html;

    listEl.addEventListener('click', function (e) {
        const folder = e.target.closest('.tree-folder');
        if (folder) {
            e.stopPropagation();
            const wrapper = folder.closest('.tree-folder-wrapper');
            if (!wrapper) return;
            const childrenContainer = wrapper.querySelector('.tree-children');
            if (!childrenContainer) return;

            const isHidden = childrenContainer.style.display === 'none';
            childrenContainer.style.display = isHidden ? 'block' : 'none';

            const toggleIcon = folder.querySelector('.folder-toggle i');
            if (toggleIcon) {
                toggleIcon.className = isHidden ? 'fas fa-chevron-down' : 'fas fa-chevron-right';
            }
            return;
        }

        const file = e.target.closest('.tree-file');
        if (file) {
            const id = file.dataset.id;
            if (id) {
                window.location.href = `detail.html?id=${id}`;
            }
        }
    });
}

async function initDetail() {
    await loadData();
    const idStr = getQueryParam('id');
    const container = document.querySelector('.detail-container');
    if (!idStr) {
        container.innerHTML = `<div class="empty-tip">文章不存在。<br><a href="index.html" style="color: var(--blue-dark);">返回首页</a></div>`;
        return;
    }
    const id = parseInt(idStr, 10);
    const blog = blogData.find(b => b.id === id);
    if (!blog) {
        container.innerHTML = `<div class="empty-tip">文章未找到。<br><a href="index.html" style="color: var(--blue-dark);">返回首页</a></div>`;
        return;
    }

    const content = await loadMarkdownContent(blog.path);

    document.querySelector('.detail-title').textContent = blog.title;
    document.querySelector('.detail-meta').innerHTML = `
        <span class="series-badge">📂 ${blog.series}</span>
        ${blog.path ? `<span class="path-badge">📁 ${blog.path.replace(/\\/g, '/')}</span>` : ''}
    `;

    const isDesktop = window.innerWidth >= 1024;
    document.querySelector('.detail-body').innerHTML = renderMarkdownWithSidebar(content, isDesktop);
}

document.addEventListener('DOMContentLoaded', function () {
    const path = window.location.pathname;
    if (path.includes('category.html')) {
        initCategory();
    } else if (path.includes('detail.html')) {
        initDetail();
    }
});

let resizeTimer;
window.addEventListener('resize', function () {
    if (window.location.pathname.includes('detail.html')) {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => {
            initDetail();
        }, 300);
    }
});