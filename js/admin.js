/**
 * admin.js - 管理员页面逻辑
 * 职责：权限管理、批阅中心、答案设置
 * 依赖：main.js 中的 buildTree 和 renderClickableTree（复用树组件）
 */

import { supabase } from './supabase-client.js';
import { logout } from './auth.js';

// ---------- 状态 ----------
let allStudents = [];
let currentStudentId = null;
let currentSubject = null;
let permissionDirty = false;
let blogData = [];
let allSubjects = [];

let currentReviewStudentId = null;
let currentReviewSubject = null;
let currentAnswerSubject = null;

// ---------- DOM 引用 ----------
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

// ---------- 工具函数 ----------
function setActivePanel(panelId) {
    sidebarBtns.forEach(btn => {
        btn.classList.toggle('is-active', btn.dataset.panel === panelId);
    });
    [permissionPanel, reviewPanel, answerPanel].forEach(p => {
        if (p) p.classList.toggle('is-active', p.id === panelId);
    });
}

function openDetailPage(mode, blogId, studentId = '') {
    const params = new URLSearchParams({ mode, id: blogId });
    if (studentId) params.set('studentId', studentId);
    window.location.href = `detail.html?${params}`;
}

// ---------- 科目按钮组 ----------
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

// ---------- 树渲染（复用 main.js 的 buildTree，但这里重新实现以避免依赖） ----------
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
                    current.children.push({ name: title, isFile: true, blogId: blog.id, date: blog.date, series: blog.series, path: blog.path });
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

// ---------- 数据加载 ----------
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

function extractSubjects(blogs) {
    const subjects = new Set();
    blogs.forEach(blog => { if (blog.series) subjects.add(blog.series); });
    return Array.from(subjects).sort();
}

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

function getBlogsBySubject(subject) {
    return subject ? blogData.filter(b => b.series === subject) : [];
}

// ---------- 权限管理 ----------
function updateSaveButton() {
    if (saveBtn) {
        saveBtn.disabled = !permissionDirty;
        saveBtn.innerHTML = permissionDirty ? '<i class="fas fa-save"></i> 保存权限' : '<i class="fas fa-check"></i> 已保存';
    }
}

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
    }
}

function switchSubject(subject) {
    currentSubject = subject;
    const student = allStudents.find(s => Number(s.id) === Number(currentStudentId));
    if (student) {
        renderPermissionTree(student.permissions || [], subject);
    }
    permissionDirty = false;
    updateSaveButton();
}

function renderPermissionTree(permissions, subject) {
    if (!treeContainer) return;
    if (!blogData.length) {
        treeContainer.innerHTML = '<p>加载文章数据中...</p>';
        loadBlogData().then(() => renderPermissionTree(permissions, subject));
        return;
    }
    if (!subject) {
        treeContainer.innerHTML = '<p class="tree-placeholder">请选择科目</p>';
        return;
    }

    const filtered = getBlogsBySubject(subject);
    if (filtered.length === 0) {
        treeContainer.innerHTML = `<p class="tree-placeholder">该科目下暂无文章</p>`;
        return;
    }

    const tree = buildTree(filtered);
    treeContainer.innerHTML = renderTreeWithCheckboxes(tree.children, permissions, 0);
    treeContainer.querySelectorAll('.perm-checkbox').forEach(cb => {
        cb.addEventListener('change', function () {
            permissionDirty = true;
            updateSaveButton();
        });
    });
}

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
}

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

function populatePermissionStudentSelect(students) {
    studentSelect.innerHTML = '<option value="">-- 切换学生 --</option>';
    students.forEach(s => {
        const opt = document.createElement('option');
        opt.value = s.id;
        opt.textContent = s.username;
        studentSelect.appendChild(opt);
    });
}

