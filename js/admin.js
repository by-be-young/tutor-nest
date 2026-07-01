// js/admin.js
import { supabase } from './supabase-client.js';
import { getCurrentUser, logout } from './auth.js';

let allStudents = [];
let currentStudentId = null;
let currentSubject = null;
let permissionDirty = false; // 是否有未保存的修改

// 文章数据（从 /data/blogs.json 加载）
let blogData = [];
// 所有科目列表
let allSubjects = [];

// DOM 元素
const studentSelect = document.getElementById('admin-student-select');
const subjectSelect = document.getElementById('admin-subject-select');
const studentNameDisplay = document.getElementById('admin-current-student');
const studentNameTitle = document.getElementById('admin-student-name');
const treeContainer = document.getElementById('admin-permission-tree');
const saveBtn = document.getElementById('admin-save-btn');
const addStudentBtn = document.getElementById('admin-add-student-btn');
const logoutBtn = document.getElementById('admin-logout-btn');

// 加载所有学生
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

// 填充下拉框
function populateStudentSelect(students) {
    studentSelect.innerHTML = '<option value="">-- 切换学生 --</option>';
    students.forEach(s => {
        const opt = document.createElement('option');
        opt.value = s.id;
        opt.textContent = s.username;
        studentSelect.appendChild(opt);
    });
}

// 获取所有科目（从博客的 series 字段提取）
function extractSubjects(blogs) {
    const subjects = new Set();
    blogs.forEach(blog => {
        if (blog.series) {
            subjects.add(blog.series);
        }
    });
    return Array.from(subjects).sort();
}

// 填充科目下拉框
function populateSubjectSelect(subjects) {
    subjectSelect.innerHTML = '<option value="">-- 请选择科目 --</option>';
    subjects.forEach(subject => {
        const opt = document.createElement('option');
        opt.value = subject;
        opt.textContent = subject;
        subjectSelect.appendChild(opt);
    });
}

// 切换当前学生
async function switchStudent(studentId) {
    currentStudentId = studentId;
    const student = allStudents.find(s => s.id === studentId);
    if (student) {
        studentNameDisplay.textContent = student.username;
        studentNameTitle.textContent = student.username;
        studentSelect.value = studentId;
        // 重置科目选择
        currentSubject = null;
        subjectSelect.value = '';
        treeContainer.innerHTML = '<p class="tree-placeholder">请选择科目</p>';
        permissionDirty = false;
        updateSaveButton();
    }
}

// 切换科目
function switchSubject(subject) {
    currentSubject = subject;
    const student = allStudents.find(s => s.id === currentStudentId);
    if (student) {
        renderPermissionTree(student.permissions || [], subject);
    }
    permissionDirty = false;
    updateSaveButton();
}

// 按科目过滤博客数据（使用 series 字段）
function getBlogsBySubject(subject) {
    if (!subject) return [];
    return blogData.filter(blog => blog.series === subject);
}

// 构建文章树（按科目过滤后）
function buildTree(blogs) {
    const root = { children: [] };
    blogs.forEach(blog => {
        const parts = blog.path.split('/');
        // 第一级是科目（series），第二级开始是目录结构
        const dirParts = parts.slice(1); // 去掉第一级科目
        const title = blog.title;
        let current = root;
        for (let i = 0; i < dirParts.length; i++) {
            const part = dirParts[i];
            // 判断是否为文件（最后一部分以 .md 结尾或没有子目录）
            const isLastPart = (i === dirParts.length - 1);
            const isFile = isLastPart && (part.endsWith('.md') || part.endsWith('.html'));

            if (isFile) {
                // 文件节点
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
                // 文件夹节点
                let dirNode = current.children.find(child => child.name === part && !child.isFile);
                if (!dirNode) {
                    dirNode = { name: part, isFile: false, children: [] };
                    current.children.push(dirNode);
                }
                current = dirNode;
            }
        }
    });
    // 排序
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

// 渲染权限树（带复选框）
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
    // 绑定复选框事件
    treeContainer.querySelectorAll('.perm-checkbox').forEach(cb => {
        cb.addEventListener('change', function () {
            permissionDirty = true;
            updateSaveButton();
        });
    });
}

