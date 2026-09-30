// theater-appearance: receives live state and cross-feature callbacks from index.js.
import { SOUND_PRESETS, LAMP_SVG_HTML } from './theater-defaults.js';
import { playSoundFile } from './notification-sound.js';
import { writeRuntimeLog, getRuntimeLogEntries } from './runtime-log.js';
import { theaterError as notifyTheaterError } from './notify.js';

export function createTheaterAppearance(runtime) {
// @theater-source-begin scopeSelector
function scopeSelector(selectorText, scope) {
    return selectorText.split(',').map(raw => {
        const sel = raw.trim();
        if (!sel) return '';
        // body / html / :root 这种代表整个文档的选择器，等价于 scope 本身
        if (/^(body|html|:root)$/i.test(sel)) return scope;
        // 形如 "body.foo" / "html[data-x]" —— 把开头的 body/html 摘掉，剩下的限定到 scope 上
        const stripDocRoot = sel.replace(/^(?:body|html|:root)(?=[.\[#:])/i, '');
        if (stripDocRoot !== sel) return `${scope}${stripDocRoot}`;
        // 已经以 scope 开头（含 .theater-popup-* BEM 命名），不重复加
        if (sel === scope || sel.startsWith(scope)) return sel;
        return `${scope} ${sel}`;
    }).filter(Boolean).join(', ');
}
// @theater-source-end scopeSelector

// @theater-source-begin scopeRules
function scopeRules(rules, scope) {
    const out = [];
    for (const rule of rules) {
        // CSSRule.STYLE_RULE = 1
        if (rule.type === 1) {
            const sel = scopeSelector(rule.selectorText, scope);
            if (sel) out.push(`${sel} { ${rule.style.cssText} }`);
        // MEDIA_RULE = 4
        } else if (rule.type === 4) {
            out.push(`@media ${rule.conditionText || rule.media.mediaText} {\n${scopeRules(rule.cssRules, scope)}\n}`);
        // SUPPORTS_RULE = 12
        } else if (rule.type === 12) {
            out.push(`@supports ${rule.conditionText} {\n${scopeRules(rule.cssRules, scope)}\n}`);
        // KEYFRAMES_RULE = 7 / FONT_FACE_RULE = 5 / IMPORT_RULE = 3 等都不需要 scope
        } else {
            out.push(rule.cssText || '');
        }
    }
    return out.join('\n');
}
// @theater-source-end scopeRules

// @theater-source-begin scopeCSS
function scopeCSS(cssText, scope) {
    if (!cssText?.trim()) return '';
    const probe = document.createElement('style');
    probe.media = 'not all'; // 解析但不让它生效
    probe.textContent = cssText;
    document.head.appendChild(probe);
    try {
        const rules = probe.sheet?.cssRules;
        if (!rules) return '';
        return scopeRules(rules, scope);
    } finally {
        probe.remove();
    }
}
// @theater-source-end scopeCSS

// @theater-source-begin applyCustomCSS
function applyCustomCSS() {
    $('#theater-custom-css-inject').remove();
    const raw = runtime.settings.customCSS;
    if (!raw?.trim()) return;
    try {
        const scoped = scopeCSS(raw, runtime.THEATER_SCOPE);
        if (scoped) $('head').append(`<style id="theater-custom-css-inject">${scoped}</style>`);
    } catch (e) {
        console.warn('[Theater] custom CSS scope failed:', e);
        toastr?.warning('自定义 CSS 解析失败，已跳过应用。请检查语法。');
    }
}
// @theater-source-end applyCustomCSS

// @theater-source-begin normalizeUIFontSize
function normalizeUIFontSize(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return runtime.defaultSettings.uiFontSize;
    return Math.min(20, Math.max(12, Math.round(n * 2) / 2));
}
// @theater-source-end normalizeUIFontSize

// @theater-source-begin fontSizeVars
function fontSizeVars(size = runtime.settings.uiFontSize) {
    const base = normalizeUIFontSize(size);
    return {
        xs: Math.max(10.5, base - 2),
        sm: Math.max(11.5, base - 1),
        base,
        md: base + 1.5,
        lg: base + 5.5,
        xl: base + 10.5,
    };
}
// @theater-source-end fontSizeVars

// @theater-source-begin applyUIFontSize
function applyUIFontSize() {
    $('#theater-font-size-inject').remove();
    const s = fontSizeVars();
    $('head').append(`<style id="theater-font-size-inject">
${runtime.THEATER_SCOPE} {
    --t-text-xs: ${s.xs}px;
    --t-text-sm: ${s.sm}px;
    --t-text-base: ${s.base}px;
    --t-text-md: ${s.md}px;
    --t-text-lg: ${s.lg}px;
    --t-text-xl: ${s.xl}px;
}
</style>`);
}
// @theater-source-end applyUIFontSize

// @theater-source-begin getSoundPreset
function getSoundPreset(id) {
    return SOUND_PRESETS.find(p => p.id === id) || SOUND_PRESETS[0];
}
// @theater-source-end getSoundPreset

// @theater-source-begin playNotificationSound
function playNotificationSound({ force = false } = {}) {
    if (!force && !runtime.settings.soundEnabled) return;
    const preset = getSoundPreset(runtime.settings.soundPreset);
    if (!preset) return;
    playSoundFile(preset.file, runtime.settings.soundVolume);
}
// @theater-source-end playNotificationSound

// @theater-source-begin runtimeLog
function runtimeLog(level, message, details) {
    const entry = writeRuntimeLog(level, message, details);
    renderRuntimeLog();
    const method = level === 'error' ? 'error' : (level === 'warn' ? 'warn' : 'info');
    console[method]('[Theater]', entry.message);
    return entry;
}
// @theater-source-end runtimeLog

// @theater-source-begin theaterError
function theaterError(message, title = '', opts = {}) {
    const text = String(message || '');
    const head = title || '小剧场报错';
    runtimeLog('error', head, { message: text });
    notifyTheaterError(text, head, opts);
}
// @theater-source-end theaterError

// @theater-source-begin renderRuntimeLog
function renderRuntimeLog() {
    const $list = $('#theater-runtime-log-list');
    if (!$list.length) return;
    const entries = getRuntimeLogEntries();
    $('#theater-runtime-log-count').text(entries.length);
    if (!entries.length) {
        $list.html('<p class="theater-empty">暂无运行日志</p>');
        return;
    }
    $list.html(entries.map(entry => `
<div class="theater-error-log-item theater-runtime-log-${entry.level}">
    <span class="theater-error-log-meta">${runtime.esc(entry.time)}</span>
    <span class="theater-runtime-log-level">[${runtime.esc(entry.level.toUpperCase())}]</span>
    <span class="theater-runtime-log-message">${runtime.esc(entry.message)}</span>
</div>`).join(''));
    const list = $list[0];
    if (list) list.scrollTop = list.scrollHeight;
}
// @theater-source-end renderRuntimeLog

// @theater-source-begin openTheaterPopupFromFloatingBall
function openTheaterPopupFromFloatingBall(releasePoint = {}) {
    const releaseX = Number(releasePoint.x);
    const releaseY = Number(releasePoint.y);
    let guardTimer = null;

    function removeOpeningClickGuard() {
        document.removeEventListener('click', guardOpeningClick, true);
        if (guardTimer) clearTimeout(guardTimer);
        guardTimer = null;
    }

    function guardOpeningClick(event) {
        const clickX = Number(event.clientX);
        const clickY = Number(event.clientY);
        if (!Number.isFinite(releaseX) || !Number.isFinite(releaseY)
            || !Number.isFinite(clickX) || !Number.isFinite(clickY)
            || Math.hypot(clickX - releaseX, clickY - releaseY) > runtime.FLOATING_BALL_OPEN_GUARD_RADIUS) return;
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        removeOpeningClickGuard();
    }

    // pointerup 后浏览器还会补发一次 click。先拦住同一位置的这次 click，
    // 再到下一轮事件循环打开弹窗，避免它落到刚出现的删除等按钮上。
    document.addEventListener('click', guardOpeningClick, true);
    guardTimer = setTimeout(removeOpeningClickGuard, runtime.FLOATING_BALL_OPEN_GUARD_MS);
    setTimeout(() => {
        try { runtime.openTheaterPopup(); } catch (err) { console.warn('[Theater] Popup error:', err); }
    }, 0);
}
// @theater-source-end openTheaterPopupFromFloatingBall

// @theater-source-begin createFloatingBall
function createFloatingBall() {
    try {
        if (runtime.floatingBallCleanup) runtime.floatingBallCleanup();
        runtime.floatingBallCleanup = null;
        document.querySelectorAll('#theater-floating-ball').forEach(el => el.remove());
        if (!runtime.settings.floatingBall) return;

        const ball = document.createElement('div');
        ball.id = 'theater-floating-ball';
        ball.title = '打开千夜浮梦';
        ball.innerHTML = LAMP_SVG_HTML;

        const savedPosition = runtime.settings.floatingBallPosition;
        const hasSavedPosition = savedPosition
            && ['left', 'right'].includes(savedPosition.side)
            && typeof savedPosition.yRatio === 'number'
            && Number.isFinite(savedPosition.yRatio);
        const maxTop = () => Math.max(0, window.innerHeight - 48);
        let yRatio = hasSavedPosition
            ? clamp(savedPosition.yRatio, 0, 1)
            : (maxTop() ? clamp(window.innerHeight - 126, 0, maxTop()) / maxTop() : 0);
        const initLeft = hasSavedPosition && savedPosition.side === 'left' ? 6 : window.innerWidth - 54;
        const initTop = yRatio * maxTop();

        // 贴边收纳：拖完吸附到最近的左/右边，闲置一会儿缩进边里半个身子
        const BASE_TRANSITION = 'transform 0.18s cubic-bezier(.2,.8,.2,1), opacity 0.18s, box-shadow 0.18s';
        const SNAP_TRANSITION = 'left 0.22s cubic-bezier(.2,.8,.2,1), ' + BASE_TRANSITION;
        const TUCK_DELAY = 2500;
        let tuckTimer = null;

        function cancelTuck() { if (tuckTimer) { clearTimeout(tuckTimer); tuckTimer = null; } }
        function untuck() {
            const side = ball.dataset.side || 'right';
            ball.dataset.tucked = 'false';
            ball.style.left = untuckedLeft(side) + 'px';
            ball.style.transform = 'scale(1) rotate(0)';
            ball.style.opacity = '0.92';
        }
        function untuckedLeft(side) {
            return side === 'left' ? 6 : window.innerWidth - 54;
        }
        function tuckedLeft(side) {
            return side === 'left' ? -22 : window.innerWidth - 26;
        }
        function scheduleTuck() {
            cancelTuck();
            if (!runtime.settings.floatingBallTuck) return;
            tuckTimer = setTimeout(() => {
                const side = ball.dataset.side || 'right';
                ball.dataset.tucked = 'true';
                ball.style.transition = SNAP_TRANSITION;
                ball.style.left = tuckedLeft(side) + 'px';
                ball.style.transform = 'scale(1) rotate(0)';
                ball.style.opacity = '0.45';
            }, TUCK_DELAY);
        }
        function snapToEdge(rememberPosition = false) {
            const w = window.innerWidth;
            const cur = parseInt(ball.style.left) || 0;
            const onLeft = cur + 24 < w / 2;
            ball.dataset.side = onLeft ? 'left' : 'right';
            ball.dataset.tucked = 'false';
            ball.style.transition = SNAP_TRANSITION;
            ball.style.left = untuckedLeft(ball.dataset.side) + 'px';
            if (rememberPosition) {
                yRatio = maxTop() ? clamp(parseFloat(ball.style.top) / maxTop(), 0, 1) : yRatio;
                runtime.settings.floatingBallPosition = { side: ball.dataset.side, yRatio };
                runtime.save();
            }
            if (runtime.settings.floatingBallTuck) scheduleTuck();
        }
        function isExternalCaptureModeActive() {
            return !!document.querySelector('.edge-panel-root .action-icon--active, .edge-panel-root [title*="捕获"].action-icon--active');
        }

        // 暖底 + 焦糖色油灯 + 软阴影
        ball.setAttribute('style', [
            'position:fixed !important',
            `left:${initLeft}px`,
            `top:${initTop}px`,
            'width:48px !important',
            'height:48px !important',
            'border-radius:50% !important',
            'background:linear-gradient(140deg, #FFF6E4 0%, #F5E0BC 100%) !important',
            'color:#8C5A2F !important',
            'border:1px solid rgba(140, 90, 47, 0.18) !important',
            'display:flex !important',
            'align-items:center !important',
            'justify-content:center !important',
            'font-size:1.2em !important',
            'cursor:pointer !important',
            'box-shadow:0 6px 18px rgba(140, 90, 47, 0.22), inset 0 1px 0 rgba(255,255,255,0.6) !important',
            'z-index:2147483647 !important',
            'opacity:0.92',
            'transition:transform 0.18s cubic-bezier(.2,.8,.2,1), opacity 0.18s, box-shadow 0.18s',
            '-webkit-user-select:none !important',
            'user-select:none !important',
            'touch-action:none !important',
            'pointer-events:auto !important',
        ].join(';'));

        let isDragging = false;
        let startedTucked = false;
        let activePointerId = null;
        let activeTouchId = null;
        let suppressMouseUntil = 0;
        let startX, startY, startLeft, startTop;

        function clamp(val, min, max) { return Math.max(min, Math.min(max, val)); }

        function addGestureListeners() {
            if (window.PointerEvent) {
                document.addEventListener('pointermove', onPointerMove, { passive: false });
                document.addEventListener('pointerup', onPointerUp);
                document.addEventListener('pointercancel', onPointerCancel);
                return;
            }
            document.addEventListener('mousemove', onPointerMove, { passive: false });
            document.addEventListener('mouseup', onPointerUp);
            document.addEventListener('touchmove', onTouchMove, { passive: false });
            document.addEventListener('touchend', onPointerUp);
            document.addEventListener('touchcancel', onPointerCancel);
        }

        function removeGestureListeners() {
            if (activePointerId !== null && ball.hasPointerCapture?.(activePointerId)) {
                try { ball.releasePointerCapture(activePointerId); } catch { /* 已由系统释放 */ }
            }
            document.removeEventListener('pointermove', onPointerMove);
            document.removeEventListener('pointerup', onPointerUp);
            document.removeEventListener('pointercancel', onPointerCancel);
            document.removeEventListener('mousemove', onPointerMove);
            document.removeEventListener('mouseup', onPointerUp);
            document.removeEventListener('touchmove', onTouchMove);
            document.removeEventListener('touchend', onPointerUp);
            document.removeEventListener('touchcancel', onPointerCancel);
            activePointerId = null;
            activeTouchId = null;
        }

        function activeChangedTouch(e) {
            if (activeTouchId === null) return null;
            return Array.from(e?.changedTouches || []).find(touch => touch.identifier === activeTouchId) || null;
        }

        function onPointerDown(e) {
            if (e.type === 'mousedown' && Date.now() < suppressMouseUntil) return;
            if (e.pointerId !== undefined) {
                if (activePointerId !== null) return;
                activePointerId = e.pointerId;
            } else if (e.touches) {
                if (activeTouchId !== null) return;
                const firstTouch = e.changedTouches?.[0] || e.touches[0];
                if (!firstTouch) return;
                activeTouchId = firstTouch.identifier;
                suppressMouseUntil = Date.now() + 800;
            }
            if (e.cancelable) e.preventDefault();
            cancelTuck();
            startedTucked = ball.dataset.tucked === 'true';
            untuck();
            ball.style.transition = BASE_TRANSITION;  // 拖动时 left 不能带动画，不然会"飘"
            isDragging = false;
            const touch = e.touches
                ? Array.from(e.touches).find(item => item.identifier === activeTouchId)
                : e;
            if (!touch) return;
            if (e.pointerId !== undefined && ball.setPointerCapture) {
                try { ball.setPointerCapture(e.pointerId); } catch { /* 某些旧 WebView 不支持捕获 */ }
            }
            startX = touch.clientX;
            startY = touch.clientY;
            startLeft = parseInt(ball.style.left);
            startTop = parseInt(ball.style.top);
            addGestureListeners();
        }

        function onPointerMove(e) {
            if (e.pointerId !== undefined && e.pointerId !== activePointerId) return;
            const dx = e.clientX - startX;
            const dy = e.clientY - startY;
            if (Math.abs(dx) > 5 || Math.abs(dy) > 5) isDragging = true;
            if (!isDragging) return;
            if (e.cancelable) e.preventDefault();
            ball.style.left = clamp(startLeft + dx, 0, window.innerWidth - 46) + 'px';
            ball.style.top = clamp(startTop + dy, 0, maxTop()) + 'px';
        }

        function onTouchMove(e) {
            const touch = Array.from(e.touches || []).find(item => item.identifier === activeTouchId);
            if (!touch) return;
            if (e.cancelable) e.preventDefault();
            const dx = touch.clientX - startX;
            const dy = touch.clientY - startY;
            if (Math.abs(dx) > 5 || Math.abs(dy) > 5) isDragging = true;
            if (!isDragging) return;
            ball.style.left = clamp(startLeft + dx, 0, window.innerWidth - 46) + 'px';
            ball.style.top = clamp(startTop + dy, 0, maxTop()) + 'px';
        }

        function onPointerCancel(e) {
            if (e?.pointerId !== undefined && e.pointerId !== activePointerId) return;
            if (e?.changedTouches && !activeChangedTouch(e)) return;
            const wasDragging = isDragging;
            removeGestureListeners();
            isDragging = false;
            startedTucked = false;
            if (wasDragging) snapToEdge(true);
            else scheduleTuck();
        }

        function onPointerUp(e) {
            if (e?.pointerId !== undefined && e.pointerId !== activePointerId) return;
            const changedTouch = e?.changedTouches ? activeChangedTouch(e) : null;
            if (e?.changedTouches && !changedTouch) return;
            const release = changedTouch || e;
            const releasePoint = {
                x: Number.isFinite(Number(release?.clientX)) ? Number(release.clientX) : startX,
                y: Number.isFinite(Number(release?.clientY)) ? Number(release.clientY) : startY,
            };
            removeGestureListeners();
            if (!isDragging) {
                if (isExternalCaptureModeActive()) {
                    untuck();
                } else if (startedTucked) {
                    untuck();
                    scheduleTuck();
                } else {
                    openTheaterPopupFromFloatingBall(releasePoint);
                    untuck();
                }
                isDragging = false;
                startedTucked = false;
                return;
            }
            isDragging = false;
            startedTucked = false;
            snapToEdge(true);
        }

        if (window.PointerEvent) {
            ball.addEventListener('pointerdown', onPointerDown);
        } else {
            ball.addEventListener('mousedown', onPointerDown);
            ball.addEventListener('touchstart', onPointerDown, { passive: false });
        }

        ball.addEventListener('mouseenter', () => {
            cancelTuck();
            ball.style.opacity = '1';
            ball.style.transform = 'scale(1.1) rotate(-8deg)';
            ball.style.boxShadow = '0 10px 24px rgba(140, 90, 47, 0.32), inset 0 1px 0 rgba(255,255,255,0.7)';
        });
        ball.addEventListener('mouseleave', () => {
            ball.style.opacity = '0.92';
            ball.style.transform = 'scale(1) rotate(0)';
            ball.style.boxShadow = '0 6px 18px rgba(140, 90, 47, 0.22), inset 0 1px 0 rgba(255,255,255,0.6)';
            scheduleTuck();
        });

        function onViewportResize() {
            if (!ball.isConnected) return;
            const side = ball.dataset.side || 'right';
            const tucked = ball.dataset.tucked === 'true';
            ball.style.top = (yRatio * maxTop()) + 'px';
            ball.style.left = (tucked ? tuckedLeft(side) : untuckedLeft(side)) + 'px';
        }

        document.documentElement.appendChild(ball);
        window.addEventListener('resize', onViewportResize);
        runtime.floatingBallCleanup = () => {
            cancelTuck();
            removeGestureListeners();
            window.removeEventListener('resize', onViewportResize);
            ball.remove();
        };
        runtime.refreshUpdateBadges();
        snapToEdge();
    } catch (e) {
        console.warn('[Theater] Floating ball error:', e);
    }
}
// @theater-source-end createFloatingBall

return { scopeSelector, scopeRules, scopeCSS, applyCustomCSS, normalizeUIFontSize, fontSizeVars, applyUIFontSize, getSoundPreset, playNotificationSound, runtimeLog, theaterError, renderRuntimeLog, openTheaterPopupFromFloatingBall, createFloatingBall };
}
