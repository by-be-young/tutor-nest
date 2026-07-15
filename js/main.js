/**
 * main.js - 分类页与详情页逻辑
 * 职责：
 *   - 分类页：树状文章列表渲染与导航（含导航栏更新）
 *   - 详情页：Markdown 渲染、题目占位符注入、学生提交、教师批阅、答案设置
 *   - 导航栏统一管理
 */

import { supabase } from './supabase-client.js';
import { getCurrentUser, hasPermission, getPermissionIds, logout } from './auth.js';

// ---------- 常量 ----------
const DETAIL_MODES = new Set(['study', 'review', 'answer']);

// ---------- 全局状态 ----------
let blogData = [];
const detailState = {
    mode: 'study',
    blogId: null,
    studentId: null,
    questionCount: 0,
    questionIdList: [],
    answerKeyMap: new Map(),
    submissionMap: new Map(),
    slotNodes: new Map(),
    statusNodes: new Map(),
    submitButton: null,
    actionStatus: null,
    contentVersion: 0,
    _submitting: false
};

// ---------- Toast 弹窗 ----------
let toastTimer = null;
function showToast(message, type = 'info', duration = 3000) {
    const existing = document.querySelector('.custom-toast');
    if (existing) { existing.remove(); if (toastTimer) { clearTimeout(toastTimer); toastTimer = null; } }
    const toast = document.createElement('div');
    toast.className = `custom-toast toast-${type}`;
    toast.textContent = message;
    document.body.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add('toast-visible'));
    toastTimer = setTimeout(() => {
        toast.classList.remove('toast-visible');
        setTimeout(() => { if (toast.parentNode) toast.remove(); toastTimer = null; }, 300);
    }, duration);
}

// ---------- 工具函数 ----------
function getQueryParam(name) {
    return new URL(window.location.href).searchParams.get(name);
}
function escapeHtml(text) {
    return String(text ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}
function normalizeLineBreaks(text) {
    return String(text ?? '').replace(/\r\n/g, '\n');
}
function getDetailMode() {
    const mode = getQueryParam('mode');
    return DETAIL_MODES.has(mode) ? mode : 'study';
}

// ---------- 数据加载 ----------
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
    return typeof marked !== 'undefined' ? marked.parse(markdown) : `<pre>${markdown}</pre>`;
}

// ---------- 目录树构建（分类页用） ----------
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

/**
 * 获取文章题目数量（从 article_answer_keys 表查询）
 * @param {Array<number>} blogIds - 文章ID数组
 * @returns {Promise<Map<number, number>>} 返回 Map: blogId → 题目数量
 */
async function getQuestionCountsForBlogs(blogIds) {
    if (!blogIds || blogIds.length === 0) {
        return new Map();
    }

    const { data, error } = await supabase
        .from('article_answer_keys')
        .select('blog_id, question_id')
        .in('blog_id', blogIds);

    if (error) {
        console.error('获取文章题目数量失败:', error);
        return new Map();
    }

    // 统计每篇文章的题目数量
    const countMap = new Map();
    blogIds.forEach(id => countMap.set(id, 0));

    data.forEach(row => {
        const blogId = row.blog_id;
        const currentCount = countMap.get(blogId) || 0;
        countMap.set(blogId, currentCount + 1);
    });

    return countMap;
}

/**
 * 加载学生对文章提交状态
 * 逻辑：
 *   1. 从 article_answer_keys 表查询每篇文章的题目数量
 *   2. 如果文章没有题目，不算未提交（不显示红圈）
 *   3. 如果学生没有任何提交记录，且文章有题目 → 有未提交（显示红圈）
 *   4. 如果学生有提交记录，但存在 review_status != 'reviewed' 的题目 → 有未提交（显示红圈）
 *   5. 如果学生有提交记录，且所有题目均已批阅 → 无未提交（不显示红圈）
 */
