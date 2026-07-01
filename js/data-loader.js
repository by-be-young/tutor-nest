// js/data-loader.js
export async function loadBlogData() {
    try {
        const res = await fetch('data/blogs.json');
        if (!res.ok) throw new Error('加载文章数据失败');
        return await res.json();
    } catch (e) {
        console.error(e);
        return [];
    }
}

export function getBlogsBySubject(blogs, subject) {
    return blogs.filter(b => b.series === subject);
}

export function getAllSubjects(blogs) {
    return [...new Set(blogs.map(b => b.series))];
}