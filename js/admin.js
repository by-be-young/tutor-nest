/**
 * admin.js - 管理员页面逻辑
 * 职责：权限管理、批阅中心、答案设置
 * 依赖：supabase-client.js, auth.js
 */

import { supabase } from './supabase-client.js';
import { logout } from './auth.js';

// ================================================================
// 一、状态管理
// ================================================================

/** 所有学生列表 */
let allStudents = [];

/** 当前选中的学生ID（权限管理用） */
let currentStudentId = null;

/** 当前选中的科目（权限管理用） */
let currentSubject = null;

/** 权限是否已修改（未保存） */
let permissionDirty = false;

/** 所有文章数据 */
let blogData = [];

/** 所有科目列表 */
let allSubjects = [];

/** 当前选中的学生ID（批阅中心用） */
let currentReviewStudentId = null;

/** 当前选中的科目（批阅中心用） */
let currentReviewSubject = null;

/** 当前选中的科目（答案设置用） */
let currentAnswerSubject = null;

/** 权限筛选状态：'unauthorized' | 'authorized' | 'all' */
let permissionFilter = 'unauthorized';

/** 批阅筛选状态：'pending' | 'reviewed' | 'noneed' */
let reviewFilter = 'pending';

/** 答案筛选状态：'unset' | 'set' | 'noneed' */
let answerFilter = 'unset';

// ================================================================
// 二、缓存数据
// ================================================================

/** 文章是否有题目：Map<blogId, boolean> */
let articleHasQuestions = new Map();

/** 文章是否已设置答案：Map<blogId, boolean> */
let articleAnswerKeys = new Map();

/** 当前学生的提交状态：Map<blogId, 'pending' | 'reviewed'> */
let studentSubmissions = new Map();

// ================================================================
// 三、DOM 引用
// ================================================================

const studentSelect = document.getElementById('admin-student-select');
const studentNameDisplay = document.getElementById('admin-current-student');
const sidebarStudent = document.getElementById('admin-sidebar-student');
const treeContainer = document.getElementById('admin-permission-tree');
const saveBtn = document.getElementById('admin-save-btn');
const addStudentBtn = document.getElementById('admin-add-student-btn');
const logoutBtn = document.getElementById('admin-logout-btn');
const sidebarBtns = Array.from(document.querySelectorAll('.admin-sidebar-btn'));

const permissionPanel = document.getElementById('permission-panel');
const reviewPanel = document.getElementById('review-panel');
const answerPanel = document.getElementById('answer-panel');

const reviewTreeContainer = document.getElementById('admin-review-tree');
const answerTreeContainer = document.getElementById('admin-answer-tree');

// ================================================================
// 四、工具函数
// ================================================================

/**
 * 切换当前激活的面板
 * @param {string} panelId - 面板ID
 */
function setActivePanel(panelId) {
    sidebarBtns.forEach(btn => {
        btn.classList.toggle('is-active', btn.dataset.panel === panelId);
    });
    [permissionPanel, reviewPanel, answerPanel].forEach(p => {
        if (p) p.classList.toggle('is-active', p.id === panelId);
    });
}

/**
 * 打开详情页面
 * @param {string} mode - 模式：'review' | 'answer'
 * @param {number} blogId - 文章ID
 * @param {number|string} [studentId=''] - 学生ID（批阅模式需要）
 */
function openDetailPage(mode, blogId, studentId = '') {
    const params = new URLSearchParams({ mode, id: blogId });
    if (studentId) params.set('studentId', studentId);
    window.location.href = `detail.html?${params}`;
}

// ================================================================
// 五、科目按钮组渲染
// ================================================================

/**
 * 渲染科目按钮组
 * @param {string} containerId - 容器ID
 * @param {string[]} subjects - 科目列表
 * @param {string} current - 当前选中科目
 * @param {Function} onSelect - 选中回调
 */
function renderSubjectButtons(containerId, subjects, current, onSelect) {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.innerHTML = '';
    container.className = 'subject-btn-group';
    subjects.forEach(subject => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = `subject-btn${subject === current ? ' is-active' : ''}`;
        btn.textContent = subject;
        btn.dataset.subject = subject;
        btn.addEventListener('click', function () {
            container.querySelectorAll('.subject-btn').forEach(b => b.classList.remove('is-active'));
            this.classList.add('is-active');
            if (onSelect) onSelect(subject);
        });
        container.appendChild(btn);
    });
}