// 递归生成带复选框的树 HTML
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
        // 从 series 字段提取科目
        allSubjects = extractSubjects(blogData);
        populateSubjectSelect(allSubjects);
    } catch (e) {
        console.error(e);
        blogData = [];
    }
}

// 更新保存按钮状态
function updateSaveButton() {
    if (saveBtn) {
        saveBtn.disabled = !permissionDirty;
        saveBtn.innerHTML = permissionDirty ? '<i class="fas fa-save"></i> 保存权限' : '<i class="fas fa-check"></i> 已保存';
    }
}

// 保存权限
async function savePermissions() {
    if (!currentStudentId) {
        alert('请先选择学生');
        return;
    }
    // 从树中收集所有勾选的 blogId
    const checkboxes = treeContainer.querySelectorAll('.perm-checkbox:checked');
    const permissions = Array.from(checkboxes).map(cb => Number(cb.dataset.id));
    // 更新数据库
    const { error } = await supabase
        .from('student')
        .update({ permissions })
        .eq('id', currentStudentId);
    if (error) {
        console.error('保存权限失败:', error);
        alert('保存失败，请重试');
        return;
    }
    // 更新本地 student 数据
    const student = allStudents.find(s => s.id === currentStudentId);
    if (student) student.permissions = permissions;
    permissionDirty = false;
    updateSaveButton();
    alert('权限已保存');
}

// 新增学生
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
        populateStudentSelect(allStudents);
        studentSelect.value = data[0].id;
        await switchStudent(data[0].id);
        alert('新增学生成功！');
    }
}

// 初始化管理员页面
export async function initAdmin() {

    // 加载文章数据
    await loadBlogData();
    // 加载学生列表
    allStudents = await loadStudents();
    if (allStudents.length === 0) {
        // 可以继续
    }
    populateStudentSelect(allStudents);
    // 默认选中第一个学生
    if (allStudents.length > 0) {
        await switchStudent(allStudents[0].id);
        // 如果有科目，默认选中第一个
        if (allSubjects.length > 0) {
            subjectSelect.value = allSubjects[0];
            switchSubject(allSubjects[0]);
        }
    } else {
        studentNameDisplay.textContent = '无学生';
        studentNameTitle.textContent = '无学生';
    }
    // 绑定事件
    studentSelect.addEventListener('change', function () {
        const id = Number(this.value);
        if (id) {
            switchStudent(id);
            // 如果有科目且当前未选择，自动选中第一个
            if (allSubjects.length > 0 && !subjectSelect.value) {
                subjectSelect.value = allSubjects[0];
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

    subjectSelect.addEventListener('change', function () {
        const subject = this.value;
        if (subject && currentStudentId) {
            switchSubject(subject);
        } else {
            currentSubject = null;
            treeContainer.innerHTML = '<p class="tree-placeholder">请选择科目</p>';
            permissionDirty = false;
            updateSaveButton();
        }
    });

    if (saveBtn) {
        saveBtn.addEventListener('click', savePermissions);
    }
    if (addStudentBtn) {
        addStudentBtn.addEventListener('click', addStudent);
    }
    if (logoutBtn) {
        logoutBtn.addEventListener('click', function () {
            logout();
            window.location.href = 'index.html';
        });
    }
    // 退出前自动保存
    window.addEventListener('beforeunload', function () {
        if (permissionDirty) {
            savePermissions();
        }
    });
    // 手动保存提示
    updateSaveButton();
}

// 如果页面直接加载 admin.html，自动初始化
if (document.getElementById('admin-permission-tree')) {
    document.addEventListener('DOMContentLoaded', initAdmin);
}