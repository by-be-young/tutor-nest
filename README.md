# 📚 家教资料系统

一个基于 **Supabase** 的轻量级家教资料管理平台，专为家教场景设计，支持学生登录、资料权限控制、树状目录展示、管理员后台管理等功能。

---

## ✨ 主要功能

- **🔐 学生登录系统**：首页集成登录框，仅需用户名即可登录（无密码），登录后显示有权限的科目。
- **📂 资料与权限控制**：
  - 每个学生只能看到自己有权限的科目。
  - 科目内仅显示有权限的资料（文章）。
  - 资料详情页自动校验权限，无权限则提示访问受限。
- **🌳 树状目录展示**：分类页以文件夹-文件树形结构展示资料，支持展开/折叠，便于按章节组织学习资料。
- **👑 管理员后台**：
  - 无入口提示：首页输入隐藏密码进入（防止学生误入）。
  - 管理学生：新增学生、切换查看不同学生的权限。
  - 权限管理：树状展示所有资料，勾选即可授权/取消授权。
  - 自动保存：退出前自动保存，也可手动保存权限。
- **📝 学习资料支持**：
  - 资料正文使用 Markdown 编写，支持课件、讲义、习题等。
  - 支持 KaTeX 数学公式（行内 `$...$`、块级 `$$...$$`），适合数理化资料。
  - 支持代码高亮、表格、引用等，适合编程或实验资料。
- **📱 响应式设计**：电脑端宽屏大字号，手机端紧凑适配，学生可随时随地学习。
- **🎨 马卡龙色系**：柔和青绿色调，视觉舒适，减轻学习疲劳。

---

## 🛠️ 技术栈