// ================================================================
// 六、树渲染函数（复用 main.js 逻辑）
// ================================================================

/**
 * 构建树结构
 * @param {Array} blogs - 文章列表
 * @returns {Object} 树根节点
 */
function buildTree(blogs) {
    const root = { children: [] };
    blogs.forEach(blog => {
        const parts = blog.path.split('/');
        const dirParts = parts.slice(1);
        const title = blog.title;
        let current = root;
        for (let i = 0; i < dirParts.length; i++) {
            const part = dirParts[i];
            const isLast = i === dirParts.length - 1;
            const isFile = isLast && (part.endsWith('.md') || part.endsWith('.html'));
            if (isFile) {
                const existing = current.children.find(c => c.name === title && c.isFile);
                if (!existing) {
                    current.children.push({
                        name: title,
                        isFile: true,
                        blogId: blog.id,
                        date: blog.date,
                        series: blog.series,
                        path: blog.path
                    });
                }
            } else {
                let dirNode = current.children.find(c => c.name === part && !c.isFile);
                if (!dirNode) {
                    dirNode = { name: part, isFile: false, children: [] };
                    current.children.push(dirNode);
                }
                current = dirNode;
            }
        }
    });
    // 递归排序：文件夹在前，文件在后
    function sortNode(node) {
        if (!node.children) return;
        node.children.sort((a, b) => {
            if (a.isFile !== b.isFile) return a.isFile ? 1 : -1;
            return a.name.localeCompare(b.name);
        });
        node.children.forEach(c => { if (!c.isFile) sortNode(c); });
    }
    sortNode(root);
    return root;
}

/**
 * 渲染可点击的树（用于批阅和答案）
 * @param {Array} children - 子节点列表
 * @param {number} depth - 当前深度
 * @param {Map} badgeMap - 徽章数据 Map<blogId, count>
 * @returns {string} HTML字符串
 */
function renderClickableTree(children, depth = 0, badgeMap = new Map()) {
    if (!children || children.length === 0) return '';
    let html = '';
    children.forEach(node => {
        const indent = depth * 20;
        const padding = `padding-left: ${indent + 8}px;`;
        if (node.isFile) {
            const pending = badgeMap.get(Number(node.blogId)) || 0;
            const badgeHtml = pending > 0 ? `<span class="tree-badge is-warning">待批阅 ${pending}</span>` : '';
            html += `
                <div class="tree-item tree-file tree-clickable" style="${padding}" data-id="${node.blogId}">
                    <span class="file-icon"><i class="fas fa-file-alt"></i></span>
                    <span class="file-name">${node.name}</span>
                    ${badgeHtml}
                    <span class="file-arrow"><i class="fas fa-chevron-right"></i></span>
                </div>
            `;
        } else {
            html += `
                <div class="tree-folder-wrapper" style="${padding}">
                    <div class="tree-item tree-folder">
                        <span class="folder-icon"><i class="fas fa-folder"></i></span>
                        <span class="folder-name">${node.name}</span>
                        <span class="folder-count">(${node.children.filter(c => c.isFile).length})</span>
                    </div>
                    <div class="tree-children" style="padding-left: 20px;">
                        ${renderClickableTree(node.children, depth + 1, badgeMap)}
                    </div>
                </div>
            `;
        }
    });
    return html;
}

/**
 * 渲染带复选框的树（权限管理）
 * @param {Array} children - 子节点列表
 * @param {number[]} permissions - 当前学生的权限列表
 * @param {number} depth - 当前深度
 * @returns {string} HTML字符串
 */
function renderTreeWithCheckboxes(children, permissions, depth) {
    if (!children || children.length === 0) return '';
    let html = '';
    children.forEach(node => {
        const indent = depth * 20;
        const padding = `padding-left: ${indent + 8}px;`;
        if (node.isFile) {
            const checked = permissions.includes(node.blogId) ? 'checked' : '';
            html += `
                <div class="tree-item tree-file" style="${padding}">
                    <span class="file-icon"><i class="fas fa-file-alt"></i></span>
                    <span class="file-name">${node.name}</span>
                    <label class="perm-checkbox-label">
                        <input type="checkbox" class="perm-checkbox" data-id="${node.blogId}" ${checked}>
                        <span>授权</span>
                    </label>
                </div>
            `;
        } else {
            html += `
                <div class="tree-folder-wrapper" style="${padding}">
                    <div class="tree-item tree-folder">
                        <span class="folder-icon"><i class="fas fa-folder"></i></span>
                        <span class="folder-name">${node.name}</span>
                        <span class="folder-count">(${node.children.filter(c => c.isFile).length})</span>
                    </div>
                    <div class="tree-children" style="padding-left: 20px;">
                        ${renderTreeWithCheckboxes(node.children, permissions, depth + 1)}
                    </div>
                </div>
            `;
        }
    });
    return html;
}

