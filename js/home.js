import { login, register, logout, getCurrentUser, getPermissionIds } from './auth.js';
import { loadBlogData } from './data-loader.js';

// DOM 元素
const loginArea = document.getElementById('login-area');
const subjectWrapper = document.getElementById('subject-cards-wrapper');
const subjectContainer = document.getElementById('subject-cards-container');
const loginForm = document.getElementById('login-form');
const usernameInput = document.getElementById('login-username');
const registerBtn = document.getElementById('register-btn');
const errorEl = document.getElementById('login-error');
const logoutBtn = document.getElementById('logout-btn');
const scrollContainer = document.getElementById('subject-cards-scroll');

// 存储文章数据
let blogData = [];

// 渲染科目卡片（根据权限过滤）
function renderSubjects(blogs) {
    // 获取所有科目，然后过滤出用户有至少一篇文章权限的科目
    const allSubjects = [...new Set(blogs.map(b => b.series))];
    const permissionIds = getPermissionIds().map(Number).filter(Number.isFinite);
    const allowedSubjects = allSubjects.filter(subject => {
        // 检查该科目下是否有任何文章拥有权限
        return blogs.some(b => b.series === subject && permissionIds.includes(Number(b.id)));
    });

    if (allowedSubjects.length === 0) {
        subjectContainer.innerHTML = `<p style="color:var(--gray);">您暂时没有可访问的科目，请联系管理员。</p>`;
        return;
    }

    // 渲染科目卡片（仅显示有权限的科目）
    subjectContainer.innerHTML = allowedSubjects.map(subject => {
        // 确定卡片样式
        let cardClass = 'subject-card';
        if (subject === '英语') cardClass += ' card-english';
        else if (subject === '化学') cardClass += ' card-chemistry';
        // 其他科目使用默认样式
        return `
            <a href="category.html?subject=${encodeURIComponent(subject)}" class="${cardClass}">
                <div class="card-icon"><i class="fas ${getIconForSubject(subject)}"></i></div>
                <div class="card-name">${subject}</div>
                <div class="card-desc">${getDescriptionForSubject(subject)}</div>
                <div class="card-arrow"><i class="fas fa-arrow-right"></i></div>
            </a>
        `;
    }).join('');
}

// 辅助函数：为科目选择图标和描述（可扩展）
function getIconForSubject(subject) {
    const map = { '英语': 'fa-language', '化学': 'fa-flask' };
    return map[subject] || 'fa-book';
}
function getDescriptionForSubject(subject) {
    const map = { '英语': '语法逻辑构筑', '化学': '宏观微观交织' };
    return map[subject] || '';
}

// 登录成功后刷新界面
async function onLoginSuccess() {
    // 隐藏登录框，显示科目卡片
    loginArea.style.display = 'none';
    subjectWrapper.classList.add('is-logged-in');

    // 加载文章数据
    blogData = await loadBlogData();
    if (blogData.length === 0) {
        subjectContainer.innerHTML = `<p style="color:var(--gray);">暂无文章数据，请稍后重试。</p>`;
        return;
    }
    renderSubjects(blogData);
}

// 退出登录
function handleLogout() {
    logout();
    // 恢复登录界面
    loginArea.style.display = 'block';
    subjectWrapper.classList.remove('is-logged-in');
    subjectContainer.innerHTML = '';
    usernameInput.value = '';
    errorEl.textContent = '';
}

// 初始化
async function initHome() {
    // 检查是否已登录
    const user = getCurrentUser();
    if (user) {
        // 已登录，直接显示科目
        blogData = await loadBlogData();
        if (blogData.length) {
            renderSubjects(blogData);
        }
        loginArea.style.display = 'none';
        subjectWrapper.classList.add('is-logged-in');
    } else {
        // 未登录，显示登录框
        loginArea.style.display = 'block';
        subjectWrapper.classList.remove('is-logged-in');
    }

    // 登录表单提交
    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const username = usernameInput.value.trim();
        errorEl.textContent = '';
        if (!username) {
            errorEl.textContent = '请输入用户名';
            return;
        }
        try {
            await login(username);
            await onLoginSuccess();
        } catch (err) {
            errorEl.textContent = err.message || '登录失败，请重试';
            usernameInput.focus();
        }
    });

    registerBtn.addEventListener('click', async () => {
        const username = usernameInput.value.trim();
        errorEl.textContent = '';
        if (!username) {
            errorEl.textContent = '请输入用户名';
            usernameInput.focus();
            return;
        }
        try {
            await register(username);
            await onLoginSuccess();
        } catch (err) {
            errorEl.textContent = err.message || '注册失败，请重试';
            usernameInput.focus();
        }
    });

    // 退出按钮
    logoutBtn.addEventListener('click', handleLogout);

    // 启用鼠标滚轮水平滚动（桌面端）
    enableHorizontalScroll(scrollContainer);
}

// 启用水平滚动：鼠标滚轮上下滚动时，容器左右滚动
function enableHorizontalScroll(container) {
    if (!container) return;

    container.addEventListener('wheel', function (e) {
        // 只在桌面端启用（宽度 > 640px）
        if (window.innerWidth <= 640) return;

        // 检查内容是否超出容器宽度（即是否有水平滚动需求）
        if (container.scrollWidth <= container.clientWidth) return;

        e.preventDefault();
        // 滚轮deltaY转为水平滚动
        const scrollAmount = e.deltaY || e.detail || 0;
        container.scrollLeft += scrollAmount;
    }, { passive: false });
}

// 启动
initHome();

// 全局暴露三连 + 进入管理员（沿用之前的逻辑）
let plusCount = 0;
let timer = null;
document.addEventListener('keydown', function (e) {
    if (e.key === '+') {
        plusCount++;
        clearTimeout(timer);
        timer = setTimeout(() => { plusCount = 0; }, 1000);
        if (plusCount >= 3) {
            plusCount = 0;
            window.location.href = 'admin.html';
        }
    }
});