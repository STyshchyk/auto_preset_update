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
    const match = text.match(/board_name[:\s]+([A-Za-z0-9_-]+)/i) ||
                  text.match(/Board:\s*(?!manufacturer_id)([A-Za-z0-9_-]+)/i) ||
                  text.match(/(?:^|\n)\s*name:\s*([A-Za-z0-9_-]+)/i);
    if (match) {
        const val = match[1].toUpperCase();
        if (val !== 'MANUFACTURER_ID') return val;
    }
    if (text.toUpperCase().includes('SPEDIXF722')) return 'SPEDIXF722';
    return null;
}