async function loadSubmissionStatusForUsers(userId, blogIds) {
    if (!userId || !blogIds || blogIds.length === 0) {
        return new Map();
    }

    // 初始化结果集：所有文章默认没有未提交
    const resultMap = new Map();
    blogIds.forEach(id => resultMap.set(id, false));

    // 1. 从 article_answer_keys 表获取每篇文章的题目数量
    const questionCountMap = await getQuestionCountsForBlogs(blogIds);

    // 2. 检查哪些文章有题目
    const hasQuestions = new Map();
    blogIds.forEach(id => {
        const count = questionCountMap.get(id) || 0;
        hasQuestions.set(id, count > 0);
        // 如果文章没有题目，直接标记为无未提交
        if (!hasQuestions.get(id)) {
            resultMap.set(id, false);
        }
    });

    // 3. 查询学生的所有提交记录
    const { data, error } = await supabase
        .from('article_question_submissions')
        .select('blog_id, question_id, review_status')
        .eq('student_id', Number(userId))
        .in('blog_id', blogIds);

    if (error) {
        console.error('加载提交状态失败:', error);
        // 如果查询失败，有题目的文章默认显示未提交（保守策略）
        blogIds.forEach(id => {
            if (hasQuestions.get(id)) {
                resultMap.set(id, true);
            }
        });
        return resultMap;
    }

    // 4. 按文章ID分组统计提交情况
    const blogSubmissionMap = new Map();
    blogIds.forEach(id => {
        blogSubmissionMap.set(id, {
            submittedQuestions: new Set(),
            reviewedQuestions: new Set()
        });
    });

    data.forEach(row => {
        const blogId = row.blog_id;
        const questionId = String(row.question_id);
        const isReviewed = row.review_status === 'reviewed';

        const record = blogSubmissionMap.get(blogId);
        if (record) {
            record.submittedQuestions.add(questionId);
            if (isReviewed) {
                record.reviewedQuestions.add(questionId);
            }
        }
    });

    // 5. 判断每篇文章是否有未提交
    blogIds.forEach(blogId => {
        // 没有题目的文章 → 无未提交
        if (!hasQuestions.get(blogId)) {
            resultMap.set(blogId, false);
            return;
        }

        const record = blogSubmissionMap.get(blogId);
        if (!record) {
            // 有题目但没有任何提交记录 → 有未提交
            resultMap.set(blogId, true);
            return;
        }

        const submittedCount = record.submittedQuestions.size;
        const reviewedCount = record.reviewedQuestions.size;

        // 从未提交过任何题目 → 有未提交
        if (submittedCount === 0) {
            resultMap.set(blogId, true);
            return;
        }

        // 存在未批阅的题目 → 有未提交
        if (submittedCount > reviewedCount) {
            resultMap.set(blogId, true);
            return;
        }

        // 所有题目均已批阅 → 无未提交
        resultMap.set(blogId, false);
    });

    return resultMap;
}

function renderTreeWithStatus(children, depth = 0, statusMap = new Map()) {
    if (!children || children.length === 0) return '';
    let html = '';
    children.forEach(node => {
        const indent = depth * 20;
        const padding = `padding-left: ${indent + 8}px;`;
        if (node.isFile) {
            const hasUnsubmitted = statusMap.get(Number(node.blogId)) || false;
            const warningIcon = hasUnsubmitted ? `<span class="file-warning"><i class="fas fa-circle-exclamation"></i></span>` : '';
            html += `
                <div class="tree-item tree-file" style="${padding}" data-id="${node.blogId}">
                    <span class="file-icon"><i class="fas fa-file-alt"></i></span>
                    <span class="file-name">${node.name} ${warningIcon}</span>
                    <span class="file-arrow"><i class="fas fa-chevron-right"></i></span>
                </div>
            `;
        } else {
            let hasUnsubmittedChild = false;
            function checkNode(n) {
                if (n.isFile) {
                    if (statusMap.get(Number(n.blogId))) hasUnsubmittedChild = true;
                } else {
                    n.children.forEach(checkNode);
                }
            }
            node.children.forEach(checkNode);
            const defaultDisplay = hasUnsubmittedChild ? 'block' : 'none';
            const defaultChevron = hasUnsubmittedChild ? 'fa-chevron-down' : 'fa-chevron-right';
            html += `
                <div class="tree-folder-wrapper" style="${padding}">
                    <div class="tree-item tree-folder" data-path="${node.name}">
                        <span class="folder-toggle"><i class="fas ${defaultChevron}"></i></span>
                        <span class="folder-icon"><i class="fas fa-folder"></i></span>
                        <span class="folder-name">${node.name}</span>
                        <span class="folder-count">(${node.children.filter(c => c.isFile).length})</span>
                    </div>
                    <div class="tree-children" style="display: ${defaultDisplay}; padding-left: 20px;">
                        ${renderTreeWithStatus(node.children, depth + 1, statusMap)}
                    </div>
                </div>
            `;
        }
    });
    return html;
}

