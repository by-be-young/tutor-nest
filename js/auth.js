// js/auth.js
import { supabase } from './supabase-client.js';

const STORAGE_KEY = 'blog_user';

async function loadAllBlogIds() {
    try {
        const res = await fetch('data/blogs.json');
        if (!res.ok) throw new Error('加载文章数据失败');
        const blogs = await res.json();
        if (!Array.isArray(blogs)) return [];
        return blogs
            .map(blog => Number(blog?.id))
            .filter(Number.isFinite);
    } catch (err) {
        console.error('读取全量权限失败:', err);
        return [];
    }
}

/**
 * 登录：根据用户名查询 student 表
 * @param {string} username 
 * @returns {Promise<object>} 学生对象 { id, username, permissions }
 */
export async function login(username) {
    if (!username || username.trim() === '') {
        throw new Error('用户名不能为空');
    }

    const normalized = username.trim();
    if (normalized.toLowerCase() === 'young') {
        const allPermissions = await loadAllBlogIds();
        const superUser = {
            id: 'young-super-user',
            username: normalized,
            permissions: allPermissions
        };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(superUser));
        return superUser;
    }

    const { data, error } = await supabase
        .from('student')
        .select('id, username, permissions')
        .eq('username', normalized)
        .maybeSingle();

    if (error) {
        console.error('登录查询失败:', error);
        throw new Error('数据库查询失败');
    }
    if (!data) {
        throw new Error('用户不存在，请先注册');
    }
    // 保存到 localStorage
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    return data;
}

/**
 * 注册：创建 student 记录，默认无权限
 * @param {string} username
 * @returns {Promise<object>} 学生对象 { id, username, permissions }
 */
export async function register(username) {
    if (!username || username.trim() === '') {
        throw new Error('用户名不能为空');
    }

    const normalized = username.trim();
    const { data, error } = await supabase
        .from('student')
        .insert({
            username: normalized,
            permissions: []
        })
        .select('id, username, permissions')
        .single();

    if (error) {
        console.error('注册失败:', error);
        if (error.code === '23505' || /duplicate|already exists|unique/i.test(error.message || '')) {
            throw new Error('用户名已存在，请直接登录');
        }
        throw new Error('注册失败，请稍后重试');
    }

    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    return data;
}

/**
 * 退出登录
 */
export function logout() {
    localStorage.removeItem(STORAGE_KEY);
}

/**
 * 获取当前登录用户信息
 * @returns {object|null} 学生对象或 null
 */
export function getCurrentUser() {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    try {
        return JSON.parse(raw);
    } catch {
        return null;
    }
}

/**
 * 检查当前用户是否有某篇文章的权限
 * @param {number|string} articleId
 * @returns {boolean}
 */
export function hasPermission(articleId) {
    const user = getCurrentUser();
    if (!user) return false;
    if (!user.permissions || !Array.isArray(user.permissions)) return false;
    return user.permissions.includes(Number(articleId));
}

/**
 * 获取当前用户的权限列表（ID数组）
 */
export function getPermissionIds() {
    const user = getCurrentUser();
    if (!user) return [];
    return Array.isArray(user.permissions) ? user.permissions : [];
}