// ================================================================
// 七、数据加载
// ================================================================

/**
 * 加载学生列表
 * @returns {Promise<Array>} 学生列表
 */
async function loadStudents() {
    const { data, error } = await supabase
        .from('student')
        .select('id, username, permissions')
        .order('username');
    if (error) {
        console.error('加载学生列表失败:', error);
        alert('加载学生列表失败，请刷新重试');
        return [];
    }
    return data || [];
}

/**
 * 从文章数据中提取科目列表
 * @param {Array} blogs - 文章列表
 * @returns {string[]} 科目列表
 */
function extractSubjects(blogs) {
    const subjects = new Set();
    blogs.forEach(blog => { if (blog.series) subjects.add(blog.series); });
    return Array.from(subjects).sort();
}

/**
 * 加载文章数据
 * @returns {Promise<void>}
 */
async function loadBlogData() {
    try {
        const res = await fetch('data/blogs.json');
        if (!res.ok) throw new Error('加载文章数据失败');
        blogData = await res.json();
        allSubjects = extractSubjects(blogData);
    } catch (e) {
        console.error(e);
        blogData = [];
    }
}

/**
 * 获取指定科目的文章列表
 * @param {string} subject - 科目名称
 * @returns {Array} 文章列表
 */
function getBlogsBySubject(subject) {
    return subject ? blogData.filter(b => b.series === subject) : [];
}

// ================================================================
// 八、缓存数据加载
// ================================================================

/**
 * 检测文章是否包含题目标记
 * 通过读取 .md 文件内容检测 【@】 或 [@] 标记
 * @returns {Promise<void>}
 */
