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

const QUESTION_TOKEN_REGEX = /(?:【\s*@\s*】|\[\s*@\s*\])/g;
const DETAIL_MODES = new Set(['study', 'review', 'answer']);

const detailState = {
    mode: 'study',
    blogId: null,
    studentId: null,
    questionCount: 0,
    answerKeyMap: new Map(),
    submissionMap: new Map(),
    slotNodes: new Map(),
    statusNodes: new Map(),
    submitButton: null,
    actionStatus: null,
    contentVersion: 0
};

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

function injectQuestionSlots(markdown) {
    let questionIndex = 0;
    const parts = markdown.split(/(```[\s\S]*?```)/g);
    const processed = parts.map(part => {
        if (part.startsWith('```')) return part;
        return part.replace(QUESTION_TOKEN_REGEX, () => {
            questionIndex += 1;
            return `<div class="question-slot" data-question-index="${questionIndex}"></div>`;
        });
    });
    return {
        markdown: processed.join(''),
        questionCount: questionIndex
    };
}

async function loadQuestionAnswerKeys(blogId) {
    if (!blogId) return [];
    const { data, error } = await supabase
        .from('article_answer_keys')
        .select('blog_id, question_index, answer_text, auto_grade, updated_at')
        .eq('blog_id', blogId)
        .order('question_index', { ascending: true });
    if (error) {
        console.error('加载答案设置失败:', error);
        return [];
    }
    return Array.isArray(data) ? data : [];
}

async function loadQuestionSubmissions(blogId, studentId) {
    if (!blogId || !studentId) return [];
    const { data, error } = await supabase
        .from('article_question_submissions')
        .select('blog_id, student_id, question_index, answer_text, review_status, review_result, submitted_at, reviewed_at')
        .eq('blog_id', blogId)
        .eq('student_id', studentId)
        .order('question_index', { ascending: true });
    if (error) {
        console.error('加载学生提交失败:', error);
        return [];
    }
    return Array.isArray(data) ? data : [];
}

function resetDetailState() {
    detailState.questionCount = 0;
    detailState.answerKeyMap = new Map();
    detailState.submissionMap = new Map();
    detailState.slotNodes = new Map();
    detailState.statusNodes = new Map();
    detailState.submitButton = null;
    detailState.actionStatus = null;
    detailState.contentVersion += 1;
}

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

function setActionStatus(text, type = '') {
    if (!detailState.actionStatus) return;
    detailState.actionStatus.textContent = text || '';
    detailState.actionStatus.className = `detail-action-status${type ? ` is-${type}` : ''}`;
}

function buildStudyStatusText(submission) {
    if (!submission) return '未提交';
    if (submission.review_status !== 'reviewed') return '待批阅';
    if (submission.review_result === 'correct') return '正确';
    if (submission.review_result === 'partial') return '半对';
    if (submission.review_result === 'wrong') return '错误';
    return '已批阅';
}

function isSubmissionReviewed(submission) {
    return Boolean(submission && submission.review_status === 'reviewed');
}

function createPill(text, className = '') {
    const span = document.createElement('span');
    span.className = `question-pill${className ? ` ${className}` : ''}`;
    span.textContent = text;
    return span;
}

function createIconButton(iconClass, text, className) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `question-icon-btn ${className}`;
    button.innerHTML = `<i class="${iconClass}"></i><span class="sr-only">${escapeHtml(text)}</span>`;
    button.title = text;
    return button;
}

