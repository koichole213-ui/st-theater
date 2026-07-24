export const PLAIN_TEXT_LIGHT_SELECTION = '__plain_text__';
export const PLAIN_TEXT_DARK_SELECTION = '__plain_text_dark__';
export const TEXT_OUTPUT_LIGHT_MODE = 'text';
export const TEXT_OUTPUT_DARK_MODE = 'text-dark';

export function isPlainTextSelection(selection) {
    return selection === PLAIN_TEXT_LIGHT_SELECTION || selection === PLAIN_TEXT_DARK_SELECTION;
}

export function plainTextThemeForSelection(selection) {
    return selection === PLAIN_TEXT_DARK_SELECTION ? 'dark' : 'light';
}

export function textOutputModeForTheme(theme) {
    return theme === 'dark' ? TEXT_OUTPUT_DARK_MODE : TEXT_OUTPUT_LIGHT_MODE;
}

export function isTextOutputMode(mode) {
    return mode === TEXT_OUTPUT_LIGHT_MODE || mode === TEXT_OUTPUT_DARK_MODE;
}

export function textThemeForOutputMode(mode) {
    return mode === TEXT_OUTPUT_DARK_MODE ? 'dark' : 'light';
}

function escapeHtml(value) {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

export function buildPlainTextHtml(text, theme = 'light') {
    const dark = theme === 'dark';
    const palette = dark
        ? {
            scheme: 'dark',
            page: '#0d0f12',
            pageGlow: 'rgba(198, 151, 82, .08)',
            card: '#15191e',
            cardEdge: 'rgba(222, 181, 116, .17)',
            text: '#d9d4ca',
            selection: 'rgba(210, 164, 92, .34)',
            shadow: '0 24px 70px rgba(0, 0, 0, .38)',
        }
        : {
            scheme: 'light',
            page: '#f4f0e8',
            pageGlow: 'rgba(176, 122, 74, .10)',
            card: '#fffdf8',
            cardEdge: 'rgba(133, 93, 58, .15)',
            text: '#302a25',
            selection: 'rgba(190, 139, 85, .24)',
            shadow: '0 18px 55px rgba(83, 62, 43, .13)',
        };
    const body = escapeHtml(text);
    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="color-scheme" content="${palette.scheme}">
<style>
:root{color-scheme:${palette.scheme}}
*{box-sizing:border-box}
html,body{margin:0;min-height:100%;background:${palette.page}}
body{
    padding:clamp(16px,4vw,36px);
    color:${palette.text};
    background:
        radial-gradient(circle at 50% -10%,${palette.pageGlow},transparent 42%),
        ${palette.page};
    font-family:ui-serif,"Songti SC","STSong","Noto Serif CJK SC",serif;
}
.reader-card{
    width:min(760px,100%);
    margin:0 auto;
    padding:clamp(24px,5vw,48px);
    border:1px solid ${palette.cardEdge};
    border-radius:18px;
    background:${palette.card};
    box-shadow:${palette.shadow};
}
.reader-text{
    font-size:clamp(16px,2.2vw,18px);
    line-height:1.95;
    letter-spacing:.025em;
    white-space:pre-wrap;
    overflow-wrap:anywhere;
}
::selection{background:${palette.selection}}
@media(max-width:520px){
    body{padding:0}
    .reader-card{min-height:100vh;border:0;border-radius:0;padding:26px 20px 42px;box-shadow:none}
    .reader-text{font-size:16px;line-height:1.9}
}
</style>
</head>
<body><article class="reader-card"><div class="reader-text">${body}</div></article></body>
</html>`;
}