async function loadArticleHasQuestions() {
    for (const blog of blogData) {
        if (articleHasQuestions.has(blog.id)) continue;
        try {
            const path = blog.path.replace(/^\//, '');
            const url = `blogs/${path}`;
            const res = await fetch(url);
            if (!res.ok) continue;
            const text = await res.text();
            const has = /\[@|【@】/.test(text);
            articleHasQuestions.set(blog.id, has);
        } catch (e) {
            articleHasQuestions.set(blog.id, false);
        }
    }
}

/**
 * 加载所有文章的答案设置状态
 * @returns {Promise<void>}
 */
async function loadAnswerKeys() {
    const { data, error } = await supabase
        .from('article_answer_keys')
        .select('blog_id');
    if (error) {
        console.error('加载答案设置失败:', error);
        return;
    }
    articleAnswerKeys.clear();
    (data || []).forEach(item => articleAnswerKeys.set(Number(item.blog_id), true));
}

/**
 * 加载指定学生的提交记录状态
 * @param {number|string} studentId - 学生ID
 * @returns {Promise<void>}
 */
async function loadStudentSubmissions(studentId) {
    if (!studentId) {
        studentSubmissions.clear();
        return;
    }
    const { data, error } = await supabase
        .from('article_question_submissions')
        .select('blog_id, review_status')
        .eq('student_id', studentId);
    if (error) {
        console.error('加载提交记录失败:', error);
        return;
    }
    const statusMap = new Map();
    (data || []).forEach(item => {
        const blogId = Number(item.blog_id);
        const status = item.review_status;
        // 只要有一条 pending 就视为待批阅
        if (!statusMap.has(blogId) || status === 'pending') {
            statusMap.set(blogId, status);
        }
    });
    studentSubmissions = statusMap;
}

// ================================================================
// 九、权限管理
// ================================================================

/**
 * 更新保存按钮状态
 */
function updateSaveButton() {
    if (saveBtn) {
        saveBtn.disabled = !permissionDirty;
        saveBtn.innerHTML = permissionDirty ? '<i class="fas fa-save"></i> 保存权限' : '<i class="fas fa-check"></i> 已保存';
    }
}

/** 权限复选框变更事件处理函数 */
let onPermCheckChange = function () {
    permissionDirty = true;
    updateSaveButton();
};

/**
 * 切换学生（权限管理 + 批阅中心同步）
 * @param {number|string} studentId - 学生ID
 * @returns {Promise<void>}
 */
async function switchStudent(studentId) {
    currentStudentId = studentId;
    const student = allStudents.find(s => Number(s.id) === Number(studentId));
    if (student) {
        studentNameDisplay.textContent = student.username;
        sidebarStudent.textContent = `学生：${student.username}`;
        studentSelect.value = studentId;
        currentSubject = null;
        const permContainer = document.getElementById('admin-permission-subject-buttons');
        if (permContainer) {
            permContainer.querySelectorAll('.subject-btn').forEach(b => b.classList.remove('is-active'));
        }
        treeContainer.innerHTML = '<p class="tree-placeholder">请选择科目</p>';
        permissionDirty = false;
        updateSaveButton();

        // 加载该学生的提交记录
        await loadStudentSubmissions(studentId);

        // 同步更新批阅中心的学生ID
        currentReviewStudentId = Number(studentId);

        // 如果已选科目，刷新批阅树
        if (currentReviewSubject) {
            renderReviewTree(currentReviewStudentId, currentReviewSubject, reviewFilter);
        } else {
            reviewTreeContainer.innerHTML = '<p class="tree-placeholder">请先选择科目</p>';
        }

        // 如果已选科目，刷新权限树
        if (currentSubject) {
            renderPermissionTree(currentStudentId, currentSubject, permissionFilter);
        }
    }
}

/**
 * 切换科目（权限管理）
 * @param {string} subject - 科目名称
 */
function switchSubject(subject) {
    currentSubject = subject;
    const student = allStudents.find(s => Number(s.id) === Number(currentStudentId));
    if (student) {
        renderPermissionTree(currentStudentId, subject, permissionFilter);
    }
    permissionDirty = false;
    updateSaveButton();
}

/**
 * 渲染权限管理树
 * @param {number|string} studentId - 学生ID
 * @param {string} subject - 科目名称
 * @param {string} filter - 筛选条件：'unauthorized' | 'authorized' | 'all'
 */
function renderPermissionTree(studentId, subject, filter) {
    if (!treeContainer) return;
    if (!blogData.length) {
        treeContainer.innerHTML = '<p>加载文章数据中...</p>';
        loadBlogData().then(() => renderPermissionTree(studentId, subject, filter));
        return;
    }
    if (!subject) {
        treeContainer.innerHTML = '<p class="tree-placeholder">请选择科目</p>';
        return;
    }
    const student = allStudents.find(s => Number(s.id) === Number(studentId));
    if (!student) {
        treeContainer.innerHTML = '<p class="tree-placeholder">请先选择学生</p>';
        return;
    }
    const permissions = student.permissions || [];
    let filteredBlogs = getBlogsBySubject(subject);

    // 应用筛选
    if (filter === 'authorized') {
        filteredBlogs = filteredBlogs.filter(b => permissions.includes(Number(b.id)));
    } else if (filter === 'unauthorized') {
        filteredBlogs = filteredBlogs.filter(b => !permissions.includes(Number(b.id)));
    }
    // 'all' 不过滤

    if (filteredBlogs.length === 0) {
        treeContainer.innerHTML = `<p class="tree-placeholder">该筛选条件下暂无文章</p>`;
        return;
    }

    const tree = buildTree(filteredBlogs);
    treeContainer.innerHTML = renderTreeWithCheckboxes(tree.children, permissions, 0);

    // 绑定复选框变更事件
    treeContainer.querySelectorAll('.perm-checkbox').forEach(cb => {
        cb.removeEventListener('change', onPermCheckChange);
        cb.addEventListener('change', onPermCheckChange);
    });
}

/**
 * 保存权限到数据库
 * @returns {Promise<void>}
 */
async function savePermissions() {
    if (!currentStudentId) {
        alert('请先选择学生');
        return;
    }
    const student = allStudents.find(s => Number(s.id) === Number(currentStudentId));
    const existing = Array.isArray(student?.permissions) ? student.permissions.map(Number).filter(Number.isFinite) : [];
    const currentBlogIds = getBlogsBySubject(currentSubject).map(b => Number(b.id)).filter(Number.isFinite);
    const checked = treeContainer.querySelectorAll('.perm-checkbox:checked');
    const selected = Array.from(checked).map(cb => Number(cb.dataset.id)).filter(Number.isFinite);
    const merged = [...existing.filter(id => !currentBlogIds.includes(id)), ...selected];
    const permissions = Array.from(new Set(merged));

    const { error } = await supabase
        .from('student')
        .update({ permissions })
        .eq('id', currentStudentId);
    if (error) {
        console.error('保存权限失败:', error);
        alert('保存失败，请重试');
        return;
    }
    if (student) student.permissions = permissions;
    permissionDirty = false;
    updateSaveButton();
    alert('权限已保存');
    // 刷新当前树（权限已变，按筛选重新显示）
    renderPermissionTree(currentStudentId, currentSubject, permissionFilter);
}

/**
 * 新增学生
 * @returns {Promise<void>}
 */
async function addStudent() {
    const username = prompt('请输入新学生的姓名（用户名）:');
    if (!username || username.trim() === '') return;
    const { data, error } = await supabase
        .from('student')
        .insert([{ username: username.trim(), permissions: [] }])
        .select();
    if (error) {
        console.error('新增学生失败:', error);
        alert('新增失败，请重试');
        return;
    }
    if (data && data.length > 0) {
        allStudents.push(data[0]);
        populatePermissionStudentSelect(allStudents);
        studentSelect.value = data[0].id;
        await switchStudent(data[0].id);
        alert('新增学生成功！');
    }
}

/**
 * 填充学生下拉选择框
 * @param {Array} students - 学生列表
 */
function populatePermissionStudentSelect(students) {
    studentSelect.innerHTML = '<option value="">-- 切换学生 --</option>';
    students.forEach(s => {
        const opt = document.createElement('option');
        opt.value = s.id;
        opt.textContent = s.username;
        studentSelect.appendChild(opt);
    });
}

// ================================================================
// 十、批阅管理
// ================================================================

/**
 * 切换批阅学生
 * @param {number|string} studentId - 学生ID
 * @returns {Promise<void>}
 */
async function switchReviewStudent(studentId) {
    if (!studentId) studentId = currentStudentId;
    currentReviewStudentId = studentId ? Number(studentId) : null;
    const student = allStudents.find(s => Number(s.id) === currentReviewStudentId);
    if (sidebarStudent && student) {
        sidebarStudent.textContent = `学生：${student.username}`;
    }
    // 加载提交记录
    if (currentReviewStudentId) {
        await loadStudentSubmissions(currentReviewStudentId);
        renderReviewTree(currentReviewStudentId, currentReviewSubject, reviewFilter);
    } else {
        renderReviewTree(null, currentReviewSubject, reviewFilter);
    }
}

/**
 * 切换批阅科目
 * @param {string} subject - 科目名称
 */
function switchReviewSubject(subject) {
    currentReviewSubject = subject || null;
    const container = document.getElementById('admin-review-subject-buttons');
    if (container) {
        container.querySelectorAll('.subject-btn').forEach(b => {
            b.classList.toggle('is-active', b.dataset.subject === subject);
        });
    }
    renderReviewTree(currentReviewStudentId, subject, reviewFilter);
}

/**
 * 加载待批阅数量统计
 * @param {number|string} studentId - 学生ID
 * @param {number[]} blogIds - 文章ID列表
 * @returns {Promise<Map>} 待批阅数量 Map<blogId, count>
 */
async function loadPendingReviewCounts(studentId, blogIds) {
    if (!studentId || !Array.isArray(blogIds) || blogIds.length === 0) return new Map();
    const { data, error } = await supabase
        .from('article_question_submissions')
        .select('blog_id, review_status')
        .eq('student_id', studentId)
        .in('blog_id', blogIds);
    if (error) {
        console.error('加载待批阅统计失败:', error);
        return new Map();
    }
    const counts = new Map();
    (data || []).forEach(item => {
        if (item.review_status === 'reviewed') return;
        const blogId = Number(item.blog_id);
        counts.set(blogId, (counts.get(blogId) || 0) + 1);
    });
    return counts;
}

/**
 * 渲染批阅中心树
 * @param {number|string} studentId - 学生ID
 * @param {string} subject - 科目名称
 * @param {string} filter - 筛选条件：'pending' | 'reviewed' | 'noneed'
 */
function renderReviewTree(studentId, subject, filter) {
    if (!reviewTreeContainer) return;
    if (!studentId) {
        reviewTreeContainer.innerHTML = '<p class="tree-placeholder">请先选择学生</p>';
        return;
    }
    if (!subject) {
        reviewTreeContainer.innerHTML = '<p class="tree-placeholder">请先选择科目</p>';
        return;
    }
    const student = allStudents.find(s => Number(s.id) === Number(studentId));
    const permissionIds = new Set((student?.permissions || []).map(Number).filter(Number.isFinite));
    let filteredBlogs = getBlogsBySubject(subject).filter(b => permissionIds.has(Number(b.id)));

    // 应用筛选
    if (filter === 'pending') {
        filteredBlogs = filteredBlogs.filter(b => {
            const hasQ = articleHasQuestions.get(Number(b.id)) || false;
            const hasKey = articleAnswerKeys.has(Number(b.id));
            const submissionStatus = studentSubmissions.get(Number(b.id));
            return hasQ && hasKey && submissionStatus === 'pending';
        });
    } else if (filter === 'reviewed') {
        filteredBlogs = filteredBlogs.filter(b => {
            const hasQ = articleHasQuestions.get(Number(b.id)) || false;
            const hasKey = articleAnswerKeys.has(Number(b.id));
            const submissionStatus = studentSubmissions.get(Number(b.id));
            return hasQ && hasKey && submissionStatus === 'reviewed';
        });
    } else if (filter === 'noneed') {
        filteredBlogs = filteredBlogs.filter(b => {
            const hasQ = articleHasQuestions.get(Number(b.id)) || false;
            const hasKey = articleAnswerKeys.has(Number(b.id));
            // 无需批阅：没有设置答案 或 没有题目
            return !hasKey || !hasQ;
        });
    }

    if (filteredBlogs.length === 0) {
        reviewTreeContainer.innerHTML = '<p class="tree-placeholder">该筛选条件下暂无文章</p>';
        return;
    }

    const tree = buildTree(filteredBlogs);
    const blogIds = filteredBlogs.map(b => Number(b.id));
    loadPendingReviewCounts(studentId, blogIds).then(badgeMap => {
        if (!reviewTreeContainer) return;
        reviewTreeContainer.innerHTML = renderClickableTree(tree.children, 0, badgeMap);
    });
}

// ================================================================
// 十一、答案设置
// ================================================================

/**
 * 切换答案设置科目
 * @param {string} subject - 科目名称
 */
function switchAnswerSubject(subject) {
    currentAnswerSubject = subject || null;
    const container = document.getElementById('admin-answer-subject-buttons');
    if (container) {
        container.querySelectorAll('.subject-btn').forEach(b => {
            b.classList.toggle('is-active', b.dataset.subject === subject);
        });
    }
    renderAnswerTree(subject, answerFilter);
}

/**
 * 渲染答案设置树
 * @param {string} subject - 科目名称
 * @param {string} filter - 筛选条件：'unset' | 'set' | 'noneed'
 */
function renderAnswerTree(subject, filter) {
    if (!answerTreeContainer) return;
    if (!subject) {
        answerTreeContainer.innerHTML = '<p class="tree-placeholder">请先选择科目</p>';
        return;
    }
    let filteredBlogs = getBlogsBySubject(subject);

    if (filter === 'unset') {
        filteredBlogs = filteredBlogs.filter(b => {
            const hasQ = articleHasQuestions.get(Number(b.id)) || false;
            const hasKey = articleAnswerKeys.has(Number(b.id));
            return hasQ && !hasKey;
        });
    } else if (filter === 'set') {
        filteredBlogs = filteredBlogs.filter(b => {
            const hasQ = articleHasQuestions.get(Number(b.id)) || false;
            const hasKey = articleAnswerKeys.has(Number(b.id));
            return hasQ && hasKey;
        });
    } else if (filter === 'noneed') {
        filteredBlogs = filteredBlogs.filter(b => {
            const hasQ = articleHasQuestions.get(Number(b.id)) || false;
            return !hasQ;
        });
    }

    if (filteredBlogs.length === 0) {
        answerTreeContainer.innerHTML = '<p class="tree-placeholder">该筛选条件下暂无文章</p>';
        return;
    }

    const tree = buildTree(filteredBlogs);
    answerTreeContainer.innerHTML = renderClickableTree(tree.children, 0, new Map());
}

// ================================================================
// 十二、树交互（文件夹折叠/展开）
// ================================================================

/**
 * 处理树中文件夹点击事件（折叠/展开）
 * @param {Event} e - 点击事件
 * @returns {boolean} 是否已处理（是文件夹点击）
 */
function handleTreeFolderClick(e) {
    const folder = e.target.closest('.tree-folder');
    if (folder) {
        const wrapper = folder.closest('.tree-folder-wrapper');
        if (!wrapper) return false;
        const children = wrapper.querySelector('.tree-children');
        if (!children) return false;
        const hidden = children.style.display === 'none';
        children.style.display = hidden ? 'block' : 'none';
        return true;
    }
    return false;
}

// ================================================================
// 十三、页面初始化
// ================================================================

/**
 * 初始化管理员页面
 * @returns {Promise<void>}
 */
export async function initAdmin() {
    // 1. 加载数据
    await loadBlogData();
    allStudents = await loadStudents();

    // 2. 加载缓存数据
    await Promise.all([loadArticleHasQuestions(), loadAnswerKeys()]);

    // 3. 填充学生下拉框
    populatePermissionStudentSelect(allStudents);

    // 4. 渲染科目按钮
    // 4.1 权限管理 - 科目按钮
    const permContainer = document.getElementById('admin-permission-subject-buttons');
    if (permContainer && allSubjects.length > 0) {
        renderSubjectButtons('admin-permission-subject-buttons', allSubjects, allSubjects[0], (subject) => {
            if (currentStudentId) switchSubject(subject);
            else { currentSubject = subject; treeContainer.innerHTML = '<p class="tree-placeholder">请先选择学生</p>'; }
        });
        if (currentStudentId) switchSubject(allSubjects[0]);
        else currentSubject = allSubjects[0];
    }

    // 4.2 批阅管理 - 科目按钮
    const reviewContainer = document.getElementById('admin-review-subject-buttons');
    if (reviewContainer && allSubjects.length > 0) {
        renderSubjectButtons('admin-review-subject-buttons', allSubjects, allSubjects[0], switchReviewSubject);
        switchReviewSubject(allSubjects[0]);
    }

    // 4.3 答案设置 - 科目按钮
    const answerContainer = document.getElementById('admin-answer-subject-buttons');
    if (answerContainer && allSubjects.length > 0) {
        renderSubjectButtons('admin-answer-subject-buttons', allSubjects, allSubjects[0], switchAnswerSubject);
        switchAnswerSubject(allSubjects[0]);
    }

    // 5. 侧边栏切换事件
    sidebarBtns.forEach(btn => {
        btn.addEventListener('click', function () {
            setActivePanel(this.dataset.panel);
        });
    });
    setActivePanel('permission-panel');

    // 6. 默认选择第一个学生
    if (allStudents.length > 0) {
        // 先设置当前学生
        await switchStudent(allStudents[0].id);

        // 然后设置科目（触发树的渲染）
        if (allSubjects.length > 0) {
            // 权限科目
            const pc = document.getElementById('admin-permission-subject-buttons');
            if (pc) {
                pc.querySelectorAll('.subject-btn').forEach(b => {
                    b.classList.toggle('is-active', b.dataset.subject === allSubjects[0]);
                });
            }
            currentSubject = allSubjects[0];
            renderPermissionTree(currentStudentId, currentSubject, permissionFilter);

            // 批阅科目
            currentReviewSubject = allSubjects[0];
            if (currentReviewStudentId && currentReviewSubject) {
                renderReviewTree(currentReviewStudentId, currentReviewSubject, reviewFilter);
            }

            // 答案科目
            currentAnswerSubject = allSubjects[0];
            renderAnswerTree(currentAnswerSubject, answerFilter);
        }
    } else {
        studentNameDisplay.textContent = '无学生';
        sidebarStudent.textContent = '学生：无';
    }

    // 7. 绑定筛选按钮事件
    // 7.1 权限筛选
    const permFilterGroup = document.getElementById('permission-filter-group');
    if (permFilterGroup) {
        permFilterGroup.querySelectorAll('.subject-btn').forEach(btn => {
            btn.addEventListener('click', function () {
                permFilterGroup.querySelectorAll('.subject-btn').forEach(b => b.classList.remove('is-active'));
                this.classList.add('is-active');
                permissionFilter = this.dataset.filter;
                if (currentStudentId && currentSubject) {
                    renderPermissionTree(currentStudentId, currentSubject, permissionFilter);
                }
            });
        });
    }

    // 7.2 批阅筛选
    const reviewFilterGroup = document.getElementById('review-filter-group');
    if (reviewFilterGroup) {
        reviewFilterGroup.querySelectorAll('.subject-btn').forEach(btn => {
            btn.addEventListener('click', function () {
                reviewFilterGroup.querySelectorAll('.subject-btn').forEach(b => b.classList.remove('is-active'));
                this.classList.add('is-active');
                reviewFilter = this.dataset.filter;
                if (currentReviewStudentId && currentReviewSubject) {
                    renderReviewTree(currentReviewStudentId, currentReviewSubject, reviewFilter);
                }
            });
        });
    }

    // 7.3 答案筛选
    const answerFilterGroup = document.getElementById('answer-filter-group');
    if (answerFilterGroup) {
        answerFilterGroup.querySelectorAll('.subject-btn').forEach(btn => {
            btn.addEventListener('click', function () {
                answerFilterGroup.querySelectorAll('.subject-btn').forEach(b => b.classList.remove('is-active'));
                this.classList.add('is-active');
                answerFilter = this.dataset.filter;
                if (currentAnswerSubject) {
                    renderAnswerTree(currentAnswerSubject, answerFilter);
                }
            });
        });
    }

    // 8. 学生切换事件
    studentSelect.addEventListener('change', function () {
        const id = Number(this.value);
        if (id) {
            switchStudent(id);
            if (allSubjects.length > 0) {
                const pc = document.getElementById('admin-permission-subject-buttons');
                if (pc) {
                    pc.querySelectorAll('.subject-btn').forEach(b => {
                        b.classList.toggle('is-active', b.dataset.subject === allSubjects[0]);
                    });
                }
                switchSubject(allSubjects[0]);
                switchReviewSubject(allSubjects[0]);
            }
        } else {
            currentStudentId = null;
            studentNameDisplay.textContent = '未选择';
            sidebarStudent.textContent = '学生：未选择';
            treeContainer.innerHTML = '<p class="tree-placeholder">请先选择学生</p>';
            permissionDirty = false;
            updateSaveButton();
            reviewTreeContainer.innerHTML = '<p class="tree-placeholder">请先选择学生</p>';
        }
    });

    // 9. 树交互事件（文件夹折叠）
    // 权限树
    const permTree = document.getElementById('admin-permission-tree');
    if (permTree) {
        permTree.addEventListener('click', function (e) {
            if (handleTreeFolderClick(e)) return;
            // 权限树不处理文件点击跳转
        });
    }

    // 批阅树（文件夹折叠 + 文件跳转）
    if (reviewTreeContainer) {
        reviewTreeContainer.addEventListener('click', function (e) {
            if (handleTreeFolderClick(e)) return;
            const file = e.target.closest('.tree-clickable');
            if (file) {
                const id = Number(file.dataset.id);
                if (id && currentReviewStudentId) {
                    openDetailPage('review', id, currentReviewStudentId);
                }
            }
        });
    }

    // 答案树（文件夹折叠 + 文件跳转）
    if (answerTreeContainer) {
        answerTreeContainer.addEventListener('click', function (e) {
            if (handleTreeFolderClick(e)) return;
            const file = e.target.closest('.tree-clickable');
            if (file) {
                const id = Number(file.dataset.id);
                if (id) openDetailPage('answer', id);
            }
        });
    }

    // 10. 按钮事件
    if (saveBtn) saveBtn.addEventListener('click', savePermissions);
    if (addStudentBtn) addStudentBtn.addEventListener('click', addStudent);
    if (logoutBtn) {
        logoutBtn.addEventListener('click', function () {
            logout();
            window.location.href = 'index.html';
        });
    }

    // 11. 页面关闭前自动保存
    window.addEventListener('beforeunload', function () {
        if (permissionDirty) savePermissions();
    });

    // 12. 更新保存按钮状态
    updateSaveButton();
}

// ================================================================
// 十四、自动初始化
// ================================================================

// 检查是否存在权限面板，存在则自动初始化
if (document.getElementById('permission-panel')) {
    document.addEventListener('DOMContentLoaded', initAdmin);
}