// ---------- 导航栏更新（分类页） ----------
function updateCategoryNav(user, currentSubject, subjectCount) {
    const statusEl = document.getElementById('nav-user-status');
    const loginBtn = document.getElementById('nav-login-btn');
    const logoutBtn = document.getElementById('nav-logout-btn');
    if (user) {
        statusEl.textContent = user.username;
        loginBtn.style.display = 'none';
        logoutBtn.style.display = 'inline-block';
    } else {
        statusEl.textContent = '未登录';
        loginBtn.style.display = 'inline-block';
        logoutBtn.style.display = 'none';
    }
    loginBtn.onclick = () => { window.location.href = 'index.html'; };
    logoutBtn.onclick = () => {
        logout();
        window.location.reload();
    };

    const subjectEl = document.getElementById('nav-current-subject');
    const countEl = document.getElementById('nav-post-count');
    if (subjectEl) subjectEl.textContent = currentSubject || '科目';
    if (countEl) countEl.textContent = subjectCount !== undefined ? `${subjectCount} 篇` : '';

    const switcher = document.getElementById('nav-subject-switcher');
    if (!switcher) return;
    if (!user) {
        switcher.innerHTML = '';
        return;
    }
    const permissionIds = getPermissionIds().map(Number).filter(Number.isFinite);
    const allSubjects = [...new Set(blogData.filter(b => permissionIds.includes(Number(b.id))).map(b => b.series))];
    if (allSubjects.length === 0) {
        switcher.innerHTML = '';
        return;
    }
    switcher.innerHTML = allSubjects.map(sub => {
        const active = sub === currentSubject ? 'active' : '';
        return `<a href="category.html?subject=${encodeURIComponent(sub)}" class="nav-subject-btn ${active}">${sub}</a>`;
    }).join('');
}

// ---------- 分类页初始化 ----------
async function initCategory() {
    const user = getCurrentUser();
    const container = document.getElementById('blog-list');
    const subject = getQueryParam('subject');

    if (!user) {
        container.innerHTML = `<div class="empty-tip">请先 <a href="index.html" style="color: var(--teal-dark);">登录</a> 后查看。</div>`;
        updateCategoryNav(null, subject, 0);
        return;
    }

    await loadData();
    let blogs = blogData.filter(b => b.series === subject);
    const permissionIds = getPermissionIds().map(Number).filter(Number.isFinite);
    blogs = blogs.filter(b => permissionIds.includes(Number(b.id)));

    if (!subject || blogs.length === 0) {
        container.innerHTML = `<div class="empty-tip">请从首页选择科目。<br><a href="index.html" style="color: var(--teal-dark);">返回首页</a></div>`;
        updateCategoryNav(user, subject || '科目', 0);
        return;
    }

    updateCategoryNav(user, subject, blogs.length);

    // 获取所有文章ID
    const blogIds = blogs.map(b => b.id);

    // 加载提交状态（内部会自动查询 article_answer_keys 获取题目数量）
    let submissionMap = new Map();
    if (user) {
        submissionMap = await loadSubmissionStatusForUsers(user.id, blogIds);
    }

    const tree = buildTree(blogs);
    container.innerHTML = renderTreeWithStatus(tree.children, 0, submissionMap);

    container.addEventListener('click', function (e) {
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
            if (id) window.location.href = `detail.html?id=${id}`;
        }
    });
}

// ---------- 详情页：Markdown 渲染与题目占位符 ----------
function injectQuestionSlots(markdown) {
    const tokenRegex = /(?:【\s*@\s*(\d*)\s*】|\[\s*@\s*(\d*)\s*\])/g;
    let autoCounter = 1;
    const usedIndices = new Set();
    const questionIdList = [];
    let slotCount = 0;
    const processed = markdown.replace(tokenRegex, (match, id1, id2) => {
        const numericId = (id1 !== undefined) ? id1 : id2;
        let questionId;
        if (numericId !== '') {
            questionId = String(numericId);
            usedIndices.add(Number(numericId));
        } else {
            while (usedIndices.has(autoCounter)) autoCounter++;
            questionId = String(autoCounter);
            usedIndices.add(autoCounter);
            autoCounter++;
        }
        slotCount++;
        questionIdList.push(questionId);
        return `{{SLOT_${questionId}}}`;
    });
    return { markdown: processed, questionCount: slotCount, questionIdList };
}

// ---------- 双栏渲染 ----------
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
function renderMarkdownWithSidebar(markdown, isDesktop, questionIdList, forceTwoColumn = false) {
    let rendered;
    if (!isDesktop) {
        const cleaned = markdown.replace(/^---\s*$/gm, '');
        rendered = renderMarkdown(cleaned);
    } else {
        const sections = parseMarkdownWithSidebar(markdown);
        if (sections.length === 0) {
            rendered = renderMarkdown(markdown);
        } else {
            let html = '';
            sections.forEach(section => {
                const mainMd = section.mainContent.join('\n').trim();
                const sidebarMd = section.sidebarContent.join('\n').trim();
                const hasSidebar = sidebarMd && sidebarMd.length > 0;
                if (!hasSidebar && !forceTwoColumn) {
                    html += renderMarkdown(section.h1 + '\n' + mainMd);
                } else {
                    const mainHtml = renderMarkdown(section.h1 + '\n' + mainMd);
                    const sidebarHtml = hasSidebar ? renderMarkdown(sidebarMd) : '<div class="detail-sidebar-placeholder" style="color: var(--gray); font-size: 0.9rem;"></div>';
                    html += `
                        <div class="detail-section-two-column">
                            <div class="detail-main-column">${mainHtml}</div>
                            <div class="detail-sidebar-column">${sidebarHtml}</div>
                        </div>
                    `;
                }
            });
            rendered = html;
        }
    }
    if (questionIdList && questionIdList.length > 0) {
        questionIdList.forEach((questionId, index) => {
            const placeholder = `{{SLOT_${questionId}}}`;
            const slotHtml = `<div class="question-slot" data-question-id="${questionId}" data-question-index="${index + 1}"></div>`;
            rendered = rendered.split(placeholder).join(slotHtml);
        });
    }
    return rendered;
}

