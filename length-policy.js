const NUMBER_PATTERN = '(\\d[\\d,]*(?:\\.\\d+)?\\s*[kK千万]?|[零〇一二两三四五六七八九十百千万]+)';
const TARGET_PREFIX = '(?:不得少于|不能少于|不可少于|不得低于|不能低于|不可低于|不得超过|不能超过|不可超过|不少于|不低于|不超过|不多于|至少|至多|最多|最少|起码|最低|最高|保底|大于|超过|少于|低于|写满|达到|达成|大约|大概|约莫|约)';
const TARGET_SUFFIX = '(?:以上|以下|左右|上下|以内|附近|内|起)';

const TARGET_PATTERNS = [
    new RegExp(`${TARGET_PREFIX}\\s*[：:]?\\s*${NUMBER_PATTERN}\\s*(?:个)?字`),
    new RegExp(`(?<![\\d,.])${NUMBER_PATTERN}\\s*(?:个)?字\\s*${TARGET_SUFFIX}`),
    new RegExp(`(?:写|生成|输出|正文|篇幅|字数)[^\\n。；;]{0,12}?${NUMBER_PATTERN}\\s*(?:个)?字`),
    new RegExp(`(?:字数|篇幅)(?:要求|目标)?\\s*[：:=为在]?\\s*${NUMBER_PATTERN}(?:\\s*字)?(?=[\\s。；;！!，,]|$)`),
    new RegExp(`^\\s*${NUMBER_PATTERN}\\s*(?:个)?字\\s*[。！!]?\\s*$`, 'm'),
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
    const scaled = text.match(/^(\d[\d,]*(?:\.\d+)?)\s*([kK千万])$/);
    if (scaled) return Math.round(Number(scaled[1].replace(/,/g, '')) * (scaled[2] === '万' ? 10000 : 1000));
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
    const targetPhrase = new RegExp(`(?:${TARGET_PREFIX}\\s*[：:]?)?\\s*${escapedNumber}\\s*(?:个)?字\\s*${TARGET_SUFFIX}?(?:的)?`, 'gi');
    const cleaned = found.text
        .replace(targetPhrase, '')
        .replace(new RegExp(`(?:字数|篇幅)(?:要求|目标)?\\s*[：:=为在]?\\s*${escapedNumber}(?![\\d.])(?:\\s*字)?`, 'gi'), '')
        .replace(/(?:字数|篇幅)(?:要求|目标)?\s*(?:控制|设定)?\s*(?:为|在|达到|达成)?\s*[：:=]?\s*(?=[，,。；;]|$)/g, '')
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
    return `本篇小剧场是一份总目标约为 ${target} 字的完整作品，将由多个纯正文轮共同完成。本轮只创作前半部分，目标约 ${firstRoundTarget} 字（不含 HTML、CSS、JavaScript 和排版代码）；请从开篇充分展开核心事件并停在剧情发展途中，不要把本轮压缩成独立完结篇，不要总结、收束、写出结局或“未完待续”等提示。用有效情节、动作、对白和心理变化推进，不要复述、注水，也不要在正文中报告或标注字数。`;
}
