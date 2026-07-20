const NUMBER_PATTERN = '(\\d[\\d,]*(?:\\.\\d+)?\\s*[kK]?|[零〇一二两三四五六七八九十百千万]+)';

const TARGET_PATTERNS = [
    new RegExp(`(?:至少|不少于|不低于|起码|最低|保底|大于|超过|写满|达到|达成)\\s*${NUMBER_PATTERN}\\s*(?:个)?字`),
    new RegExp(`${NUMBER_PATTERN}\\s*(?:个)?字\\s*(?:以上|起|左右|上下|内)`),
    new RegExp(`(?:写|生成|输出|正文|篇幅|字数)[^\\n。；;]{0,12}?${NUMBER_PATTERN}\\s*(?:个)?字`),
];

export const LENGTH_TIERS = Object.freeze({
    SHORT: 'short',
    COMFORT: 'comfort',
    LONG: 'long',
    UNSPECIFIED: 'unspecified',
});

export const STAGED_RENDER_THRESHOLD = 5000;
export const LONG_FORM_SPLIT_THRESHOLD = 8000;

export function parseChineseNumber(raw) {
    const text = String(raw || '').trim();
    if (!text) return null;
    if (/^\d+(?:\.\d+)?\s*[kK]$/.test(text)) return Math.round(parseFloat(text) * 1000);
    if (/^\d[\d,]*(?:\.\d+)?$/.test(text)) return Math.round(parseFloat(text.replace(/,/g, '')));

    const digits = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
    const units = { 十: 10, 百: 100, 千: 1000, 万: 10000 };
    let total = 0, section = 0, number = 0, seen = false;
    for (const ch of text) {
        if (digits[ch] !== undefined) {
            number = digits[ch];
            seen = true;
        } else if (units[ch]) {
            seen = true;
            const unit = units[ch];
            if (unit === 10000) {
                section = (section + number) || 1;
                total += section * unit;
                section = 0;
            } else {
                section += (number || 1) * unit;
            }
            number = 0;
        }
    }
    return seen ? total + section + number : null;
}

function findTargetMatch(instruction) {
    const text = String(instruction || '').replace(/，/g, ',');
    for (const pattern of TARGET_PATTERNS) {
        const match = text.match(pattern);
        const value = parseChineseNumber(match?.[1]);
        if (match && value && value >= 100) return { match, value, text };
    }
    return null;
}

export function parseTargetWordCount(instruction) {
    return findTargetMatch(instruction)?.value || null;
}

export function normalizeManualTarget(value, fallback = 3000) {
    const parsed = Math.round(Number(value));
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(100000, Math.max(100, parsed));
}

export function resolveTargetWordCount(instruction, { manualEnabled = false, manualTarget = 3000 } = {}) {
    return manualEnabled ? normalizeManualTarget(manualTarget) : parseTargetWordCount(instruction);
}

export function stripTargetWordCountRequirement(instruction) {
    const found = findTargetMatch(instruction);
    if (!found) return String(instruction || '').trim();
    const escapedNumber = String(found.match[1]).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const targetPhrase = new RegExp(`(?:约|大约|至少|不少于|不低于|起码|最低|保底|大于|超过|写满|达到|达成)?\\s*${escapedNumber}\\s*(?:个)?字\\s*(?:以上|起|左右|上下|以内|内)?(?:的)?`, 'gi');
    const cleaned = found.text
        .replace(targetPhrase, '')
        .replace(/(?:字数|篇幅)(?:要求|目标)?\s*(?:控制|设定)?\s*(?:为|在|达到|达成)?\s*(?=[，,。；;]|$)/g, '')
        .replace(/一个的/g, '一个')
        .replace(/^[\s，,。；;：:、-]+|[\s，,。；;：:、-]+$/g, '')
        .replace(/\s{2,}/g, ' ')
        .trim();
    return cleaned;
}

export function classifyLengthTier(targetChars) {
    if (!targetChars) return LENGTH_TIERS.UNSPECIFIED;
    if (targetChars <= 3000) return LENGTH_TIERS.SHORT;
    if (targetChars <= 5000) return LENGTH_TIERS.COMFORT;
    return LENGTH_TIERS.LONG;
}

export function firstRoundGuidance(targetChars) {
    const target = Math.round(Number(targetChars));
    if (!Number.isFinite(target) || target <= 0) return '充分展开剧情，不急于收尾。';
    return `本篇小剧场的可读中文正文目标约为 ${target} 字（不含 HTML、CSS、JavaScript 和排版代码）。请从开篇开始按照这一完整篇幅规划剧情，在接近目标前不要过早收束；用有效情节、动作、对白和心理变化充分展开，不要复述、注水，也不要在正文中报告或标注字数。`;
}

export function isLongFormTarget(targetChars) {
    const target = Math.round(Number(targetChars));
    return Number.isFinite(target) && target >= LONG_FORM_SPLIT_THRESHOLD;
}

export function isStagedRenderTarget(targetChars) {
    const target = Math.round(Number(targetChars));
    return Number.isFinite(target) && target >= STAGED_RENDER_THRESHOLD;
}

export function longFormFirstRoundTarget(targetChars) {
    const target = Math.max(0, Math.round(Number(targetChars) || 0));
    return target ? Math.ceil((target / 2) / 100) * 100 : 0;
}

export function longFormFirstRoundGuidance(targetChars) {
    const target = Math.max(0, Math.round(Number(targetChars) || 0));
    const firstRoundTarget = longFormFirstRoundTarget(target);
    return `本篇长篇小剧场的可读中文正文总目标约为 ${target} 字。本轮只创作上半篇纯文字正文，目标约 ${firstRoundTarget} 字（不含 HTML、CSS、JavaScript 和排版代码）；请从开篇充分展开并停在剧情中段，保留明确的发展空间，不要总结、收束、写出结局或“未完待续”等提示。用有效情节、动作、对白和心理变化推进，不要复述、注水，也不要在正文中报告或标注字数。`;
}
