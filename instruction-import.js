export function splitInstructionTextFile(text) {
    const normalized = String(text || '').replace(/\r\n?/g, '\n');
    return normalized
        .split(/\n[\t ]*---[\t ]*\n/)
        .map(part => part.trim())
        .filter(Boolean);
}