// ---------- 数据库操作 ----------
async function loadQuestionAnswerKeys(blogId) {
    if (!blogId) return new Map();
    const { data, error } = await supabase
        .from('article_answer_keys')
        .select('blog_id, question_id, answer_text, auto_grade, updated_at')
        .eq('blog_id', blogId);
    if (error) { console.error('加载答案设置失败:', error); return new Map(); }
    const map = new Map();
    (data || []).forEach(item => map.set(item.question_id, item));
    return map;
}
async function loadQuestionSubmissions(blogId, studentId) {
    if (!blogId || !studentId) return new Map();
    const numericId = Number(studentId);
    if (!Number.isFinite(numericId) || String(studentId) === 'young-super-user') return new Map();
    const { data, error } = await supabase
        .from('article_question_submissions')
        .select('blog_id, student_id, question_id, answer_text, review_status, review_result, submitted_at, reviewed_at')
        .eq('blog_id', blogId)
        .eq('student_id', numericId);
    if (error) { console.error('加载学生提交失败:', error); return new Map(); }
    const map = new Map();
    (data || []).forEach(item => {
        const questionId = String(item.question_id);
        map.set(questionId, { ...item, question_id: questionId });
    });
    return map;
}

// ---------- 状态管理 ----------
function resetDetailState() {
    detailState.questionCount = 0;
    detailState.questionIdList = [];
    detailState.answerKeyMap = new Map();
    detailState.submissionMap = new Map();
    detailState.slotNodes = new Map();
    detailState.statusNodes = new Map();
    detailState.submitButton = null;
    detailState.actionStatus = null;
    detailState.contentVersion++;
    detailState._submitting = false;
}

// FAB 状态反馈
function setFabStatus(success, message) {
    const fab = document.getElementById('fab-submit');
    if (!fab) return;
    if (success) {
        fab.classList.add('is-success');
        fab.innerHTML = '<i class="fas fa-check"></i> 成功';
    } else {
        fab.classList.add('is-error');
        fab.innerHTML = '<i class="fas fa-times"></i> 失败';
    }
    if (message) showToast(message, success ? 'success' : 'error', 3000);
    setTimeout(() => {
        fab.classList.remove('is-success', 'is-error');
        updateFabButton();
    }, 2500);
}

function updateFabButton() {
    const fab = document.getElementById('fab-submit');
    if (!fab) return;
    const mode = detailState.mode;
    if (mode === 'study') {
        fab.innerHTML = '<i class="fas fa-paper-plane"></i> 提交';
        fab.title = '提交作业';
        fab.style.display = 'flex';
    } else if (mode === 'answer') {
        fab.innerHTML = '<i class="fas fa-save"></i> 保存';
        fab.title = '保存答案';
        fab.style.display = 'flex';
    } else {
        fab.style.display = 'none';
    }
}

// 刷新提交状态（不重新渲染整个页面）
async function refreshSubmissionStatus() {
    const blogId = detailState.blogId;
    const studentId = detailState.studentId;
    if (!blogId || !studentId) return;
    const newSubmissions = await loadQuestionSubmissions(blogId, studentId);
    detailState.submissionMap = newSubmissions;
    detailState.slotNodes.forEach((node, questionId) => {
        const submission = detailState.submissionMap.get(questionId);
        const statusNode = detailState.statusNodes.get(questionId);
        if (statusNode) {
            const { text, cls } = buildStatusPill(submission);
            statusNode.textContent = text;
            statusNode.className = `question-pill ${cls}`;
        }
        if (detailState.mode === 'study' && node.textarea) {
            const isReviewed = submission?.review_status === 'reviewed';
            if (isReviewed) {
                node.textarea.readOnly = true;
                node.textarea.classList.add('is-locked');
                if (submission?.answer_text) {
                    node.textarea.value = submission.answer_text;
                }
            } else {
                node.textarea.readOnly = false;
                node.textarea.classList.remove('is-locked');
            }
        }
    });
}

// ---------- 渲染题目卡片 ----------
function buildStatusPill(submission) {
    if (!submission) return { text: '未提交', cls: 'is-waiting' };
    if (submission.review_status !== 'reviewed') return { text: '待批阅', cls: 'is-pending' };
    const map = { correct: '正确', partial: '半对', wrong: '错误' };
    return { text: map[submission.review_result] || '已批阅', cls: `is-${submission.review_result || 'reviewed'}` };
}
function createPill(text, className = '') {
    const span = document.createElement('span');
    span.className = `question-pill${className ? ` ${className}` : ''}`;
    span.textContent = text;
    return span;
}
function createIconButton(iconClass, text, className) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `question-icon-btn ${className}`;
    btn.innerHTML = `<i class="${iconClass}"></i><span class="sr-only">${escapeHtml(text)}</span>`;
    btn.title = text;
    return btn;
}