| 类别 | 技术 |
|------|------|
| 前端 | HTML5, CSS3, JavaScript (ES Module) |
| 数据库 | Supabase (PostgreSQL) |
| 认证 | 无密码登录（基于 `student` 表） |
| Markdown 渲染 | [marked.js](https://marked.js.org/) |
| 数学公式 | [KaTeX](https://katex.org/) |
| 图标 | [Font Awesome](https://fontawesome.com/) |
| 构建 | Node.js (仅用于生成 `blogs.json`) |

---

## 📁 项目结构

```
├── blogs/                      # 学习资料（Markdown 源文件）
│   ├── 英语/                   # 科目文件夹
│   │   ├── xx/               # 子目录（可任意层级）
│   │   │   └── xxxx.md
│   │   └── xx/
│   │       └── xxxx.md
│   └── 化学/
│       └── xx/
│           └── xxxx.md
├── data/
│   └── blogs.json              # 脚本生成的资料索引
├── css/
│   ├── style.css               # 全局样式
│   └── admin.css               # 管理员页面样式
├── js/
│   ├── supabase-client.js      # Supabase 客户端初始化
│   ├── auth.js                 # 登录/退出/权限检查
│   ├── admin.js                # 管理员页面逻辑
│   ├── main.js                 # 分类页/详情页渲染
│   └── katex-loader.js         # KaTeX 自动加载与渲染
├── scripts/
│   └── generate.js             # 扫描 blogs/ 生成 blogs.json
├── index.html                  # 首页 + 学生登录
├── category.html               # 分类页（树状目录）
├── detail.html                 # 资料详情页
├── admin.html                  # 管理员后台
└── package.json                # npm 脚本
```

---

## 👨‍🏫 使用流程

### 学生端
1. 打开首页，输入用户名登录。
2. 登录后，仅显示有权限的科目卡片。
3. 点击科目进入分类页，查看树状资料目录。
4. 点击资料名称，进入详情页学习。
5. 无权限的资料不会显示入口。

### 管理员端
1. 在首页输入隐藏密码进入后台。
2. 新增学生：点击「新增」按钮，输入学生姓名。
3. 切换学生：在下拉列表中选择要管理的学生。
4. 授权资料：在资料树中勾选/取消勾选，点击「保存」。
5. 退出时自动保存权限。

---

## 📝 资料编写规范

### 创建新资料
1. 在 `blogs/科目/子目录/` 下创建 `.md` 文件。
2. 文件名即为资料标题（无需 Front Matter）。
3. 运行 `npm run generate` 更新索引。
4. 在管理员页面为学生授权。

### 资料内嵌公式示例
```markdown
# 勾股定理

直角三角形的两条直角边分别为 $a$ 和 $b$，斜边为 $c$，满足：

$$ a^2 + b^2 = c^2 $$

## 例题
已知 $a=3$，$b=4$，求 $c$。
$$ c = \sqrt{3^2 + 4^2} = 5 $$
```

---

## 🔧 自定义与扩展

- **新增科目**：在 `blogs/` 下创建新文件夹即可，无需修改代码。
- **修改配色**：调整 `css/style.css` 中的 `:root` 变量。
- **添加资料属性**：修改 `scripts/generate.js` 添加字段，同步更新前端渲染逻辑。

---

# 代码编写规范

## 一、总体原则

1. **一致性优先**：同一功能使用相同的写法，不混用风格。
2. **语义化命名**：名称应清晰表达意图，避免缩写（除非约定俗成）。
3. **渐进增强**：核心功能在所有浏览器可用，样式和交互逐步增强。
4. **文件组织**：按功能拆分文件，避免单个文件过大。

---

## 二、HTML 规范

### 2.1 文档结构

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>页面标题</title>
    <!-- CSS 放在 head 中 -->
    <link rel="stylesheet" href="css/style.css">
</head>
<body>
    <!-- 页面内容 -->
    <!-- JS 放在 body 末尾 -->
    <script type="module" src="js/main.js"></script>
</body>
</html>
```

### 2.2 命名

- `id` 使用 **kebab-case**（如 `login-area`、`subject-cards-wrapper`）
- `class` 使用 **kebab-case**（如 `detail-title`、`question-card`）
- 布尔属性（如 `disabled`、`checked`）不写值

### 2.3 语义化标签

- 使用 `<header>`、`<footer>`、`<main>`、`<section>`、`<nav>` 代替通用 `<div>`
- 按钮使用 `<button>` 而非 `<div>` 模拟
- 链接使用 `<a>`，明确 `href`

### 2.4 表单

- 所有 `<input>` 配有 `<label>`（使用 `for` 或包裹）
- 提交按钮设置 `type="submit"`，普通按钮设置 `type="button"`

---

## 三、CSS 规范

### 3.1 文件组织

```
css/
├── style.css              # 首页样式
├── category-and-detail.css # 分类页 & 详情页
└── admin.css              # 管理员页
```

- 每个文件只负责对应页面的样式，不混用。
- 公共变量（颜色、间距）使用 CSS 自定义属性（`--var`）统一管理。

### 3.2 命名约定（BEM 变体）

- **块（Block）**：独立组件，如 `.subject-card`
- **元素（Element）**：块的子部分，用 `__` 连接，如 `.subject-card__title`
- **修饰符（Modifier）**：状态或变体，用 `--` 或 `is-`，如 `.subject-card--large`、`.is-active`

> 本项目中使用 `is-` 前缀表示状态（如 `is-active`、`is-hidden`），使用 `--` 表示尺寸或颜色变体（如 `card-english`）。

### 3.3 选择器

- 避免超过 3 层嵌套
- 不使用 `!important`（除非覆盖第三方库）
- 类名优先于标签选择器（`.btn` 优于 `button`）

### 3.4 响应式

- 使用 **移动优先** 或 **桌面优先** 策略，但需统一。
- 断点使用：
  - `640px` 以下：手机
  - `641px ~ 1023px`：平板
  - `1024px` 及以上：桌面

```css
@media (max-width: 640px) { /* 手机 */ }
@media (min-width: 641px) and (max-width: 1023px) { /* 平板 */ }
@media (min-width: 1024px) { /* 桌面 */ }
```

---

## 四、JavaScript 规范

### 4.1 文件组织

```
js/
├── main.js           # 分类页 & 详情页逻辑
├── home.js           # 首页逻辑
├── admin.js          # 管理员页逻辑
├── auth.js           # 登录/注册/权限
├── data-loader.js    # 数据加载
└── supabase-client.js # Supabase 客户端
```

- 每个文件使用 ES Module（`import` / `export`）。
- 入口 HTML 通过 `<script type="module">` 引入。

### 4.2 命名

- **变量 / 函数**：`camelCase`（如 `getCurrentUser`、`questionIdList`）
- **常量**：`UPPER_SNAKE_CASE`（如 `SUPABASE_URL`）
- **类 / 构造函数**：`PascalCase`（如 `DetailState`）
- **布尔变量**：以 `is`、`has`、`should` 开头（如 `isDesktop`、`hasPermission`）

### 4.3 函数

- 单一职责，每个函数只做一件事。
- 函数名使用动词开头（如 `loadData`、`renderSubjects`）。
- 参数尽量少（不超过 3 个），过多时使用对象参数。

### 4.4 异步操作

- 使用 `async / await` 代替回调或 `.then` 链。
- 捕获错误使用 `try / catch`，并记录或提示用户。

```javascript
async function fetchData() {
    try {
        const res = await fetch(url);
        return await res.json();
    } catch (error) {
        console.error('加载失败:', error);
        return null;
    }
}
```

### 4.5 DOM 操作

- 使用 `querySelector` / `querySelectorAll`，避免 `getElementById`（除非必要）。
- 批量 DOM 操作使用 `DocumentFragment` 或 `innerHTML` 一次性插入。
- 事件监听使用 `addEventListener`，避免 `onclick` 属性。

### 4.6 状态管理

- 页面状态集中在一个对象中（如 `detailState`），避免散落在全局变量。
- 状态变更通过函数封装，不要直接修改。

### 4.7 调试输出

- 开发阶段保留关键 `console.log`，生产环境应移除或使用日志级别控制。
- 错误日志使用 `console.error`，警告使用 `console.warn`。

---

## 五、注释规范

### 5.1 文件头

每个 JS / CSS 文件顶部注明用途：

```javascript
// js/main.js - 分类页与详情页渲染、题目交互、提交与批阅逻辑
```

```css
/* css/style.css - 首页样式（登录框、科目卡片、用户信息栏） */
```

### 5.2 函数注释（JSDoc 风格）

```javascript
/**
 * 加载学生提交记录
 * @param {number} blogId - 文章ID
 * @param {number|string} studentId - 学生ID
 * @returns {Promise<Map>} 提交记录 Map，键为 question_id
 */
async function loadQuestionSubmissions(blogId, studentId) {
    // ...
}
```

### 5.3 复杂逻辑注释

- 在复杂条件、算法、正则表达式前添加注释说明意图。
- 不要注释显而易见的代码（如 `i++`），注释应解释“为什么”而不是“是什么”。

---

## 六、Git 提交规范

- 提交信息使用 **动词 + 简短描述**，如：
  - `feat: 添加用户登录功能`
  - `fix: 修复历史记录不显示的问题`
  - `style: 调整首页卡片布局`
  - `refactor: 重构题目卡片渲染逻辑`
- 每次提交保持原子性（一个功能 / 一个修复）。

---

## 七、第三方库

- 使用 CDN 加载时，指定具体版本号（如 `@0.16.9`）。
- 如需更新版本，先测试兼容性。
- 尽量不要引入过多库，保持项目轻量。

---

## 八、安全

- 用户输入内容在插入 DOM 前进行转义（使用 `escapeHtml` 等函数）。
- Supabase 密钥仅用于前端，切勿暴露敏感密钥（已使用 ANON_KEY）。
- 权限校验同时在服务端（RLS）和客户端进行，不信任前端数据。

---

## 📄 许可证

MIT License

---

**Made with ❤️ for better tutoring**
```