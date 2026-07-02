const fs = require('fs');
const path = require('path');

const BLOGS_DIR = path.join(__dirname, '..', 'blogs');
const DATA_DIR = path.join(__dirname, '..', 'data');
const OUTPUT_FILE = path.join(DATA_DIR, 'blogs.json');
const ID_MAP_FILE = path.join(DATA_DIR, 'id_map.json'); // 用于持久化 ID 映射

if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

// 读取已有的 ID 映射
function loadIdMap() {
    if (fs.existsSync(ID_MAP_FILE)) {
        try {
            return JSON.parse(fs.readFileSync(ID_MAP_FILE, 'utf8'));
        } catch (e) {
            console.warn('⚠️  ID 映射文件损坏，将重新创建');
            return {};
        }
    }
    return {};
}

// 保存 ID 映射
function saveIdMap(idMap) {
    fs.writeFileSync(ID_MAP_FILE, JSON.stringify(idMap, null, 2));
}

// 获取所有 .md 文件
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

// ===== 主逻辑 =====
const mdFiles = getAllMdFiles(BLOGS_DIR);
const idMap = loadIdMap();
let maxId = 0;

// 计算当前最大 ID
Object.values(idMap).forEach(id => {
    if (id > maxId) maxId = id;
});

// 构建路径 -> 文件信息 的映射（用于判断文件是否还存在）
const pathMap = {};
mdFiles.forEach(file => {
    pathMap[file.path] = file;
});

// 清理已删除文件的 ID 映射（可选：保留已删除文件的 ID 不重用，避免混乱）
// 此处我们保留所有 ID，只新增不删除，防止 ID 复用导致关联错误

const allBlogs = [];
const newIdMap = {};

// 遍历所有 .md 文件
mdFiles.forEach(({ filePath, series, title, path: relativePath }) => {
    const stats = fs.statSync(filePath);
    const date = stats.mtime.toISOString().split('T')[0];

    // 查找是否已有 ID
    let id = idMap[relativePath];

    if (!id) {
        // 新文件，分配新 ID
        maxId += 1;
        id = maxId;
        console.log(`🆕 新文件: ${relativePath} -> ID: ${id}`);
    }

    newIdMap[relativePath] = id;

    allBlogs.push({
        id: id,
        title: title,
        series: series,
        date: date,
        path: relativePath
    });
});

// 保存 ID 映射
saveIdMap(newIdMap);

// 按日期排序（最新的在前）
allBlogs.sort((a, b) => new Date(b.date) - new Date(a.date));

// 写入 blogs.json
fs.writeFileSync(OUTPUT_FILE, JSON.stringify(allBlogs, null, 2));
console.log(`✅ 成功生成 ${allBlogs.length} 篇博客数据，保存在 ${OUTPUT_FILE}`);
console.log(`📊 当前最大 ID: ${maxId}`);