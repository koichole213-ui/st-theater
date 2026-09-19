// Conservative local recognition: never search inside the body for a title.
export function recognizeInstructionTitle(value) {
    const original = String(value ?? '').trim();
    const unchanged = { name: '', content: original, recognized: false };
    const validTitle = name => name.length > 0 && name.length <= 60
        && !/[\r\n<>{}]/.test(name)
        && !/^(?:指令|正文|内容|要求|规则|任务|注意事项|输出格式|角色设定|背景设定|写作要求|创作要求|系统提示|system|user|char|assistant|instructions?|rules?|context|note|html|head|body|div|p|span|script|style|article|section|main|header|footer|title|em|i|b|strong|ul|ol|li|details|summary|table|tr|td|h[1-6])$/i.test(name)
        && !/^(?:请|禁止|不得|不要|不许|严格|现在|暂停|生成|输出|你是|你需要|你必须)/.test(name);
    const result = (name, body) => {
        name = name.trim();
        const content = body.trim();
        return validTitle(name) && content ? { name, content, recognized: true } : unchanged;
    };
    // Custom paired labels may share the first line with the instruction body.
    // Accept an escaped closing slash as commonly copied from chat messages.
    const wrapped = original.match(/^<([^<>\r\n]{1,60})>\s*([\s\S]*?)\s*\\?<\/\1>$/u);
    if (wrapped) return result(wrapped[1], wrapped[2]);
    const firstBreak = original.search(/\r?\n/);
    if (firstBreak < 0) return unchanged;
    const first = original.slice(0, firstBreak).trim();
    const body = original.slice(firstBreak).trim();
    const title = first.match(/^#{1,6}\s+(.+?)(?:\s+#+)?$/u)
        || first.match(/^(?:标题|模板名称|名称)\s*[:：]\s*(.+)$/u)
        || first.match(/^【([^【】]+)】$/u)
        || first.match(/^《([^《》]+)》$/u)
        || first.match(/^[✨⭐🌟★☆◆◇✦✧]+\s*(.+?)\s*[✨⭐🌟★☆◆◇✦✧]+$/u);
    return title ? result(title[1], body) : unchanged;
}