function renderStudySlot(questionId, index) {
    const wrapper = document.createElement('div');
    wrapper.className = 'question-card question-card-study';
    wrapper.dataset.questionId = questionId;
    const header = document.createElement('div');
    header.className = 'question-card-header';
    const textarea = document.createElement('textarea');
    textarea.className = 'question-textarea question-textarea-study';
    textarea.rows = 3;
    textarea.placeholder = '在这里填写答案';
    const submission = detailState.submissionMap.get(questionId);
    const answerKey = detailState.answerKeyMap.get(questionId);
    const isReviewed = submission?.review_status === 'reviewed';
    const originalAnswer = submission?.answer_text || '';
    if (submission) {
        textarea.value = originalAnswer;
        if (isReviewed) {
            textarea.readOnly = true;
            textarea.classList.add('is-locked');
        }
    }
    const footer = document.createElement('div');
    footer.className = 'question-card-footer question-card-footer-between';
    const { text, cls } = buildStatusPill(submission);
    const status = createPill(text, cls);
    footer.appendChild(status);
    detailState.statusNodes.set(questionId, status);

    const actionBtn = document.createElement('button');
    actionBtn.type = 'button';
    actionBtn.className = 'question-action-btn';
    if (isReviewed) {
        let showingAnswer = false;
        actionBtn.innerHTML = '<i class="fas fa-eye"></i><span>查看答案</span>';
        actionBtn.addEventListener('click', function (e) {
            e.preventDefault();
            if (!showingAnswer) {
                textarea.value = answerKey?.answer_text || '（未设置标准答案）';
                textarea.classList.add('is-showing-answer');
                showingAnswer = true;
                this.innerHTML = '<i class="fas fa-undo"></i><span>查看作答</span>';
            } else {
                textarea.value = originalAnswer;
                textarea.classList.remove('is-showing-answer');
                showingAnswer = false;
                this.innerHTML = '<i class="fas fa-eye"></i><span>查看答案</span>';
            }
        });
    } else {
        actionBtn.innerHTML = '<i class="fas fa-paper-plane"></i><span>提交已做</span>';
        actionBtn.addEventListener('click', async function () {
            this.disabled = true;
            const ok = await persistStudyAnswers({ silent: false, targetQuestionId: questionId });
            this.disabled = false;
            if (ok) {
                await refreshSubmissionStatus();
            }
        });
    }
    footer.appendChild(actionBtn);
    wrapper.append(header, textarea, footer);
    detailState.slotNodes.set(questionId, { wrapper, textarea, status, mode: 'study' });
    return wrapper;
}

function renderReviewSlot(questionId, index) {
    const wrapper = document.createElement('div');
    wrapper.className = 'question-card question-card-review';
    wrapper.dataset.questionId = questionId;
    const submission = detailState.submissionMap.get(questionId);
    const answerKey = detailState.answerKeyMap.get(questionId);
    const header = document.createElement('div');
    header.className = 'question-card-header';
    const answerBox = document.createElement('textarea');
    answerBox.className = 'question-textarea question-textarea-review';
    answerBox.rows = 3;
    answerBox.readOnly = true;
    answerBox.value = submission?.answer_text ?? '学生尚未提交';
    const refWrapper = document.createElement('div');
    refWrapper.className = 'question-reference-wrapper';
    const refLabel = document.createElement('span');
    refLabel.className = 'question-reference-label';
    refLabel.textContent = '📖 参考答案：';
    const refText = document.createElement('div');
    refText.className = 'question-reference-text';
    refText.textContent = answerKey?.answer_text || '（未设置参考答案）';
    refWrapper.append(refLabel, refText);
    const toolbar = document.createElement('div');
    toolbar.className = 'question-review-toolbar';
    const { text, cls } = buildStatusPill(submission);
    const status = createPill(text, cls);
    detailState.statusNodes.set(questionId, status);
    const correctBtn = createIconButton('fas fa-check-circle', '正确', 'is-correct');
    const partialBtn = createIconButton('fas fa-adjust', '半对', 'is-partial');
    const wrongBtn = createIconButton('fas fa-times-circle', '错误', 'is-wrong');
    toolbar.append(status, correctBtn, partialBtn, wrongBtn);
    wrapper.append(header, answerBox, refWrapper, toolbar);
    detailState.slotNodes.set(questionId, { wrapper, answerBox, status, mode: 'review', correctBtn, partialBtn, wrongBtn });
    return wrapper;
}

