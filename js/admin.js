// js/admin.js
import { supabase } from './supabase-client.js';
import { getCurrentUser, logout } from './auth.js';

let allStudents = [];
let currentStudentId = null;
let currentSubject = null;
let permissionDirty = false;

// 文章数据（从 /data/blogs.json 加载）
let blogData = [];
let allSubjects = [];

// DOM 元素
const studentSelect = document.getElementById('admin-student-select');
const studentNameDisplay = document.getElementById('admin-current-student');
const studentNameTitle = document.getElementById('admin-student-name');
const treeContainer = document.getElementById('admin-permission-tree');
const saveBtn = document.getElementById('admin-save-btn');
const addStudentBtn = document.getElementById('admin-add-student-btn');
const logoutBtn = document.getElementById('admin-logout-btn');
const navTabs = Array.from(document.querySelectorAll('.admin-nav-tab'));

const permissionPanel = document.getElementById('permission-panel');
const reviewPanel = document.getElementById('review-panel');
const answerPanel = document.getElementById('answer-panel');

const reviewStudentSelect = document.getElementById('admin-review-student-select');
const reviewStudentName = document.getElementById('admin-review-student-name');
const reviewTreeContainer = document.getElementById('admin-review-tree');

const answerSubjectName = document.getElementById('admin-answer-subject-name');
const answerTreeContainer = document.getElementById('admin-answer-tree');

let currentReviewStudentId = null;
let currentReviewSubject = null;
let currentAnswerSubject = null;

// ====================== 顶层公共函数 ======================
function populateStudentSelectFor(selectElement, students, placeholder) {
    if (!selectElement) return;
    selectElement.innerHTML = `<option value="">${placeholder}</option>`;
    students.forEach(student => {
        const option = document.createElement('option');
        option.value = student.id;
        option.textContent = student.username;
        selectElement.appendChild(option);
    });
}

function setActivePanel(panelId) {
    navTabs.forEach(tab => {
        tab.classList.toggle('is-active', tab.dataset.panel === panelId);
    });
    [permissionPanel, reviewPanel, answerPanel].forEach(panel => {
        if (!panel) return;
        panel.classList.toggle('is-active', panel.id === panelId);
    });
}

function openDetailPage(mode, blogId, studentId = '') {
    const params = new URLSearchParams();
    params.set('mode', mode);
    params.set('id', blogId);
    if (studentId) {
        params.set('studentId', studentId);
    }
    window.location.href = `detail.html?${params.toString()}`;
}

