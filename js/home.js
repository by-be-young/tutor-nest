/**
 * home.js - 底部登录/统计，书本卡片
 */

import { login, register, logout, getCurrentUser, getPermissionIds } from './auth.js';
import { loadBlogData } from './data-loader.js';

// ---------- DOM 引用 ----------
const navUserStatus = document.getElementById('nav-user-status');
const navLoginBtn = document.getElementById('nav-login-btn');
const navLogoutBtn = document.getElementById('nav-logout-btn');

const loginSection = document.getElementById('login-section');
const loggedInContent = document.getElementById('logged-in-content');
const subjectContainer = document.getElementById('subject-cards-container');
const scrollContainer = document.getElementById('subject-cards-scroll');

const statsArea = document.getElementById('stats-area');
const statsSubjects = document.getElementById('stats-subjects');
const statsArticles = document.getElementById('stats-articles');

const loginForm = document.getElementById('login-form');
const usernameInput = document.getElementById('login-username');
const registerBtn = document.getElementById('register-btn');
const errorEl = document.getElementById('login-error');

let blogData = [];

// ---------- 工具 ----------
const ICON_MAP = { '英语': 'fa-language', '化学': 'fa-flask' };
function getIconForSubject(subject) {
    return ICON_MAP[subject] || 'fa-book';
}

// ---------- 渲染卡片 ----------
function renderSubjects(blogs) {
    const permissionIds = getPermissionIds().map(Number).filter(Number.isFinite);
    const allowedBlogs = blogs.filter(b => permissionIds.includes(Number(b.id)));

    const subjectMap = new Map();
    allowedBlogs.forEach(b => {
        const subject = b.series;
        if (!subjectMap.has(subject)) subjectMap.set(subject, []);
        subjectMap.get(subject).push(b);
    });

    const subjects = Array.from(subjectMap.keys()).sort();

    if (subjects.length === 0) {
        subjectContainer.innerHTML = `<p style="color:var(--gray);">您暂时没有可访问的科目，请联系管理员。</p>`;
        statsSubjects.textContent = '0';
        statsArticles.textContent = '0';
        return;
    }

    statsSubjects.textContent = subjects.length;
    statsArticles.textContent = allowedBlogs.length;

    subjectContainer.innerHTML = subjects.map(subject => {
        const count = subjectMap.get(subject).length;
        let cardClass = 'subject-card';
        if (subject === '英语') cardClass += ' card-english';
        else if (subject === '化学') cardClass += ' card-chemistry';

        return `
            <a href="category.html?subject=${encodeURIComponent(subject)}" class="${cardClass}">
                <div class="card-icon"><i class="fas ${getIconForSubject(subject)}"></i></div>
                <div class="card-name">${subject}</div>
                <div class="card-count">${count} 篇文章</div>
                <div class="card-arrow"><i class="fas fa-arrow-right"></i></div>
            </a>
        `;
    }).join('');
}

// ---------- 更新导航 ----------
function updateNav(user) {
    if (user) {
        navUserStatus.textContent = `${user.username}`;
        navLoginBtn.style.display = 'none';
        navLogoutBtn.style.display = 'inline-block';
    } else {
        navUserStatus.textContent = '未登录';
        navLoginBtn.style.display = 'inline-block';
        navLogoutBtn.style.display = 'none';
    }
}

// ---------- 切换视图 ----------
function showLoggedIn(user) {
    loginSection.style.display = 'none';
    loggedInContent.style.display = 'block';
    statsArea.style.display = 'flex';
    loginForm.style.display = 'none';
    updateNav(user);
}

function showLoggedOut() {
    loginSection.style.display = 'block';
    loggedInContent.style.display = 'none';
    statsArea.style.display = 'none';
    loginForm.style.display = 'flex';
    updateNav(null);
    subjectContainer.innerHTML = '';
    statsSubjects.textContent = '0';
    statsArticles.textContent = '0';
    errorEl.textContent = '';
}

// ---------- 登录成功 ----------
async function onLoginSuccess(user) {
    showLoggedIn(user);
    blogData = await loadBlogData();
    if (blogData.length === 0) {
        subjectContainer.innerHTML = `<p style="color:var(--gray);">暂无文章数据，请稍后重试。</p>`;
        return;
    }
    renderSubjects(blogData);
}

// ---------- 退出 ----------
function handleLogout() {
    logout();
    showLoggedOut();
    usernameInput.value = '';
    errorEl.textContent = '';
}

// ---------- 水平滚动 ----------
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
        showLoggedIn(user);
        blogData = await loadBlogData();
        if (blogData.length) renderSubjects(blogData);
    } else {
        showLoggedOut();
        // 导航“登录”按钮聚焦输入框
        navLoginBtn.addEventListener('click', () => {
            usernameInput.focus();
        });
    }

    // 登录提交
    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const username = usernameInput.value.trim();
        errorEl.textContent = '';
        if (!username) {
            errorEl.textContent = '请输入用户名';
            usernameInput.focus();
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

    // 退出
    navLogoutBtn.addEventListener('click', handleLogout);

    enableHorizontalScroll(scrollContainer);
}

initHome();

// ---------- 管理员快捷键 ----------
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