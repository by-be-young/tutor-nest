/**
 * home.js - 首页逻辑
 * 职责：登录/注册、科目卡片渲染、用户信息显示
 */

import { login, register, logout, getCurrentUser, getPermissionIds } from './auth.js';
import { loadBlogData } from './data-loader.js';

// ---------- DOM 引用 ----------
const loginArea = document.getElementById('login-area');
const subjectWrapper = document.getElementById('subject-cards-wrapper');
const subjectContainer = document.getElementById('subject-cards-container');
const loginForm = document.getElementById('login-form');
const usernameInput = document.getElementById('login-username');
const registerBtn = document.getElementById('register-btn');
const errorEl = document.getElementById('login-error');
const logoutBtn = document.getElementById('logout-btn');
const scrollContainer = document.getElementById('subject-cards-scroll');
const userDisplayName = document.getElementById('user-display-name');

let blogData = [];

// ---------- 科目卡片渲染 ----------
const ICON_MAP = { '英语': 'fa-language', '化学': 'fa-flask' };
const DESC_MAP = { '英语': '语法逻辑构筑', '化学': '宏观微观交织' };

function getIconForSubject(subject) {
    return ICON_MAP[subject] || 'fa-book';
}

function getDescriptionForSubject(subject) {
    return DESC_MAP[subject] || '';
}

/**
 * 根据权限过滤并渲染科目卡片
 */
function renderSubjects(blogs) {
    const allSubjects = [...new Set(blogs.map(b => b.series))];
    const permissionIds = getPermissionIds().map(Number).filter(Number.isFinite);

    const allowedSubjects = allSubjects.filter(subject =>
        blogs.some(b => b.series === subject && permissionIds.includes(Number(b.id)))
    );

    if (allowedSubjects.length === 0) {
        subjectContainer.innerHTML = `<p style="color:var(--gray);">您暂时没有可访问的科目，请联系管理员。</p>`;
        return;
    }

    subjectContainer.innerHTML = allowedSubjects.map(subject => {
        let cardClass = 'subject-card';
        if (subject === '英语') cardClass += ' card-english';
        else if (subject === '化学') cardClass += ' card-chemistry';
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

/**
 * 更新顶部用户名显示
 */
function updateUserDisplay(user) {
    if (userDisplayName) {
        userDisplayName.textContent = user ? `👤 ${user.username}` : '👤 未登录';
    }
}

/**
 * 登录成功后的处理：隐藏登录框，显示科目卡片
 */
async function onLoginSuccess(user) {
    updateUserDisplay(user);
    loginArea.style.display = 'none';
    subjectWrapper.classList.add('is-logged-in');

    blogData = await loadBlogData();
    if (blogData.length === 0) {
        subjectContainer.innerHTML = `<p style="color:var(--gray);">暂无文章数据，请稍后重试。</p>`;
        return;
    }
    renderSubjects(blogData);
}

/**
 * 退出登录：恢复登录界面
 */
function handleLogout() {
    logout();
    updateUserDisplay(null);
    loginArea.style.display = 'block';
    subjectWrapper.classList.remove('is-logged-in');
    subjectContainer.innerHTML = '';
    usernameInput.value = '';
    errorEl.textContent = '';
}

/**
 * 启用鼠标滚轮水平滚动（桌面端）
 */
function enableHorizontalScroll(container) {
    if (!container) return;
    container.addEventListener('wheel', function (e) {
        if (window.innerWidth <= 640) return;
        if (container.scrollWidth <= container.clientWidth) return;
        e.preventDefault();
        container.scrollLeft += e.deltaY || e.detail || 0;
    }, { passive: false });
}

// ---------- 初始化 ----------
async function initHome() {
    const user = getCurrentUser();
    if (user) {
        updateUserDisplay(user);
        blogData = await loadBlogData();
        if (blogData.length) renderSubjects(blogData);
        loginArea.style.display = 'none';
        subjectWrapper.classList.add('is-logged-in');
    } else {
        updateUserDisplay(null);
        loginArea.style.display = 'block';
        subjectWrapper.classList.remove('is-logged-in');
    }

    // 登录
    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const username = usernameInput.value.trim();
        errorEl.textContent = '';
        if (!username) {
            errorEl.textContent = '请输入用户名';
            return;
        }
        try {
            const user = await login(username);
            await onLoginSuccess(user);
        } catch (err) {
            errorEl.textContent = err.message || '登录失败，请重试';
            usernameInput.focus();
        }
    });

    // 注册
    registerBtn.addEventListener('click', async () => {
        const username = usernameInput.value.trim();
        errorEl.textContent = '';
        if (!username) {
            errorEl.textContent = '请输入用户名';
            usernameInput.focus();
            return;
        }
        try {
            const user = await register(username);
            await onLoginSuccess(user);
        } catch (err) {
            errorEl.textContent = err.message || '注册失败，请重试';
            usernameInput.focus();
        }
    });

    logoutBtn.addEventListener('click', handleLogout);
    enableHorizontalScroll(scrollContainer);
}

initHome();

// ---------- 快捷键：三次 '+' 进入管理员 ----------
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