function renderStudySlot(slotIndex) {
    const wrapper = document.createElement('div');
    wrapper.className = 'question-card question-card-study';
    wrapper.dataset.questionIndex = String(slotIndex);

    const header = document.createElement('div');
    header.className = 'question-card-header';

    const textarea = document.createElement('textarea');
    textarea.className = 'question-textarea question-textarea-study';
    textarea.rows = 3;
    textarea.placeholder = '在这里填写答案';

    const submission = detailState.submissionMap.get(slotIndex);
    const answerKey = detailState.answerKeyMap.get(slotIndex);
    const isReviewed = submission && submission.review_status === 'reviewed';
    const originalAnswer = submission ? submission.answer_text : '';

    if (submission) {
        textarea.value = originalAnswer;
        if (isReviewed) {
            textarea.readOnly = true;
            textarea.classList.add('is-locked');
        }
    }

    const footer = document.createElement('div');
    footer.className = 'question-card-footer question-card-footer-between';

    const status = createPill(
        buildStudyStatusText(submission),
        isReviewed ? `is-${submission.review_result || 'reviewed'}` : 'is-waiting'
    );
    footer.appendChild(status);
    detailState.statusNodes.set(slotIndex, status);

    const actionButton = document.createElement('button');
    actionButton.type = 'button';
    actionButton.className = 'question-action-btn';

    if (isReviewed) {
        // 已批阅 → 查看答案 / 查看作答 切换
        let showingAnswer = false;
        actionButton.innerHTML = '<i class="fas fa-eye"></i><span>查看答案</span>';
        actionButton.addEventListener('click', function (e) {
            e.preventDefault();
            if (!showingAnswer) {
                const answerText = (answerKey && answerKey.answer_text) || '（未设置标准答案）';
                textarea.value = answerText;
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
        // 未批阅 → 提交已做（提交所有非空题目）
        actionButton.innerHTML = '<i class="fas fa-paper-plane"></i><span>提交已做</span>';
        actionButton.addEventListener('click', async function () {
            this.disabled = true;
            const ok = await persistStudyAnswers({ silent: false }); // 不传 targetSlotIndex，提交全部
            this.disabled = false;
            if (ok) {
                await initDetail();
            }
        });
    }

    footer.appendChild(actionButton);
    wrapper.appendChild(header);
    wrapper.appendChild(textarea);
    wrapper.appendChild(footer);

    detailState.slotNodes.set(slotIndex, { wrapper, textarea, status, mode: 'study' });
    return wrapper;
}

function renderReviewSlot(slotIndex) {
    const wrapper = document.createElement('div');
    wrapper.className = 'question-card question-card-review';
    wrapper.dataset.questionIndex = String(slotIndex);

    const submission = detailState.submissionMap.get(slotIndex);
    const answerKey = detailState.answerKeyMap.get(slotIndex); // 获取参考答案

    const header = document.createElement('div');
    header.className = 'question-card-header';
    header.innerHTML = `<span class="question-card-title">题目</span>`;

    // 学生答案（只读）
    const answerBox = document.createElement('textarea');
    answerBox.className = 'question-textarea question-textarea-review';
    answerBox.rows = 3;
    answerBox.readOnly = true;
    answerBox.value = submission?.answer_text ?? '学生尚未提交';

    // ---------- 新增：参考答案显示区域 ----------
    const referenceWrapper = document.createElement('div');
    referenceWrapper.className = 'question-reference-wrapper';

    const referenceLabel = document.createElement('span');
    referenceLabel.className = 'question-reference-label';
    referenceLabel.textContent = '📖 参考答案：';

    const referenceText = document.createElement('div');
    referenceText.className = 'question-reference-text';
    const keyText = (answerKey && answerKey.answer_text) || '（未设置参考答案）';
    referenceText.textContent = keyText;

    referenceWrapper.appendChild(referenceLabel);
    referenceWrapper.appendChild(referenceText);
    // -----------------------------------------

    const toolbar = document.createElement('div');
    toolbar.className = 'question-review-toolbar';

    const gradeLabel = document.createElement('span');
    gradeLabel.className = 'question-review-label';
    gradeLabel.textContent = submission?.review_status === 'reviewed' ? '当前批阅结果' : '点击按钮批阅';

    const correctBtn = createIconButton('fas fa-check-circle', '正确', 'is-correct');
    const partialBtn = createIconButton('fas fa-adjust', '半对', 'is-partial');
    const wrongBtn = createIconButton('fas fa-times-circle', '错误', 'is-wrong');

    const status = createPill(
        buildStudyStatusText(submission),
        submission?.review_status === 'reviewed' ? `is-${submission.review_result || 'reviewed'}` : 'is-waiting'
    );
    detailState.statusNodes.set(slotIndex, status);

    toolbar.appendChild(gradeLabel);
    toolbar.appendChild(status);
    toolbar.appendChild(correctBtn);
    toolbar.appendChild(partialBtn);
    toolbar.appendChild(wrongBtn);

    wrapper.appendChild(header);
    wrapper.appendChild(answerBox);
    wrapper.appendChild(referenceWrapper); // 参考答案放在学生答案下方
    wrapper.appendChild(toolbar);

    detailState.slotNodes.set(slotIndex, { wrapper, answerBox, status, mode: 'review', correctBtn, partialBtn, wrongBtn });
    return wrapper;
}

function renderAnswerSlot(slotIndex) {
    const wrapper = document.createElement('div');
    wrapper.className = 'question-card question-card-answer';
    wrapper.dataset.questionIndex = String(slotIndex);

    const key = detailState.answerKeyMap.get(slotIndex) || { answer_text: '', auto_grade: false };

    const header = document.createElement('div');
    header.className = 'question-card-header';
    header.innerHTML = `<span class="question-card-title">题目 ${slotIndex}</span>`;

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

    footer.appendChild(status);
    footer.appendChild(autoWrap);

    wrapper.appendChild(header);
    wrapper.appendChild(textarea);
    wrapper.appendChild(footer);

    detailState.slotNodes.set(slotIndex, { wrapper, textarea, status, autoWrap, mode: 'answer' });
    detailState.statusNodes.set(slotIndex, status);
    return wrapper;
}

function normalizeModeResult(result) {
    if (result === 'correct' || result === 'partial' || result === 'wrong') return result;
    return null;
}

async function persistStudyAnswers({ silent = false, targetSlotIndex = null } = {}) {
    if (!detailState.blogId || !detailState.studentId) {
        if (!silent) setActionStatus('当前文章没有可用的学生身份，无法提交', 'error');
        return false;
    }
    const rows = [];
    const now = new Date().toISOString();

    detailState.slotNodes.forEach((node, slotIndex) => {
        if (targetSlotIndex && Number(targetSlotIndex) !== Number(slotIndex)) return;
        const submission = detailState.submissionMap.get(slotIndex);
        if (submission && submission.review_status === 'reviewed') return;
        const answer = node.textarea ? node.textarea.value : '';

        const answerKey = detailState.answerKeyMap.get(slotIndex);
        const autoGradeEnabled = Boolean(answerKey && answerKey.auto_grade && (answerKey.answer_text ?? '') !== '');
        if (autoGradeEnabled && answer.trim() === '') return;
        if (!submission && answer.trim() === '' && !autoGradeEnabled) return;
        let reviewStatus = 'pending';
        let reviewResult = null;
        let reviewedAt = null;

        if (autoGradeEnabled) {
            reviewStatus = 'reviewed';
            reviewResult = normalizeLineBreaks(answer) === normalizeLineBreaks(answerKey.answer_text) ? 'correct' : 'wrong';
            reviewedAt = now;
        }

        rows.push({
            blog_id: detailState.blogId,
            student_id: detailState.studentId,
            question_index: slotIndex,
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
        .upsert(rows, { onConflict: 'blog_id,student_id,question_index' });

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
    detailState.slotNodes.forEach((node, slotIndex) => {
        const answerText = node.textarea ? node.textarea.value : '';
        const autoGrade = Boolean(node.autoWrap && node.autoWrap.querySelector('input[type="checkbox"]')?.checked);
        rows.push({
            blog_id: detailState.blogId,
            question_index: slotIndex,
            answer_text: answerText,
            auto_grade: autoGrade
        });
    });

    if (!rows.length) {
        if (!silent) setActionStatus('没有可保存的答案设置', 'info');
        return true;
    }

    const { error } = await supabase
        .from('article_answer_keys')
        .upsert(rows, { onConflict: 'blog_id,question_index' });

    if (error) {
        console.error('保存答案设置失败:', error);
        if (!silent) setActionStatus('保存失败，请稍后重试', 'error');
        return false;
    }

    if (!silent) setActionStatus('答案已保存', 'success');
    return true;
}

async function persistReviewResult(slotIndex, reviewResult) {
    if (!detailState.blogId || !detailState.studentId) {
        setActionStatus('请先从管理员页面选择学生后再批阅', 'error');
        return false;
    }
    const submission = detailState.submissionMap.get(slotIndex) || {};
    const now = new Date().toISOString();
    const { error } = await supabase
        .from('article_question_submissions')
        .upsert([
            {
                blog_id: detailState.blogId,
                student_id: detailState.studentId,
                question_index: slotIndex,
                answer_text: submission.answer_text ?? '',
                review_status: 'reviewed',
                review_result: reviewResult,
                submitted_at: submission.submitted_at || now,
                reviewed_at: now
            }
        ], { onConflict: 'blog_id,student_id,question_index' });

    if (error) {
        console.error('保存批阅结果失败:', error);
        setActionStatus('批阅保存失败，请重试', 'error');
        return false;
    }

    detailState.submissionMap.set(slotIndex, {
        blog_id: detailState.blogId,
        student_id: detailState.studentId,
        question_index: slotIndex,
        answer_text: submission.answer_text ?? '',
        review_status: 'reviewed',
        review_result: reviewResult,
        submitted_at: submission.submitted_at || now,
        reviewed_at: now
    });

    const status = detailState.statusNodes.get(slotIndex);
    if (status) {
        status.textContent = buildStudyStatusText(detailState.submissionMap.get(slotIndex));
        status.className = `question-pill is-${reviewResult}`;
    }

    setActionStatus('批阅已保存', 'success');
    return true;
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

// 详情页初始化（支持 学习 / 批阅 / 设置答案）
async function initDetail() {
    resetDetailState();
    const mode = getDetailMode();
    detailState.mode = mode;

    // 获取悬浮球元素
    const fabBtn = document.getElementById('fab-submit');
    if (fabBtn) {
        fabBtn.style.display = 'none';
        fabBtn.disabled = false;
        // 移除旧的事件监听（通过克隆替换）
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
    detailState.studentId = getQueryParam('studentId') ? Number(getQueryParam('studentId')) : null;

    if (mode === 'study') {
        const user = getCurrentUser();
        if (!user) {
            container.innerHTML = `
                <div class="empty-tip">
                    请先 <a href="index.html" style="color: var(--teal-dark);">登录</a> 后查看。
                </div>
            `;
            return;
        }
        if (!hasPermission(id)) {
            container.innerHTML = `<div class="empty-tip">您没有权限查看此文章。<br><a href="index.html" style="color: var(--teal-dark);">返回首页</a></div>`;
            return;
        }
        const numericUserId = Number(user.id);
        if (Number.isFinite(numericUserId)) {
            detailState.studentId = numericUserId;
        }
    }

    const content = await loadMarkdownContent(blog.path);
    const slotResult = injectQuestionSlots(content);
    detailState.questionCount = slotResult.questionCount;

    document.querySelector('.detail-title').textContent = blog.title;
    document.title = `${blog.title}${mode === 'study' ? '' : ` · ${mode === 'review' ? '批阅' : '答案设置'}`}`;

    const modeLabel = mode === 'study' ? '阅读' : mode === 'review' ? '批阅' : '设置答案';
    document.querySelector('.detail-meta').innerHTML = `
        <span class="series-badge">📂 ${blog.series}</span>
        ${blog.path ? `<span class="path-badge">📁 ${blog.path.replace(/\\/g, '/')}</span>` : ''}
        <span class="mode-badge is-${mode}">${modeLabel}</span>
    `;

    const isDesktop = window.innerWidth >= 1024;
    const body = document.querySelector('.detail-body');
    body.innerHTML = renderMarkdownWithSidebar(slotResult.markdown, isDesktop);

    const actions = getDetailHeaderActions();
    if (actions) {
        actions.innerHTML = '';
        const status = document.createElement('span');
        status.className = 'detail-action-status';
        detailState.actionStatus = status;
        actions.appendChild(status);

        if (mode === 'study') {
            // 创建提交处理函数（顶部按钮和悬浮球共用）
            const submitHandler = async () => {
                const topBtn = document.querySelector('.detail-action-btn.primary');
                const fab = document.getElementById('fab-submit');
                if (topBtn) topBtn.disabled = true;
                if (fab) fab.disabled = true;
                const ok = await persistStudyAnswers({ silent: false });
                if (topBtn) topBtn.disabled = false;
                if (fab) fab.disabled = false;
                if (ok) {
                    await initDetail();
                }
            };

            // 顶部按钮
            const submitBtn = document.createElement('button');
            submitBtn.type = 'button';
            submitBtn.className = 'detail-action-btn primary';
            submitBtn.innerHTML = '<i class="fas fa-paper-plane"></i><span>提交作业</span>';
            detailState.submitButton = submitBtn;
            submitBtn.addEventListener('click', submitHandler);
            actions.appendChild(submitBtn);

            // 悬浮球
            const fab = document.getElementById('fab-submit');
            if (fab) {
                fab.style.display = 'flex';
                fab.innerHTML = '<i class="fas fa-paper-plane">提交作业</i>';
                fab.title = '提交作业';
                fab.addEventListener('click', submitHandler);
            }
        } else if (mode === 'answer') {
            // 创建保存处理函数（顶部按钮和悬浮球共用）
            const saveHandler = async () => {
                const topBtn = document.querySelector('.detail-action-btn.primary');
                const fab = document.getElementById('fab-submit');
                if (topBtn) topBtn.disabled = true;
                if (fab) fab.disabled = true;
                const ok = await persistAnswerKeys({ silent: false });
                if (topBtn) topBtn.disabled = false;
                if (fab) fab.disabled = false;
                if (ok) {
                    await initDetail();
                }
            };

            // 顶部按钮
            const saveBtn = document.createElement('button');
            saveBtn.type = 'button';
            saveBtn.className = 'detail-action-btn primary';
            saveBtn.innerHTML = '<i class="fas fa-save"></i><span>保存答案</span>';
            detailState.submitButton = saveBtn;
            saveBtn.addEventListener('click', saveHandler);
            actions.appendChild(saveBtn);

            // 悬浮球
            const fab = document.getElementById('fab-submit');
            if (fab) {
                fab.style.display = 'flex';
                fab.innerHTML = '<i class="fas fa-save">保存答案</i>';
                fab.title = '保存答案';
                fab.addEventListener('click', saveHandler);
            }
        } else {
            // 批阅模式：隐藏悬浮球
            const fab = document.getElementById('fab-submit');
            if (fab) {
                fab.style.display = 'none';
            }
            const reviewTag = document.createElement('span');
            reviewTag.className = 'detail-mode-tag';
            reviewTag.textContent = `学生 ${detailState.studentId ? detailState.studentId : '未指定'}`;
            actions.appendChild(reviewTag);
        }
    }

    detailState.answerKeyMap = new Map();
    detailState.submissionMap = new Map();

    if (mode === 'study' || mode === 'review' || mode === 'answer') {
        const answerKeys = await loadQuestionAnswerKeys(id);
        answerKeys.forEach(item => {
            detailState.answerKeyMap.set(Number(item.question_index), item);
        });
    }

    if (mode === 'study' || mode === 'review') {
        const studentId = Number(getQueryParam('studentId') || detailState.studentId || 0);
        if (studentId) {
            const submissions = await loadQuestionSubmissions(id, studentId);
            submissions.forEach(item => {
                detailState.submissionMap.set(Number(item.question_index), item);
            });
            detailState.studentId = studentId;
        }
    }

    const unreviewedCount = Array.from(detailState.submissionMap.values()).filter(item => item.review_status !== 'reviewed').length;
    if (mode === 'review' && unreviewedCount > 0) {
        document.querySelector('.detail-meta').insertAdjacentHTML('beforeend', `<span class="mode-badge is-warning">待批阅 ${unreviewedCount} 题</span>`);
    }

    const slotElements = Array.from(body.querySelectorAll('.question-slot'));
    slotElements.forEach(slotEl => {
        const slotIndex = Number(slotEl.dataset.questionIndex);
        let node = null;
        if (mode === 'study') {
            node = renderStudySlot(slotIndex);
        } else if (mode === 'review') {
            node = renderReviewSlot(slotIndex);
        } else {
            node = renderAnswerSlot(slotIndex);
        }
        slotEl.replaceWith(node);
    });

    if (mode === 'review') {
        detailState.slotNodes.forEach((node, slotIndex) => {
            if (!node.correctBtn || !node.partialBtn || !node.wrongBtn) return;
            node.correctBtn.addEventListener('click', () => persistReviewResult(slotIndex, 'correct'));
            node.partialBtn.addEventListener('click', () => persistReviewResult(slotIndex, 'partial'));
            node.wrongBtn.addEventListener('click', () => persistReviewResult(slotIndex, 'wrong'));
        });
    }

    if (mode === 'answer') {
        detailState.slotNodes.forEach((node, slotIndex) => {
            if (!node.textarea) return;
            node.textarea.addEventListener('input', () => {
                const existing = detailState.answerKeyMap.get(slotIndex) || { blog_id: id, question_index: slotIndex, answer_text: '', auto_grade: false };
                detailState.answerKeyMap.set(slotIndex, {
                    ...existing,
                    answer_text: node.textarea.value
                });
            });
            if (node.autoWrap) {
                const checkbox = node.autoWrap.querySelector('input[type="checkbox"]');
                if (checkbox) {
                    checkbox.addEventListener('change', () => {
                        const existing = detailState.answerKeyMap.get(slotIndex) || { blog_id: id, question_index: slotIndex, answer_text: '', auto_grade: false };
                        detailState.answerKeyMap.set(slotIndex, {
                            ...existing,
                            auto_grade: checkbox.checked
                        });
                        const pill = detailState.statusNodes.get(slotIndex);
                        if (pill) {
                            pill.textContent = checkbox.checked ? '自动批阅已开启' : '自动批阅关闭';
                            pill.className = `question-pill ${checkbox.checked ? 'is-auto' : 'is-muted'}`;
                        }
                    });
                }
            }
        });
    }

    if (mode === 'study' || mode === 'answer') {
        const autoSaveHandler = async () => {
            if (mode === 'study') {
                await persistStudyAnswers({ silent: true });
            } else {
                await persistAnswerKeys({ silent: true });
            }
        };
        window.addEventListener('pagehide', autoSaveHandler, { once: true });
    }

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