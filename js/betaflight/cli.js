export async function readCliResponse(reader, timeoutMs = 2500, stopOnPrompt = true) {
    let output = '';
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        const { value, done } = await Promise.race([
            reader.read(),
            new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 200))
        ]).catch(() => ({ value: null, done: false }));

        if (done) break;
        if (value) {
            output += value;
            if (stopOnPrompt && (output.includes('\n# ') || output.trim().endsWith('#'))) break;
        }
    }
    return output;
}

export function parseBoardName(text) {
    if (!text) return null;
    const nameMatch = text.match(/name:\s*([A-Za-z0-9_-]+)/i) ||
        text.match(/board_name\s+([A-Za-z0-9_-]+)/i) ||
        text.match(/Board:\s*([A-Za-z0-9_-]+)/i);
    if (nameMatch) return nameMatch[1].toUpperCase();
    if (text.toUpperCase().includes('SPEDIXF722')) return 'SPEDIXF722';
    return null;
}