// 渲染科目按钮组（替代下拉框）
function renderSubjectButtons(containerId, subjects, currentSubject, onSelect) {
    const container = document.getElementById(containerId);
    if (!container) return;

    container.innerHTML = '';
    container.className = 'subject-btn-group';

    subjects.forEach(subject => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = `subject-btn${subject === currentSubject ? ' is-active' : ''}`;
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

function renderClickableTree(children, depth = 0, badgeMap = new Map()) {
    if (!children || children.length === 0) return '';
    let html = '';
    children.forEach(node => {
        const indent = depth * 20;
        const padding = `padding-left: ${indent + 8}px;`;
        if (node.isFile) {
            const pendingCount = badgeMap.get(Number(node.blogId)) || 0;
            const badgeHtml = pendingCount > 0 ? `<span class="tree-badge is-warning">待批阅 ${pendingCount}</span>` : '';
            html += `
            <div class="tree-item tree-file tree-clickable" style="${padding}" data-id="${node.blogId}">
                <span class="file-icon"><i class="fas fa-file-alt"></i></span>
                <span class="file-name">${node.name}</span>
                ${badgeHtml}
                <span class="file-arrow"><i class="fas fa-chevron-right"></i></span>
            </div>
        `;
        } else {
            const childHtml = renderClickableTree(node.children, depth + 1, badgeMap);
            html += `
            <div class="tree-folder-wrapper" style="${padding}">
                <div class="tree-item tree-folder">
                    <span class="folder-icon"><i class="fas fa-folder"></i></span>
                    <span class="folder-name">${node.name}</span>
                    <span class="folder-count">(${node.children.filter(c => c.isFile).length})</span>
                </div>
                <div class="tree-children" style="padding-left: 20px;">
                    ${childHtml}
                </div>
            </div>
        `;
        }
    });
    return html;
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
    const student = allStudents.find(item => Number(item.id) === Number(currentReviewStudentId));
    const permissionIds = new Set((student?.permissions || []).map(Number).filter(Number.isFinite));
    const filteredBlogs = getBlogsBySubject(currentReviewSubject).filter(blog => permissionIds.has(Number(blog.id)));
    if (filteredBlogs.length === 0) {
        reviewTreeContainer.innerHTML = '<p class="tree-placeholder">该学生在该科目下暂无可批阅文章</p>';
        return;
    }
    const tree = buildTree(filteredBlogs);
    const blogIds = filteredBlogs.map(blog => Number(blog.id)).filter(Number.isFinite);
    loadPendingReviewCounts(currentReviewStudentId, blogIds).then(badgeMap => {
        if (!reviewTreeContainer) return;
        reviewTreeContainer.innerHTML = renderClickableTree(tree.children, 0, badgeMap);
    });
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

function renderAnswerTreeForCurrentSelection() {
    if (!answerTreeContainer) return;
    if (!currentAnswerSubject) {
        answerTreeContainer.innerHTML = '<p class="tree-placeholder">请先选择科目</p>';
        return;
    }
    const filteredBlogs = getBlogsBySubject(currentAnswerSubject);
    if (filteredBlogs.length === 0) {
        answerTreeContainer.innerHTML = '<p class="tree-placeholder">该科目下暂无文章</p>';
        return;
    }
    const tree = buildTree(filteredBlogs);
    answerTreeContainer.innerHTML = renderClickableTree(tree.children, 0, new Map());
}

// ====================== 原有业务函数 ======================
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

function populatePermissionStudentSelect(students) {
    studentSelect.innerHTML = '<option value="">-- 切换学生 --</option>';
    students.forEach(s => {
        const opt = document.createElement('option');
        opt.value = s.id;
        opt.textContent = s.username;
        studentSelect.appendChild(opt);
    });
}

function extractSubjects(blogs) {
    const subjects = new Set();
    blogs.forEach(blog => {
        if (blog.series) {
            subjects.add(blog.series);
        }
    });
    return Array.from(subjects).sort();
}

async function switchStudent(studentId) {
    currentStudentId = studentId;
    const student = allStudents.find(s => Number(s.id) === Number(studentId));
    if (student) {
        studentNameDisplay.textContent = student.username;
        studentNameTitle.textContent = student.username;
        studentSelect.value = studentId;
        currentSubject = null;
        // 取消激活权限面板的科目按钮
        const permContainer = document.getElementById('admin-permission-subject-buttons');
        if (permContainer) {
            permContainer.querySelectorAll('.subject-btn').forEach(btn => btn.classList.remove('is-active'));
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

function switchReviewStudent(studentId) {
    // 如果未传参，从导航栏获取当前学生
    if (!studentId) {
        studentId = currentStudentId;
    }
    currentReviewStudentId = studentId ? Number(studentId) : null;
    const student = allStudents.find(s => Number(s.id) === currentReviewStudentId);
    if (reviewStudentName) {
        reviewStudentName.textContent = student ? student.username : '选择学生';
    }
    if (reviewStudentSelect) {
        reviewStudentSelect.value = studentId || '';
    }
    renderReviewTreeForCurrentSelection();
}

function switchReviewSubject(subject) {
    currentReviewSubject = subject || null;
    // 更新按钮激活状态
    const container = document.getElementById('admin-review-subject-buttons');
    if (container) {
        container.querySelectorAll('.subject-btn').forEach(btn => {
            btn.classList.toggle('is-active', btn.dataset.subject === subject);
        });
    }
    renderReviewTreeForCurrentSelection();
}

function switchAnswerSubject(subject) {
    currentAnswerSubject = subject || null;
    if (answerSubjectName) {
        answerSubjectName.textContent = subject || '选择科目';
    }
    // 更新按钮激活状态
    const container = document.getElementById('admin-answer-subject-buttons');
    if (container) {
        container.querySelectorAll('.subject-btn').forEach(btn => {
            btn.classList.toggle('is-active', btn.dataset.subject === subject);
        });
    }
    renderAnswerTreeForCurrentSelection();
}

function getBlogsBySubject(subject) {
    if (!subject) return [];
    return blogData.filter(blog => blog.series === subject);
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
            const isLastPart = (i === dirParts.length - 1);
            const isFile = isLastPart && (part.endsWith('.md') || part.endsWith('.html'));

            if (isFile) {
                const existing = current.children.find(child => child.name === title && child.isFile);
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

    const filteredBlogs = getBlogsBySubject(subject);
    if (filteredBlogs.length === 0) {
        treeContainer.innerHTML = `<p class="tree-placeholder">该科目下暂无文章</p>`;
        return;
    }

    const tree = buildTree(filteredBlogs);
    const html = renderTreeWithCheckboxes(tree.children, permissions, 0);
    treeContainer.innerHTML = html;
    treeContainer.querySelectorAll('.perm-checkbox').forEach(cb => {
        cb.addEventListener('change', function () {
            permissionDirty = true;
            updateSaveButton();
        });
    });
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
            const childHtml = renderTreeWithCheckboxes(node.children, permissions, depth + 1);
            html += `
                <div class="tree-folder-wrapper" style="${padding}">
                    <div class="tree-item tree-folder">
                        <span class="folder-icon"><i class="fas fa-folder"></i></span>
                        <span class="folder-name">${node.name}</span>
                        <span class="folder-count">(${node.children.filter(c => c.isFile).length})</span>
                    </div>
                    <div class="tree-children" style="padding-left: 20px;">
                        ${childHtml}
                    </div>
                </div>
            `;
        }
    });
    return html;
}

// 加载文章数据
async function loadBlogData() {
    try {
        const res = await fetch('data/blogs.json');
        if (!res.ok) throw new Error('加载文章数据失败');
        blogData = await res.json();
        allSubjects = extractSubjects(blogData);
        // 不再使用下拉框 populateSubjectSelect
    } catch (e) {
        console.error(e);
        blogData = [];
    }
}

function updateSaveButton() {
    if (saveBtn) {
        saveBtn.disabled = !permissionDirty;
        saveBtn.innerHTML = permissionDirty ? '<i class="fas fa-save"></i> 保存权限' : '<i class="fas fa-check"></i> 已保存';
    }
}

async function savePermissions() {
    if (!currentStudentId) {
        alert('请先选择学生');
        return;
    }
    const student = allStudents.find(s => Number(s.id) === Number(currentStudentId));
    const existingPermissions = Array.isArray(student?.permissions) ? student.permissions.map(Number).filter(Number.isFinite) : [];
    const currentSubjectBlogIds = getBlogsBySubject(currentSubject).map(blog => Number(blog.id)).filter(Number.isFinite);
    const checkboxes = treeContainer.querySelectorAll('.perm-checkbox:checked');
    const selectedPermissions = Array.from(checkboxes).map(cb => Number(cb.dataset.id)).filter(Number.isFinite);
    const mergedPermissions = [
        ...existingPermissions.filter(id => !currentSubjectBlogIds.includes(id)),
        ...selectedPermissions
    ];
    const permissions = Array.from(new Set(mergedPermissions));
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
        populateStudentSelectFor(reviewStudentSelect, allStudents, '-- 请选择学生 --');
        studentSelect.value = data[0].id;
        await switchStudent(data[0].id);
        alert('新增学生成功！');
    }
}

// ====================== 初始化管理员页面 ======================
export async function initAdmin() {
    await loadBlogData();
    allStudents = await loadStudents();

    populatePermissionStudentSelect(allStudents);
    populateStudentSelectFor(reviewStudentSelect, allStudents, '-- 请选择学生 --');

    // ===== 权限管理 - 科目按钮组 =====
    const permissionSubjectContainer = document.getElementById('admin-permission-subject-buttons');
    if (permissionSubjectContainer && allSubjects.length > 0) {
        renderSubjectButtons('admin-permission-subject-buttons', allSubjects, allSubjects[0], (subject) => {
            if (currentStudentId) {
                switchSubject(subject);
            } else {
                currentSubject = subject;
                treeContainer.innerHTML = '<p class="tree-placeholder">请先选择学生</p>';
            }
        });
        // 默认选中第一个科目
        if (currentStudentId) {
            switchSubject(allSubjects[0]);
        } else {
            currentSubject = allSubjects[0];
        }
    }

    // ===== 批阅管理 - 科目按钮组 =====
    const reviewSubjectContainer = document.getElementById('admin-review-subject-buttons');
    if (reviewSubjectContainer && allSubjects.length > 0) {
        renderSubjectButtons('admin-review-subject-buttons', allSubjects, allSubjects[0], (subject) => {
            switchReviewSubject(subject);
        });
        switchReviewSubject(allSubjects[0]);
    }

    // ===== 答案设置 - 科目按钮组 =====
    const answerSubjectContainer = document.getElementById('admin-answer-subject-buttons');
    if (answerSubjectContainer && allSubjects.length > 0) {
        renderSubjectButtons('admin-answer-subject-buttons', allSubjects, allSubjects[0], (subject) => {
            switchAnswerSubject(subject);
        });
        switchAnswerSubject(allSubjects[0]);
    }

    // ===== 导航标签切换 =====
    if (navTabs.length > 0) {
        navTabs.forEach(tab => {
            tab.addEventListener('click', function () {
                setActivePanel(this.dataset.panel);
            });
        });
    }

    setActivePanel('permission-panel');

    // ===== 默认选择第一个学生 =====
    if (allStudents.length > 0) {
        await switchStudent(allStudents[0].id);
        switchReviewStudent(currentStudentId);
        if (reviewStudentName) {
            reviewStudentName.textContent = allStudents[0].username;
        }
        if (reviewStudentSelect) {
            reviewStudentSelect.value = String(allStudents[0].id);
        }
        // 如果科目存在，默认选中第一个
        if (allSubjects.length > 0) {
            // 更新权限面板按钮激活状态
            const permContainer = document.getElementById('admin-permission-subject-buttons');
            if (permContainer) {
                permContainer.querySelectorAll('.subject-btn').forEach(btn => {
                    btn.classList.toggle('is-active', btn.dataset.subject === allSubjects[0]);
                });
            }
            switchSubject(allSubjects[0]);
            switchReviewSubject(allSubjects[0]);
            switchAnswerSubject(allSubjects[0]);
        }
    } else {
        studentNameDisplay.textContent = '无学生';
        studentNameTitle.textContent = '无学生';
        if (reviewStudentName) reviewStudentName.textContent = '无学生';
    }

    // ===== 学生切换事件 =====
    studentSelect.addEventListener('change', function () {
        const id = Number(this.value);
        if (id) {
            switchStudent(id);
            // 自动选择第一个科目
            if (allSubjects.length > 0) {
                const permContainer = document.getElementById('admin-permission-subject-buttons');
                if (permContainer) {
                    permContainer.querySelectorAll('.subject-btn').forEach(btn => {
                        btn.classList.toggle('is-active', btn.dataset.subject === allSubjects[0]);
                    });
                }
                switchSubject(allSubjects[0]);
            }
        } else {
            currentStudentId = null;
            studentNameDisplay.textContent = '未选择';
            studentNameTitle.textContent = '选择学生';
            treeContainer.innerHTML = '<p class="tree-placeholder">请先选择学生</p>';
            permissionDirty = false;
            updateSaveButton();
        }
    });

    // ===== 批阅树点击事件 =====
    if (reviewTreeContainer) {
        reviewTreeContainer.addEventListener('click', function (e) {
            const folder = e.target.closest('.tree-folder');
            if (folder) {
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
            const file = e.target.closest('.tree-clickable');
            if (file) {
                const id = Number(file.dataset.id);
                if (id && currentReviewStudentId) {
                    openDetailPage('review', id, currentReviewStudentId);
                }
            }
        });
    }

    // ===== 答案树点击事件 =====
    if (answerTreeContainer) {
        answerTreeContainer.addEventListener('click', function (e) {
            const folder = e.target.closest('.tree-folder');
            if (folder) {
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
            const file = e.target.closest('.tree-clickable');
            if (file) {
                const id = Number(file.dataset.id);
                if (id) {
                    openDetailPage('answer', id);
                }
            }
        });
    }

    // ===== 按钮事件 =====
    if (saveBtn) saveBtn.addEventListener('click', savePermissions);
    if (addStudentBtn) addStudentBtn.addEventListener('click', addStudent);
    if (logoutBtn) {
        logoutBtn.addEventListener('click', function () {
            logout();
            window.location.href = 'index.html';
        });
    }

    // ===== 页面关闭前自动保存 =====
    window.addEventListener('beforeunload', function () {
        if (permissionDirty) savePermissions();
    });

    updateSaveButton();
}

// ===== 自动初始化 =====
if (document.getElementById('permission-panel')) {
    document.addEventListener('DOMContentLoaded', initAdmin);
}