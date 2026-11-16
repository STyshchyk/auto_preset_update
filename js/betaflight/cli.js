/**
 * Creates direct text-mode reader/writer wrappers over Web Serial streams
 * without pipeTo() so port.readable/port.writable are never permanently locked.
 *
 * @param {SerialPort} port
 * @returns {{ reader: { read: Function, cancel: Function, releaseLock: Function }, writer: { write: Function, close: Function, releaseLock: Function } }}
 */
export function createCliStreams(port) {
    const rawReader = port.readable.getReader();
    const rawWriter = port.writable.getWriter();
    const decoder = new TextDecoder('utf-8');
    const encoder = new TextEncoder();

    const reader = {
        async read() {
            const { value, done } = await rawReader.read();
            if (done) {
                const tail = decoder.decode();
                return { value: tail || undefined, done: true };
            }
            return {
                value: value ? decoder.decode(value, { stream: true }) : '',
                done: false
            };
        },
        async cancel() {
            return rawReader.cancel();
        },
        releaseLock() {
            rawReader.releaseLock();
        }
    };

    const writer = {
        async write(str) {
            const bytes = encoder.encode(str);
            return rawWriter.write(bytes);
        },
        async close() {
            // Do not close rawWriter (which would close port.writable); releaseLock handles cleanup
        },
        releaseLock() {
            rawWriter.releaseLock();
        }
    };

    return { reader, writer };
}

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
