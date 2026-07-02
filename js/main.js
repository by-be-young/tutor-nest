/**
 * main.js - 分类页与详情页逻辑
 * 职责：
 *   - 分类页：树状文章列表渲染与导航
 *   - 详情页：Markdown 渲染、题目占位符注入、学生提交、教师批阅、答案设置
 */

import { supabase } from './supabase-client.js';
import { getCurrentUser, hasPermission, getPermissionIds } from './auth.js';

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
    contentVersion: 0
};

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
    // 排序：文件夹在前，文件在后，按名称排序
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
            html += `
                <div class="tree-folder-wrapper" style="${padding}">
                    <div class="tree-item tree-folder" data-path="${node.name}">
                        <span class="folder-toggle"><i class="fas fa-chevron-right"></i></span>
                        <span class="folder-icon"><i class="fas fa-folder"></i></span>
                        <span class="folder-name">${node.name}</span>
                        <span class="folder-count">(${node.children.filter(c => c.isFile).length})</span>
                    </div>
                    <div class="tree-children" style="display: none; padding-left: 20px;">
                        ${renderTree(node.children, depth + 1)}
                    </div>
                </div>
            `;
        }
    });
    return html;
}

// ---------- 分类页初始化 ----------
async function initCategory() {
    const user = getCurrentUser();
    if (!user) {
        document.querySelector('.category-container').innerHTML = `
            <div class="empty-tip">请先 <a href="index.html" style="color: var(--teal-dark);">登录</a> 后查看。</div>
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

    let blogs = blogData.filter(b => b.series === subject);
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
    listEl.innerHTML = renderTree(tree.children, 0);

    // 点击事件：文件夹展开/收起，文章跳转详情
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
    if (error) {
        console.error('加载答案设置失败:', error);
        return new Map();
    }
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
    if (error) {
        console.error('加载学生提交失败:', error);
        return new Map();
    }
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
}

function setActionStatus(text, type = '') {
    if (!detailState.actionStatus) return;
    detailState.actionStatus.textContent = text || '';
    detailState.actionStatus.className = `detail-action-status${type ? ` is-${type}` : ''}`;
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

// 三种模式：学习（study）、批阅（review）、答案设置（answer）
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
                setActionStatus('已显示标准答案，点击"查看作答"恢复你的作答', 'info');
            } else {
                textarea.value = originalAnswer;
                textarea.classList.remove('is-showing-answer');
                showingAnswer = false;
                this.innerHTML = '<i class="fas fa-eye"></i><span>查看答案</span>';
                setActionStatus('已恢复你的作答', 'info');
            }
        });
    } else {
        actionBtn.innerHTML = '<i class="fas fa-paper-plane"></i><span>提交已做</span>';
        actionBtn.addEventListener('click', async function () {
            this.disabled = true;
            const ok = await persistStudyAnswers({ silent: false });
            this.disabled = false;
            if (ok) await initDetail();
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
    if (!detailState.blogId || !detailState.studentId) {
        if (!silent) setActionStatus('当前文章没有可用的学生身份，无法提交', 'error');
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
        if (!silent) setActionStatus('没有需要提交的内容', 'info');
        return true;
    }

    const { error } = await supabase
        .from('article_question_submissions')
        .upsert(rows, { onConflict: 'blog_id,student_id,question_id' });

    if (error) {
        console.error('保存学生答案失败:', error);
        if (!silent) setActionStatus('提交失败，请稍后重试', 'error');
        return false;
    }
    if (!silent) setActionStatus('已提交，状态已更新', 'success');
    return true;
}

async function persistAnswerKeys({ silent = false } = {}) {
    if (!detailState.blogId) return false;
    const rows = [];
    detailState.slotNodes.forEach((node, questionId) => {
        const answerText = node.textarea?.value || '';
        const autoGrade = Boolean(node.autoWrap?.querySelector('input[type="checkbox"]')?.checked);
        rows.push({ blog_id: detailState.blogId, question_id: questionId, answer_text: answerText, auto_grade: autoGrade });
    });
    if (!rows.length) {
        if (!silent) setActionStatus('没有可保存的答案设置', 'info');
        return true;
    }
    const { error } = await supabase
        .from('article_answer_keys')
        .upsert(rows, { onConflict: 'blog_id,question_id' });
    if (error) {
        console.error('保存答案设置失败:', error);
        if (!silent) setActionStatus('保存失败，请稍后重试', 'error');
        return false;
    }
    if (!silent) setActionStatus('答案已保存', 'success');
    return true;
}

async function persistReviewResult(questionId, reviewResult) {
    if (!detailState.blogId || !detailState.studentId) {
        setActionStatus('请先从管理员页面选择学生后再批阅', 'error');
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
        setActionStatus('批阅保存失败，请重试', 'error');
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
    setActionStatus('批阅已保存', 'success');
    return true;
}

// ---------- 详情页初始化 ----------
function getDetailHeaderActions() {
    let actions = document.querySelector('.detail-actions');
    if (!actions) {
        const titleArea = document.querySelector('.detail-title-area');
        if (!titleArea) return null;
        actions = document.createElement('div');
        actions.className = 'detail-actions';
        titleArea.appendChild(actions);
    }
    return actions;
}

async function initDetail() {
    resetDetailState();
    const mode = getDetailMode();
    detailState.mode = mode;

    const fabBtn = document.getElementById('fab-submit');
    if (fabBtn) {
        fabBtn.style.display = 'none';
        fabBtn.disabled = false;
        const newFab = fabBtn.cloneNode(true);
        fabBtn.parentNode.replaceChild(newFab, fabBtn);
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

    detailState.blogId = id;

    // 解析 studentId
    const studentIdParam = getQueryParam('studentId');
    if (studentIdParam) {
        const num = Number(studentIdParam);
        detailState.studentId = Number.isFinite(num) ? num : studentIdParam;
    } else {
        detailState.studentId = null;
    }

    // study 模式：从登录用户获取 studentId
    if (mode === 'study') {
        const user = getCurrentUser();
        if (!user) {
            container.innerHTML = `<div class="empty-tip">请先 <a href="index.html" style="color: var(--teal-dark);">登录</a> 后查看。</div>`;
            return;
        }
        if (!hasPermission(id)) {
            container.innerHTML = `<div class="empty-tip">您没有权限查看此文章。<br><a href="index.html" style="color: var(--teal-dark);">返回首页</a></div>`;
            return;
        }
        const numericUserId = Number(user.id);
        detailState.studentId = Number.isFinite(numericUserId) ? numericUserId : null;
    }

    // 加载并渲染 Markdown
    const content = await loadMarkdownContent(blog.path);
    const slotResult = injectQuestionSlots(content);
    detailState.questionCount = slotResult.questionCount;
    detailState.questionIdList = slotResult.questionIdList;

    document.querySelector('.detail-title').textContent = blog.title;
    document.title = `${blog.title}${mode === 'study' ? '' : ` · ${mode === 'review' ? '批阅' : '答案设置'}`}`;

    const modeLabel = mode === 'study' ? '阅读' : mode === 'review' ? '批阅' : '设置答案';
    document.querySelector('.detail-meta').innerHTML = `
        <span class="series-badge">📂 ${blog.series}</span>
        ${blog.path ? `<span class="path-badge">📁 ${blog.path.replace(/\\/g, '/')}</span>` : ''}
        <span class="mode-badge is-${mode}">${modeLabel}</span>
    `;

    const isDesktop = window.innerWidth >= 1024;
    const forceTwoColumn = (mode === 'review');
    const body = document.querySelector('.detail-body');
    body.innerHTML = renderMarkdownWithSidebar(slotResult.markdown, isDesktop, slotResult.questionIdList, forceTwoColumn);

    // 顶部操作栏
    const actions = getDetailHeaderActions();
    if (actions) {
        actions.innerHTML = '';
        const statusEl = document.createElement('span');
        statusEl.className = 'detail-action-status';
        detailState.actionStatus = statusEl;
        actions.appendChild(statusEl);

        if (mode === 'study') {
            const submitHandler = async () => {
                const topBtn = document.querySelector('.detail-action-btn.primary');
                const fab = document.getElementById('fab-submit');
                if (topBtn) topBtn.disabled = true;
                if (fab) fab.disabled = true;
                const ok = await persistStudyAnswers({ silent: false });
                if (topBtn) topBtn.disabled = false;
                if (fab) fab.disabled = false;
                if (ok) await initDetail();
            };

            const submitBtn = document.createElement('button');
            submitBtn.type = 'button';
            submitBtn.className = 'detail-action-btn primary';
            submitBtn.innerHTML = '<i class="fas fa-paper-plane"></i><span>提交作业</span>';
            detailState.submitButton = submitBtn;
            submitBtn.addEventListener('click', submitHandler);
            actions.appendChild(submitBtn);

            const fab = document.getElementById('fab-submit');
            if (fab) {
                fab.style.display = 'flex';
                fab.innerHTML = '<i class="fas fa-paper-plane"> 提交作业</i>';
                fab.title = '提交作业';
                fab.addEventListener('click', submitHandler);
            }
        } else if (mode === 'answer') {
            const saveHandler = async () => {
                const topBtn = document.querySelector('.detail-action-btn.primary');
                const fab = document.getElementById('fab-submit');
                if (topBtn) topBtn.disabled = true;
                if (fab) fab.disabled = true;
                const ok = await persistAnswerKeys({ silent: false });
                if (topBtn) topBtn.disabled = false;
                if (fab) fab.disabled = false;
                if (ok) await initDetail();
            };

            const saveBtn = document.createElement('button');
            saveBtn.type = 'button';
            saveBtn.className = 'detail-action-btn primary';
            saveBtn.innerHTML = '<i class="fas fa-save"></i><span>保存答案</span>';
            detailState.submitButton = saveBtn;
            saveBtn.addEventListener('click', saveHandler);
            actions.appendChild(saveBtn);

            const fab = document.getElementById('fab-submit');
            if (fab) {
                fab.style.display = 'flex';
                fab.innerHTML = '<i class="fas fa-save"> 保存答案</i>';
                fab.title = '保存答案';
                fab.addEventListener('click', saveHandler);
            }
        } else {
            const fab = document.getElementById('fab-submit');
            if (fab) fab.style.display = 'none';
            const tag = document.createElement('span');
            tag.className = 'detail-mode-tag';
            tag.textContent = `学生 ${detailState.studentId || '未指定'}`;
            actions.appendChild(tag);
        }
    }

    // 加载答案设置和提交记录
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

    // 待批阅计数
    const unreviewedCount = Array.from(detailState.submissionMap.values())
        .filter(item => item.review_status !== 'reviewed').length;
    if (mode === 'review' && unreviewedCount > 0) {
        document.querySelector('.detail-meta').insertAdjacentHTML('beforeend',
            `<span class="mode-badge is-warning">待批阅 ${unreviewedCount} 题</span>`);
    }

    // 替换占位符为题目卡片
    const slotElements = Array.from(body.querySelectorAll('.question-slot'));
    slotElements.forEach((slotEl, index) => {
        const questionId = slotResult.questionIdList[index];
        let node = null;
        if (mode === 'study') node = renderStudySlot(questionId, index + 1);
        else if (mode === 'review') node = renderReviewSlot(questionId, index + 1);
        else node = renderAnswerSlot(questionId, index + 1);
        slotEl.replaceWith(node);
    });

    // 绑定批阅按钮事件
    if (mode === 'review') {
        detailState.slotNodes.forEach((node, qid) => {
            if (!node.correctBtn) return;
            node.correctBtn.addEventListener('click', () => persistReviewResult(qid, 'correct'));
            node.partialBtn.addEventListener('click', () => persistReviewResult(qid, 'partial'));
            node.wrongBtn.addEventListener('click', () => persistReviewResult(qid, 'wrong'));
        });
    }

    // 答案设置模式：实时更新状态
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

    // 页面关闭前自动保存
    if (mode === 'study' || mode === 'answer') {
        const autoSave = async () => {
            if (mode === 'study') await persistStudyAnswers({ silent: true });
            else await persistAnswerKeys({ silent: true });
        };
        window.addEventListener('pagehide', autoSave, { once: true });
    }

    // 状态提示
    if (detailState.questionCount === 0) {
        setActionStatus('当前文章没有可提交的题目', 'info');
    } else if (mode === 'study') {
        setActionStatus('填写答案后点击提交', 'info');
    } else if (mode === 'review') {
        setActionStatus('点击图标即可完成批阅', 'info');
    } else {
        setActionStatus('填写标准答案后可保存', 'info');
    }
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