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

    // ---- 创建画布 ----
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

    // ---- 调整画布尺寸 ----
    function resizeCanvas() {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
    }
    window.addEventListener('resize', resizeCanvas);
    resizeCanvas();

    // ---- 清除所有线条（直接清除，无淡出） ----
    function clearCanvas() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        canvas.style.opacity = '1';
    }

    // ---- 停止淡出动画 ----
    function stopFade() {
        if (fadeId) {
            cancelAnimationFrame(fadeId);
            fadeId = null;
        }
        canvas.style.opacity = '1';
    }

    // ---- 启动淡出 ----
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

    // ---- 重置清除计时器 ----
    function resetClearTimer() {
        stopFade();
        clearTimeout(clearTimer);
        clearTimer = setTimeout(triggerFade, CLEAR_DELAY);
    }

    // ---- 检查是否允许绘制（修改点：仅允许触控笔） ----
    function allowDrawing(e) {
        const type = e.pointerType;
        // 只允许触控笔（平板笔），鼠标和触摸一律禁止
        return type === 'pen';
    }

    // ---- 绘制事件 ----
    function startDraw(e) {
        if (!allowDrawing(e)) return;
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

    // ---- 注册全局指针事件 ----
    document.addEventListener('pointerdown', startDraw);
    document.addEventListener('pointermove', draw);
    document.addEventListener('pointerup', stopDraw);
    document.addEventListener('pointerleave', stopDraw);

    // ---- 清理 ----
    window.addEventListener('beforeunload', function () {
        clearTimeout(clearTimer);
        stopFade();
        document.removeEventListener('pointerdown', startDraw);
        document.removeEventListener('pointermove', draw);
        document.removeEventListener('pointerup', stopDraw);
        document.removeEventListener('pointerleave', stopDraw);
        if (canvas.parentNode) canvas.parentNode.removeChild(canvas);
    });

})();