function renderAnswerSlot(questionId, index) {
    const wrapper = document.createElement('div');
    wrapper.className = 'question-card question-card-answer';
    wrapper.dataset.questionId = questionId;
    const key = detailState.answerKeyMap.get(questionId) || { answer_text: '', auto_grade: false };
    const header = document.createElement('div');
    header.className = 'question-card-header';
    const textarea = document.createElement('textarea');
    textarea.className = 'question-textarea question-textarea-answer';
    textarea.rows = 3;
    textarea.placeholder = '设置标准答案';
    textarea.value = key.answer_text ?? '';
    const footer = document.createElement('div');
    footer.className = 'question-card-footer question-card-footer-between';
    const status = createPill(key.auto_grade ? '自动批阅已开启' : '自动批阅关闭', key.auto_grade ? 'is-auto' : 'is-muted');
    const autoWrap = document.createElement('label');
    autoWrap.className = 'question-auto-grade';
    autoWrap.innerHTML = `<input type="checkbox" ${key.auto_grade ? 'checked' : ''}><span>启用自动批阅</span>`;
    footer.append(status, autoWrap);
    wrapper.append(header, textarea, footer);
    detailState.slotNodes.set(questionId, { wrapper, textarea, status, autoWrap, mode: 'answer' });
    detailState.statusNodes.set(questionId, status);
    return wrapper;
}

// ---------- 数据持久化 ----------
async function persistStudyAnswers({ silent = false, targetQuestionId = null } = {}) {
    if (detailState._submitting) return false;
    detailState._submitting = true;
    try {
        if (!detailState.blogId || !detailState.studentId) {
            if (!silent) setFabStatus(false, '当前文章没有可用的学生身份，无法提交');
            return false;
        }
        const rows = [];
        const now = new Date().toISOString();
        detailState.slotNodes.forEach((node, questionId) => {
            if (targetQuestionId && String(targetQuestionId) !== String(questionId)) return;
            const submission = detailState.submissionMap.get(questionId);
            if (submission?.review_status === 'reviewed') return;
            const answer = node.textarea?.value || '';
            const answerKey = detailState.answerKeyMap.get(questionId);
            const autoGrade = Boolean(answerKey?.auto_grade && answerKey.answer_text);
            if (autoGrade && answer.trim() === '') return;
            if (!submission && answer.trim() === '' && !autoGrade) return;
            let reviewStatus = 'pending';
            let reviewResult = null;
            let reviewedAt = null;
            if (autoGrade) {
                reviewStatus = 'reviewed';
                reviewResult = normalizeLineBreaks(answer) === normalizeLineBreaks(answerKey.answer_text) ? 'correct' : 'wrong';
                reviewedAt = now;
            }
            rows.push({
                blog_id: detailState.blogId,
                student_id: detailState.studentId,
                question_id: questionId,
                answer_text: answer,
                review_status: reviewStatus,
                review_result: reviewResult,
                submitted_at: now,
                reviewed_at: reviewedAt
            });
        });
        if (!rows.length) {
            if (!silent) setFabStatus(true, '没有需要提交的内容');
            return true;
        }
        const { error } = await supabase
            .from('article_question_submissions')
            .upsert(rows, { onConflict: 'blog_id,student_id,question_id' });
        if (error) {
            console.error('保存学生答案失败:', error);
            if (!silent) setFabStatus(false, '提交失败，请稍后重试');
            return false;
        }
        if (!silent) setFabStatus(true, '提交成功！');
        return true;
    } finally {
        detailState._submitting = false;
    }
}

async function persistAnswerKeys({ silent = false } = {}) {
    if (detailState._submitting) return false;
    detailState._submitting = true;
    try {
        if (!detailState.blogId) {
            if (!silent) setFabStatus(false, '当前文章无效，无法保存');
            return false;
        }
        const rows = [];
        detailState.slotNodes.forEach((node, questionId) => {
            const answerText = node.textarea?.value || '';
            const autoGrade = Boolean(node.autoWrap?.querySelector('input[type="checkbox"]')?.checked);
            rows.push({ blog_id: detailState.blogId, question_id: questionId, answer_text: answerText, auto_grade: autoGrade });
        });
        if (!rows.length) {
            if (!silent) setFabStatus(true, '没有可保存的答案设置');
            return true;
        }
        const { error } = await supabase
            .from('article_answer_keys')
            .upsert(rows, { onConflict: 'blog_id,question_id' });
        if (error) {
            console.error('保存答案设置失败:', error);
            if (!silent) setFabStatus(false, '保存失败，请稍后重试');
            return false;
        }
        if (!silent) setFabStatus(true, '保存成功！');
        return true;
    } finally {
        detailState._submitting = false;
    }
}