// ---------- 批阅管理 ----------
function switchReviewStudent(studentId) {
    if (!studentId) studentId = currentStudentId;
    currentReviewStudentId = studentId ? Number(studentId) : null;
    const student = allStudents.find(s => Number(s.id) === currentReviewStudentId);
    if (sidebarStudent && student) {
        sidebarStudent.textContent = `学生：${student.username}`;
    }
    renderReviewTreeForCurrentSelection();
}

function switchReviewSubject(subject) {
    currentReviewSubject = subject || null;
    const container = document.getElementById('admin-review-subject-buttons');
    if (container) {
        container.querySelectorAll('.subject-btn').forEach(b => {
            b.classList.toggle('is-active', b.dataset.subject === subject);
        });
    }
    renderReviewTreeForCurrentSelection();
}

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

function renderReviewTreeForCurrentSelection() {
    if (!reviewTreeContainer) return;
    if (!currentReviewStudentId) {
        reviewTreeContainer.innerHTML = '<p class="tree-placeholder">请先选择学生</p>';
        return;
    }
    if (!currentReviewSubject) {
        reviewTreeContainer.innerHTML = '<p class="tree-placeholder">请先选择科目</p>';
        return;
    }
    const student = allStudents.find(s => Number(s.id) === Number(currentReviewStudentId));
    const permissionIds = new Set((student?.permissions || []).map(Number).filter(Number.isFinite));
    const filtered = getBlogsBySubject(currentReviewSubject).filter(b => permissionIds.has(Number(b.id)));
    if (filtered.length === 0) {
        reviewTreeContainer.innerHTML = '<p class="tree-placeholder">该学生在该科目下暂无可批阅文章</p>';
        return;
    }
    const tree = buildTree(filtered);
    const blogIds = filtered.map(b => Number(b.id)).filter(Number.isFinite);
    loadPendingReviewCounts(currentReviewStudentId, blogIds).then(badgeMap => {
        if (!reviewTreeContainer) return;
        reviewTreeContainer.innerHTML = renderClickableTree(tree.children, 0, badgeMap);
    });
}

// ---------- 答案设置 ----------
function switchAnswerSubject(subject) {
    currentAnswerSubject = subject || null;
    const container = document.getElementById('admin-answer-subject-buttons');
    if (container) {
        container.querySelectorAll('.subject-btn').forEach(b => {
            b.classList.toggle('is-active', b.dataset.subject === subject);
        });
    }
    renderAnswerTreeForCurrentSelection();
}

function renderAnswerTreeForCurrentSelection() {
    if (!answerTreeContainer) return;
    if (!currentAnswerSubject) {
        answerTreeContainer.innerHTML = '<p class="tree-placeholder">请先选择科目</p>';
        return;
    }
    const filtered = getBlogsBySubject(currentAnswerSubject);
    if (filtered.length === 0) {
        answerTreeContainer.innerHTML = '<p class="tree-placeholder">该科目下暂无文章</p>';
        return;
    }
    const tree = buildTree(filtered);
    answerTreeContainer.innerHTML = renderClickableTree(tree.children, 0, new Map());
}

