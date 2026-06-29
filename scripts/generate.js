const fs = require('fs');
const path = require('path');

const BLOGS_DIR = path.join(__dirname, '..', 'blogs');
const DATA_DIR = path.join(__dirname, '..', 'data');
const OUTPUT_FILE = path.join(DATA_DIR, 'blogs.json');

if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

function getAllMdFiles(dir, baseDir = BLOGS_DIR) {
    let results = [];
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            results = results.concat(getAllMdFiles(fullPath, baseDir));
        } else if (entry.isFile() && entry.name.endsWith('.md')) {
            const relativePath = path.relative(baseDir, fullPath);
            const pathParts = relativePath.split(path.sep);
            const series = pathParts[0];
            const title = path.basename(entry.name, '.md');
            results.push({
                filePath: fullPath,
                series: series,
                title: title,
                path: relativePath.replace(/\\/g, '/')
            });
        }
    }
    return results;
}

const mdFiles = getAllMdFiles(BLOGS_DIR);
let allBlogs = [];
let idCounter = 1;

mdFiles.forEach(({ filePath, series, title, path: relativePath }) => {
    const stats = fs.statSync(filePath);
    const date = stats.mtime.toISOString().split('T')[0];
    allBlogs.push({
        id: idCounter++,
        title: title,
        series: series,
        date: date,
        path: relativePath  // 只存相对路径，不存正文
    });
});

allBlogs.sort((a, b) => new Date(b.date) - new Date(a.date));

fs.writeFileSync(OUTPUT_FILE, JSON.stringify(allBlogs, null, 2));
console.log(`✅ 成功生成 ${allBlogs.length} 篇博客数据，保存在 ${OUTPUT_FILE}`);