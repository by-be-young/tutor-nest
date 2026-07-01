// js/main.js (修改版)
import { supabase } from './supabase-client.js';
import { getCurrentUser, hasPermission, getPermissionIds } from './auth.js';

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

// 构建树（与之前一致）
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
                    dirNode = { name: part, isFile: false, children: [] };
                    current.children.push(dirNode);
                }
                current = dirNode;
            }
        }
    });
    function sortNode(node) {
        if (!node.children) return;
        node.children.sort((a, b) => {
            if (a.isFile !== b.isFile) return a.isFile ? 1 : -1;
            return a.name.localeCompare(b.name);
        });
        node.children.forEach(child => { if (!child.isFile) sortNode(child); });
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

// 分类页初始化（增加权限过滤）
async function initCategory() {
    // 检查登录状态
    const user = getCurrentUser();
    if (!user) {
        document.querySelector('.category-container').innerHTML = `
            <div class="empty-tip">
                请先 <a href="index.html" style="color: var(--teal-dark);">登录</a> 后查看。
            </div>
        `;
        return;
    }

    await loadData();
    const subject = getQueryParam('subject');
    const container = document.querySelector('.category-container');
    if (!subject) {
        container.innerHTML = `<div class="empty-tip">请从首页选择科目。<br><a href="index.html" style="color: var(--teal-dark);">返回首页</a></div>`;
        return;
    }

    // 获取该科目下所有文章
    let blogs = blogData.filter(b => b.series === subject);
    // 根据当前用户的权限过滤
    const permissionIds = getPermissionIds().map(Number).filter(Number.isFinite);
    blogs = blogs.filter(b => permissionIds.includes(Number(b.id)));

    if (blogs.length === 0) {
        container.innerHTML = `<div class="empty-tip">您没有权限查看该科目的任何文章。<br><a href="index.html" style="color: var(--teal-dark);">返回首页</a></div>`;
        return;
    }

    document.querySelector('.subject-title').innerHTML = `${subject} <span class="subject-badge">📂</span>`;
    document.querySelector('.post-count').textContent = `${blogs.length} 篇`;

    const listEl = document.querySelector('.blog-list');
    const tree = buildTree(blogs);
    const html = renderTree(tree.children, 0);
    listEl.innerHTML = html;

    // 事件绑定（与之前一致）
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

// 详情页初始化（增加权限检查）
async function initDetail() {
    const user = getCurrentUser();
    if (!user) {
        document.querySelector('.detail-container').innerHTML = `
            <div class="empty-tip">
                请先 <a href="index.html" style="color: var(--teal-dark);">登录</a> 后查看。
            </div>
        `;
        return;
    }

    await loadData();
    const idStr = getQueryParam('id');
    const container = document.querySelector('.detail-container');
    if (!idStr) {
        container.innerHTML = `<div class="empty-tip">文章不存在。<br><a href="index.html" style="color: var(--teal-dark);">返回首页</a></div>`;
        return;
    }
    const id = parseInt(idStr, 10);
    const blog = blogData.find(b => b.id === id);
    if (!blog) {
        container.innerHTML = `<div class="empty-tip">文章未找到。<br><a href="index.html" style="color: var(--teal-dark);">返回首页</a></div>`;
        return;
    }

    // 权限检查
    if (!hasPermission(id)) {
        container.innerHTML = `<div class="empty-tip">您没有权限查看此文章。<br><a href="index.html" style="color: var(--teal-dark);">返回首页</a></div>`;
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

// 侧边栏渲染（与之前相同）
function parseMarkdownWithSidebar(markdown) {
    const lines = markdown.split('\n');
    const sections = [];
    let currentSection = null;
    let i = 0;
    while (i < lines.length) {
        const trimmed = lines[i].trim();
        if (trimmed.startsWith('# ')) {
            if (currentSection) sections.push(currentSection);
            currentSection = {
                h1: trimmed,
                mainContent: [],
                sidebarContent: [],
                isCollectingMain: true,
                hasSeenFirstSep: false,
                hasSeenSecondSep: false
            };
            currentSection.isCollectingMain = true;
            i++;
            continue;
        }
        if (!currentSection) { i++; continue; }
        if (trimmed === '---') {
            if (!currentSection.hasSeenFirstSep) {
                currentSection.hasSeenFirstSep = true;
                currentSection.isCollectingMain = false;
                i++;
                continue;
            } else if (!currentSection.hasSeenSecondSep) {
                currentSection.hasSeenSecondSep = true;
                currentSection.isCollectingMain = true;
                i++;
                continue;
            } else {
                if (currentSection.isCollectingMain) {
                    currentSection.mainContent.push(lines[i]);
                } else {
                    currentSection.sidebarContent.push(lines[i]);
                }
                i++;
                continue;
            }
        }
        if (currentSection.isCollectingMain) {
            currentSection.mainContent.push(lines[i]);
        } else {
            currentSection.sidebarContent.push(lines[i]);
        }
        i++;
    }
    if (currentSection) sections.push(currentSection);
    return sections;
}

function renderMarkdownWithSidebar(markdown, isDesktop) {
    if (!isDesktop) {
        const cleaned = markdown.replace(/^---\s*$/gm, '');
        return renderMarkdown(cleaned);
    }
    const sections = parseMarkdownWithSidebar(markdown);
    if (sections.length === 0) return renderMarkdown(markdown);
    let html = '';
    sections.forEach(section => {
        const mainMd = section.mainContent.join('\n').trim();
        const sidebarMd = section.sidebarContent.join('\n').trim();
        if (!sidebarMd) {
            html += renderMarkdown(section.h1 + '\n' + mainMd);
            return;
        }
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

// 页面初始化路由
document.addEventListener('DOMContentLoaded', function () {
    const path = window.location.pathname;
    if (path.includes('category.html')) {
        initCategory();
    } else if (path.includes('detail.html')) {
        initDetail();
    }
    // 其他页面（如 index.html）独立处理
});

// 窗口resize重新加载详情（可选）
let resizeTimer;
window.addEventListener('resize', function () {
    if (window.location.pathname.includes('detail.html')) {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => { initDetail(); }, 300);
    }
});