// ---------- 初始化 ----------
export async function initAdmin() {
    await loadBlogData();
    allStudents = await loadStudents();

    populatePermissionStudentSelect(allStudents);

    // 权限管理 - 科目按钮
    const permContainer = document.getElementById('admin-permission-subject-buttons');
    if (permContainer && allSubjects.length > 0) {
        renderSubjectButtons('admin-permission-subject-buttons', allSubjects, allSubjects[0], (subject) => {
            if (currentStudentId) switchSubject(subject);
            else { currentSubject = subject; treeContainer.innerHTML = '<p class="tree-placeholder">请先选择学生</p>'; }
        });
        if (currentStudentId) switchSubject(allSubjects[0]);
        else currentSubject = allSubjects[0];
    }

    // 批阅管理 - 科目按钮
    const reviewContainer = document.getElementById('admin-review-subject-buttons');
    if (reviewContainer && allSubjects.length > 0) {
        renderSubjectButtons('admin-review-subject-buttons', allSubjects, allSubjects[0], switchReviewSubject);
        switchReviewSubject(allSubjects[0]);
    }

    // 答案设置 - 科目按钮
    const answerContainer = document.getElementById('admin-answer-subject-buttons');
    if (answerContainer && allSubjects.length > 0) {
        renderSubjectButtons('admin-answer-subject-buttons', allSubjects, allSubjects[0], switchAnswerSubject);
        switchAnswerSubject(allSubjects[0]);
    }

    // 侧边栏切换
    sidebarBtns.forEach(btn => {
        btn.addEventListener('click', function () {
            setActivePanel(this.dataset.panel);
        });
    });
    setActivePanel('permission-panel');

    // 默认选择第一个学生
    if (allStudents.length > 0) {
        await switchStudent(allStudents[0].id);
        switchReviewStudent(currentStudentId);
        if (allSubjects.length > 0) {
            const pc = document.getElementById('admin-permission-subject-buttons');
            if (pc) {
                pc.querySelectorAll('.subject-btn').forEach(b => {
                    b.classList.toggle('is-active', b.dataset.subject === allSubjects[0]);
                });
            }
            switchSubject(allSubjects[0]);
            switchReviewSubject(allSubjects[0]);
            switchAnswerSubject(allSubjects[0]);
        }
    } else {
        studentNameDisplay.textContent = '无学生';
        sidebarStudent.textContent = '学生：无';
    }

    // 事件绑定
    studentSelect.addEventListener('change', function () {
        const id = Number(this.value);
        if (id) {
            switchStudent(id);
            switchReviewStudent(id);
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

    // 批阅树点击
    if (reviewTreeContainer) {
        reviewTreeContainer.addEventListener('click', function (e) {
            const folder = e.target.closest('.tree-folder');
            if (folder) {
                const wrapper = folder.closest('.tree-folder-wrapper');
                if (!wrapper) return;
                const children = wrapper.querySelector('.tree-children');
                if (!children) return;
                const hidden = children.style.display === 'none';
                children.style.display = hidden ? 'block' : 'none';
                const icon = folder.querySelector('.folder-toggle i');
                if (icon) icon.className = hidden ? 'fas fa-chevron-down' : 'fas fa-chevron-right';
                return;
            }
            const file = e.target.closest('.tree-clickable');
            if (file) {
                const id = Number(file.dataset.id);
                if (id && currentReviewStudentId) {
                    openDetailPage('review', id, currentReviewStudentId);
                }
            }
        });
    }

    // 答案树点击
    if (answerTreeContainer) {
        answerTreeContainer.addEventListener('click', function (e) {
            const folder = e.target.closest('.tree-folder');
            if (folder) {
                const wrapper = folder.closest('.tree-folder-wrapper');
                if (!wrapper) return;
                const children = wrapper.querySelector('.tree-children');
                if (!children) return;
                const hidden = children.style.display === 'none';
                children.style.display = hidden ? 'block' : 'none';
                const icon = folder.querySelector('.folder-toggle i');
                if (icon) icon.className = hidden ? 'fas fa-chevron-down' : 'fas fa-chevron-right';
                return;
            }
            const file = e.target.closest('.tree-clickable');
            if (file) {
                const id = Number(file.dataset.id);
                if (id) openDetailPage('answer', id);
            }
        });
    }

    if (saveBtn) saveBtn.addEventListener('click', savePermissions);
    if (addStudentBtn) addStudentBtn.addEventListener('click', addStudent);
    if (logoutBtn) {
        logoutBtn.addEventListener('click', function () {
            logout();
            window.location.href = 'index.html';
        });
    }

    window.addEventListener('beforeunload', function () {
        if (permissionDirty) savePermissions();
    });

    updateSaveButton();
}

// 自动初始化
if (document.getElementById('permission-panel')) {
    document.addEventListener('DOMContentLoaded', initAdmin);
}