async function persistReviewResult(questionId, reviewResult) {
    if (!detailState.blogId || !detailState.studentId) {
        setFabStatus(false, '请先从管理员页面选择学生后再批阅');
        return false;
    }
    const submission = detailState.submissionMap.get(questionId) || {};
    const now = new Date().toISOString();
    const { error } = await supabase
        .from('article_question_submissions')
        .upsert([{
            blog_id: detailState.blogId,
            student_id: detailState.studentId,
            question_id: questionId,
            answer_text: submission.answer_text || '',
            review_status: 'reviewed',
            review_result: reviewResult,
            submitted_at: submission.submitted_at || now,
            reviewed_at: now
        }], { onConflict: 'blog_id,student_id,question_id' });
    if (error) {
        console.error('保存批阅结果失败:', error);
        setFabStatus(false, '批阅保存失败，请重试');
        return false;
    }
    detailState.submissionMap.set(questionId, {
        ...submission,
        review_status: 'reviewed',
        review_result: reviewResult,
        reviewed_at: now
    });
    const status = detailState.statusNodes.get(questionId);
    if (status) {
        const { text, cls } = buildStatusPill(detailState.submissionMap.get(questionId));
        status.textContent = text;
        status.className = `question-pill ${cls}`;
    }
    setFabStatus(true, '批阅已保存');
    return true;
}

// ---------- 详情页初始化 ----------
let isRendering = false;

