/**
 * drawing.js - 跨设备手写绘制（触控笔），带渐隐消失
 * 功能：平板笔绘制玫红色线条，3秒无操作后渐隐消失（约0.8秒淡出）
 * 限制：电脑鼠标、手机触摸、手指触摸均不可绘制
 */

(function () {
    if (!window.PointerEvent) {
        console.warn('当前浏览器不支持 Pointer Events，绘制功能不可用');
        return;
    }

    // 创建画布
    const canvas = document.createElement('canvas');
    canvas.style.position = 'fixed';
    canvas.style.top = '0';
    canvas.style.left = '0';
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.pointerEvents = 'none';
    canvas.style.zIndex = '9999';
    canvas.style.opacity = '1';
    document.body.appendChild(canvas);

    const ctx = canvas.getContext('2d');
    let isDrawing = false;
    let lastX = 0, lastY = 0;
    let clearTimer = null;
    let fadeId = null;
    let fadeStartTime = 0;
    const CLEAR_DELAY = 3000;
    const FADE_DURATION = 800;

    // 调整画布尺寸
    function resizeCanvas() {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
    }
    window.addEventListener('resize', resizeCanvas);
    resizeCanvas();

    // 清除所有线条（直接清除，无淡出）
    function clearCanvas() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        canvas.style.opacity = '1';
    }

    // 停止淡出动画
    function stopFade() {
        if (fadeId) {
            cancelAnimationFrame(fadeId);
            fadeId = null;
        }
        canvas.style.opacity = '1';
    }

    // 启动淡出
    function triggerFade() {
        if (fadeId) return;
        fadeStartTime = performance.now();
        function fadeStep(timestamp) {
            const elapsed = timestamp - fadeStartTime;
            const progress = Math.min(elapsed / FADE_DURATION, 1);
            canvas.style.opacity = 1 - progress;
            if (progress < 1) {
                fadeId = requestAnimationFrame(fadeStep);
            } else {
                clearCanvas();
                canvas.style.opacity = '1';
                fadeId = null;
            }
        }
        fadeId = requestAnimationFrame(fadeStep);
    }

    // 重置清除计时器
    function resetClearTimer() {
        stopFade();
        clearTimeout(clearTimer);
        clearTimer = setTimeout(triggerFade, CLEAR_DELAY);
    }

    // 检查是否允许绘制：仅允许触控笔
    function allowDrawing(e) {
        return e.pointerType === 'pen';
    }

    // 核心：统一阻止所有触控笔相关的滚动行为
    function preventPenScroll(e) {
        if (e.pointerType === 'pen') {
            e.preventDefault();
            return false;
        }
        return true;
    }

    // 绘制事件
    function startDraw(e) {
        if (!allowDrawing(e)) return;
        preventPenScroll(e);
        stopFade();
        clearTimeout(clearTimer);
        canvas.style.opacity = '1';
        isDrawing = true;
        lastX = e.clientX;
        lastY = e.clientY;
        resetClearTimer();
    }

    function draw(e) {
        if (!isDrawing) return;
        if (!allowDrawing(e)) {
            stopDraw();
            return;
        }
        preventPenScroll(e);
        const x = e.clientX;
        const y = e.clientY;
        ctx.beginPath();
        ctx.moveTo(lastX, lastY);
        ctx.lineTo(x, y);
        ctx.strokeStyle = '#FF007F';
        ctx.lineWidth = 4;
        ctx.lineCap = 'round';
        ctx.stroke();
        lastX = x;
        lastY = y;
        resetClearTimer();
    }

    function stopDraw() {
        isDrawing = false;
    }

    // ---- 注册全局事件监听（强化滚动阻止） ----

    // 1. 指针事件（用于绘制）
    document.addEventListener('pointerdown', startDraw);
    document.addEventListener('pointermove', draw);
    document.addEventListener('pointerup', stopDraw);
    document.addEventListener('pointerleave', stopDraw);

    // 2. 阻止触控笔引起的滚动（使用 capture 阶段，确保优先拦截）
    document.addEventListener('touchmove', function (e) {
        // 检查触控点是否来自触控笔（通过 touch 对象的 pointerType 无法直接获取）
        // 使用 passive: false 允许 preventDefault
        // 由于 touchmove 没有 pointerType，我们通过检查绘制状态和画布交互来判断
        // 更准确的方法：在 pointerdown 时标记绘制状态，touchmove 时阻止默认行为
        if (isDrawing) {
            e.preventDefault();
        }
    }, { passive: false, capture: true });

    // 3. 额外阻止鼠标滚轮滚动（如果触控笔模拟了滚轮）
    document.addEventListener('wheel', function (e) {
        if (isDrawing) {
            e.preventDefault();
        }
    }, { passive: false, capture: true });

    // 4. 阻止触控笔相关的其他默认手势
    document.addEventListener('gesturestart', function (e) {
        if (isDrawing) {
            e.preventDefault();
        }
    }, { passive: false, capture: true });

    // 清理
    window.addEventListener('beforeunload', function () {
        clearTimeout(clearTimer);
        stopFade();
        document.removeEventListener('pointerdown', startDraw);
        document.removeEventListener('pointermove', draw);
        document.removeEventListener('pointerup', stopDraw);
        document.removeEventListener('pointerleave', stopDraw);
        document.removeEventListener('touchmove', preventPenScroll);
        document.removeEventListener('wheel', preventPenScroll);
        document.removeEventListener('gesturestart', preventPenScroll);
        if (canvas.parentNode) canvas.parentNode.removeChild(canvas);
    });

})();