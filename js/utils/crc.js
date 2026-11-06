// CRC-16/CCITT (XMODEM): Poly 0x1021, Init 0x0000
export function crc16Xmodem(bytes) {
    let crc = 0x0000;
    for (let b of bytes) {
        crc ^= (b << 8);
        for (let i = 0; i < 8; i++) {
            if (crc & 0x8000) {
                crc = ((crc << 1) ^ 0x1021) & 0xFFFF;
            } else {
                crc = (crc << 1) & 0xFFFF;
            }
        }
    }
    return crc;
}

export function crcHex(bytes) {
    return crc16Xmodem(Array.from(bytes)).toString(16).padStart(4, '0');
}