async function initDetail() {
    if (isRendering) return;
    isRendering = true;
    resetDetailState();
    const mode = getDetailMode();
    detailState.mode = mode;

    const fab = document.getElementById('fab-submit');
    if (fab) {
        fab.style.display = 'none';
        fab.disabled = false;
        fab.classList.remove('is-success', 'is-error');
        fab.onclick = null;
    }

    await loadData();
    const idStr = getQueryParam('id');
    const container = document.querySelector('.detail-body');
    const titleEl = document.getElementById('detail-title');
    const navTitle = document.getElementById('nav-detail-title');
    const navMode = document.getElementById('nav-detail-mode');

    if (!idStr) {
        container.innerHTML = `<div class="empty-tip">文章不存在。<br><a href="index.html" style="color: var(--teal-dark);">返回首页</a></div>`;
        titleEl.textContent = '文章不存在';
        isRendering = false;
        return;
    }

    const id = parseInt(idStr, 10);
    const blog = blogData.find(b => b.id === id);
    if (!blog) {
        container.innerHTML = `<div class="empty-tip">文章未找到。<br><a href="index.html" style="color: var(--teal-dark);">返回首页</a></div>`;
        titleEl.textContent = '未找到';
        isRendering = false;
        return;
    }

    detailState.blogId = id;

    const studentIdParam = getQueryParam('studentId');
    if (studentIdParam) {
        const num = Number(studentIdParam);
        detailState.studentId = Number.isFinite(num) ? num : studentIdParam;
    } else {
        detailState.studentId = null;
    }

    if (mode === 'study') {
        const user = getCurrentUser();
        if (!user) {
            container.innerHTML = `<div class="empty-tip">请先 <a href="index.html" style="color: var(--teal-dark);">登录</a> 后查看。</div>`;
            titleEl.textContent = '请登录';
            isRendering = false;
            return;
        }
        if (!hasPermission(id)) {
            container.innerHTML = `<div class="empty-tip">您没有权限查看此文章。<br><a href="index.html" style="color: var(--teal-dark);">返回首页</a></div>`;
            titleEl.textContent = '无权限';
            isRendering = false;
            return;
        }
        const numericUserId = Number(user.id);
        detailState.studentId = Number.isFinite(numericUserId) ? numericUserId : null;
        updateDetailNav(user);
    } else {
        const user = getCurrentUser();
        if (user) updateDetailNav(user);
    }

    const content = await loadMarkdownContent(blog.path);
    const slotResult = injectQuestionSlots(content);
    detailState.questionCount = slotResult.questionCount;
    detailState.questionIdList = slotResult.questionIdList;

    titleEl.textContent = blog.title;
    if (navTitle) navTitle.textContent = blog.title;
    document.title = `${blog.title}${mode === 'study' ? '' : ` · ${mode === 'review' ? '批阅' : '答案设置'}`}`;

    if (navMode) {
        let modeText = mode === 'study' ? '📖 阅读' : mode === 'review' ? `✏️ 批阅` : '🔑 答案设置';
        if (mode === 'review' && detailState.studentId) {
            modeText += ` (学生 ${detailState.studentId})`;
        }
        navMode.textContent = modeText;
    }

    const isDesktop = window.innerWidth >= 1024;
    const forceTwoColumn = (mode === 'review');
    container.innerHTML = renderMarkdownWithSidebar(slotResult.markdown, isDesktop, slotResult.questionIdList, forceTwoColumn);

    detailState.answerKeyMap = new Map();
    detailState.submissionMap = new Map();
    const answerKeys = await loadQuestionAnswerKeys(id);
    answerKeys.forEach((item, qid) => detailState.answerKeyMap.set(qid, item));

    if (mode === 'study' || mode === 'review') {
        let studentId = detailState.studentId;
        if (mode === 'review') {
            const param = getQueryParam('studentId');
            if (param) {
                const num = Number(param);
                studentId = Number.isFinite(num) ? num : null;
            }
        }
        if (studentId) {
            const submissions = await loadQuestionSubmissions(id, studentId);
            submissions.forEach((item, qid) => detailState.submissionMap.set(qid, item));
            detailState.studentId = studentId;
        }
    }

    const slotElements = Array.from(container.querySelectorAll('.question-slot'));
    slotElements.forEach((slotEl, index) => {
        const questionId = slotResult.questionIdList[index];
        let node = null;
        if (mode === 'study') node = renderStudySlot(questionId, index + 1);
        else if (mode === 'review') node = renderReviewSlot(questionId, index + 1);
        else node = renderAnswerSlot(questionId, index + 1);
        slotEl.replaceWith(node);
    });

    if (mode === 'review') {
        detailState.slotNodes.forEach((node, qid) => {
            if (!node.correctBtn) return;
            node.correctBtn.addEventListener('click', () => persistReviewResult(qid, 'correct'));
            node.partialBtn.addEventListener('click', () => persistReviewResult(qid, 'partial'));
            node.wrongBtn.addEventListener('click', () => persistReviewResult(qid, 'wrong'));
        });
    }

    if (mode === 'answer') {
        detailState.slotNodes.forEach((node, qid) => {
            if (!node.textarea) return;
            node.textarea.addEventListener('input', () => {
                const existing = detailState.answerKeyMap.get(qid) || { blog_id: id, question_id: qid, answer_text: '', auto_grade: false };
                detailState.answerKeyMap.set(qid, { ...existing, answer_text: node.textarea.value });
            });
            if (node.autoWrap) {
                const checkbox = node.autoWrap.querySelector('input[type="checkbox"]');
                if (checkbox) {
                    checkbox.addEventListener('change', () => {
                        const existing = detailState.answerKeyMap.get(qid) || { blog_id: id, question_id: qid, answer_text: '', auto_grade: false };
                        detailState.answerKeyMap.set(qid, { ...existing, auto_grade: checkbox.checked });
                        const pill = detailState.statusNodes.get(qid);
                        if (pill) {
                            pill.textContent = checkbox.checked ? '自动批阅已开启' : '自动批阅关闭';
                            pill.className = `question-pill ${checkbox.checked ? 'is-auto' : 'is-muted'}`;
                        }
                    });
                }
            }
        });
    }

    const fabBtn = document.getElementById('fab-submit');
    if (fabBtn) {
        updateFabButton();
        if (mode === 'study' || mode === 'answer') {
            fabBtn.style.display = 'flex';
            fabBtn.disabled = false;
            fabBtn.onclick = async () => {
                if (detailState._submitting) return;
                fabBtn.disabled = true;
                let ok;
                if (mode === 'study') ok = await persistStudyAnswers({ silent: false });
                else ok = await persistAnswerKeys({ silent: false });
                fabBtn.disabled = false;
                if (ok) {
                    await refreshSubmissionStatus();
                }
            };
        } else {
            fabBtn.style.display = 'none';
        }
    }

    // 页面关闭前自动保存
    if (mode === 'study' || mode === 'answer') {
        const autoSave = async () => {
            if (mode === 'study') await persistStudyAnswers({ silent: true });
            else await persistAnswerKeys({ silent: true });
        };
        window.addEventListener('pagehide', autoSave, { once: true });
    }

    isRendering = false;
}

// ---------- 导航栏更新（详情页） ----------
function updateDetailNav(user) {
    const statusEl = document.getElementById('nav-user-status');
    const loginBtn = document.getElementById('nav-login-btn');
    const logoutBtn = document.getElementById('nav-logout-btn');
    if (user) {
        statusEl.textContent = user.username;
        loginBtn.style.display = 'none';
        logoutBtn.style.display = 'inline-block';
    } else {
        statusEl.textContent = '未登录';
        loginBtn.style.display = 'inline-block';
        logoutBtn.style.display = 'none';
    }
    loginBtn.onclick = () => { window.location.href = 'index.html'; };
    logoutBtn.onclick = () => {
        logout();
        window.location.href = 'index.html';
    };
}

// ---------- 路由 ----------
document.addEventListener('DOMContentLoaded', function () {
    const path = window.location.pathname;
    if (path.includes('category.html')) initCategory();
    else if (path.includes('detail.html')) initDetail();
});

let resizeTimer;
window.addEventListener('resize', function () {
    if (window.location.pathname.includes('detail.html')) {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(initDetail, 300);
    }
});

// 暴露调试
window.initDetail = initDetail;
window.initCategory = initCategory;