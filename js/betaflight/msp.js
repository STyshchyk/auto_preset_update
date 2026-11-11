/**
 * Betaflight MSP (MultiWii Serial Protocol v1) message handler & DShot over MSP.
 */

import { delay } from '../utils/bytes.js';
import { state } from '../core/state.js';
import { resolveSelectedPort } from '../core/serial.js';

// Standard MSP Command Identifiers
export const MSP_API_VERSION      = 1;
export const MSP_FC_VARIANT       = 2;
export const MSP_FC_VERSION       = 3;
export const MSP_BOARD_INFO       = 4;
export const MSP_BUILD_INFO       = 5;
export const MSP_MOTOR_CONFIG     = 131;
export const MSP_SET_MOTOR        = 214;
export const MSP_SET_PASSTHROUGH  = 245;

// MSP v2 Command Identifiers
export const MSP2_SEND_DSHOT_COMMAND = 0x3003;

// DShot Command Execution Types (dshotCommandType_e)
export const DSHOT_CMD_TYPE_INLINE   = 0;
export const DSHOT_CMD_TYPE_BLOCKING = 1;

// Standard DShot commands for Betaflight
export const DSHOT_CMD_MOTOR_STOP        = 0;
export const DSHOT_CMD_BEACON1           = 1;
export const DSHOT_CMD_BEACON2           = 2;
export const DSHOT_CMD_BEACON3           = 3;
export const DSHOT_CMD_BEACON4           = 4;
export const DSHOT_CMD_BEACON5           = 5;
export const DSHOT_CMD_ESC_INFO          = 6;
export const DSHOT_CMD_SPIN_DIRECTION_1  = 7;  // Normal direction
export const DSHOT_CMD_SPIN_DIRECTION_2  = 8;  // Reversed direction
export const DSHOT_CMD_3D_MODE_OFF       = 9;
export const DSHOT_CMD_3D_MODE_ON        = 10;
export const DSHOT_CMD_SETTINGS_REQUEST  = 11;
export const DSHOT_CMD_SAVE_SETTINGS     = 12; // 0x0C: Save permanently to ESC EEPROM

/**
 * Builds and sends standard MSP v1 frame:
 * $M< [size] [cmd] [payload...] [xor_checksum]
 *
 * @param {WritableStreamDefaultWriter} writer
 * @param {number} cmd
 * @param {number[]|Uint8Array} payload
 */
export async function sendMsp(writer, cmd, payload = []) {
    const size = payload.length;
    let checksum = size ^ cmd;
    for (let i = 0; i < payload.length; i++) {
        checksum ^= payload[i];
    }
    const frame = new Uint8Array([0x24, 0x4D, 0x3C, size, cmd, ...payload, checksum]);
    await writer.write(frame);
    await delay(30);
}

/**
 * Computes CRC8-DVB-S2 (polynomial 0xD5) for MSP v2 frames.
 */
function crc8DvbS2(crc, a) {
    crc ^= a;
    for (let i = 0; i < 8; i++) {
        if (crc & 0x80) {
            crc = ((crc << 1) ^ 0xD5) & 0xFF;
        } else {
            crc = (crc << 1) & 0xFF;
        }
    }
    return crc;
}

/**
 * Builds and sends standard MSP v2 frame:
 * $X< [flag=0] [cmd_lo] [cmd_hi] [size_lo] [size_hi] [payload...] [crc8_dvb_s2]
 *
 * @param {WritableStreamDefaultWriter} writer
 * @param {number} cmd 16-bit MSPv2 command ID (e.g. 0x3003)
 * @param {number[]|Uint8Array} payload
 */
export async function sendMspV2(writer, cmd, payload = []) {
    const flag = 0;
    const cmdLo = cmd & 0xFF;
    const cmdHi = (cmd >> 8) & 0xFF;
    const size = payload.length;
    const sizeLo = size & 0xFF;
    const sizeHi = (size >> 8) & 0xFF;

    const body = [flag, cmdLo, cmdHi, sizeLo, sizeHi, ...payload];
    let crc = 0;
    for (let i = 0; i < body.length; i++) {
        crc = crc8DvbS2(crc, body[i]);
    }

    const frame = new Uint8Array([0x24, 0x58, 0x3C, ...body, crc]);
    await writer.write(frame);
    await delay(40);
}

/**
 * Sends a DShot command via MSPv2 (MSP2_SEND_DSHOT_COMMAND = 0x3003).
 *
 * @param {WritableStreamDefaultWriter} writer
 * @param {number} escIndex 0..3 or 255 (ALL_MOTORS)
 * @param {number[]} commands Array of DShot commands (e.g. [8, 12])
 * @param {number} commandType DSHOT_CMD_TYPE_INLINE (0) or DSHOT_CMD_TYPE_BLOCKING (1)
 */
export async function sendMsp2DshotCommand(writer, escIndex, commands, commandType = DSHOT_CMD_TYPE_BLOCKING) {
    const payload = [commandType, escIndex, commands.length, ...commands];
    await sendMspV2(writer, MSP2_SEND_DSHOT_COMMAND, payload);
}

/**
 * Sets motor values (1000 - 2000 scale) for up to 8 motors using MSP_SET_MOTOR (214).
 * Values: 1000 = STOP / min throttle, 1050-1080 = low idle spin.
 *
 * @param {WritableStreamDefaultWriter} writer
 * @param {number[]} motorValues Array of 4 to 8 uint16 values
 */
export async function setMotorOutputs(writer, motorValues) {
    const payload = [];
    for (let i = 0; i < 8; i++) {
        const val = (i < motorValues.length) ? Math.max(1000, Math.min(2000, motorValues[i])) : 1000;
        payload.push(val & 0xFF);
        payload.push((val >> 8) & 0xFF);
    }
    await sendMsp(writer, MSP_SET_MOTOR, payload);
}

/**
 * Executes a raw CLI command on the Flight Controller directly using Uint8Array.
 * Avoids piping streams (pipeTo) which permanently locks port.writable/port.readable.
 *
 * @param {SerialPort} port
 * @param {string} cmdLine
 * @returns {Promise<string>}
 */
export async function executeCliCommand(port, cmdLine) {
    if (!port.readable || !port.writable) {
        await port.open({ baudRate: 115200 });
    }

    const encoder = new TextEncoder();
    const decoder = new TextDecoder();
    const cmdBytes = encoder.encode(cmdLine.trim() + '\r\n');

    // 1. Write command
    const writer = port.writable.getWriter();
    try {
        await writer.write(cmdBytes);
    } finally {
        writer.releaseLock();
    }

    await delay(60);

    // 2. Read response
    let output = '';
    const reader = port.readable.getReader();
    try {
        const start = Date.now();
        while (Date.now() - start < 1500) {
            const { value, done } = await Promise.race([
                reader.read(),
                new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 250))
            ]).catch(() => ({ value: null, done: false }));

            if (done) break;
            if (value) {
                output += decoder.decode(value, { stream: true });
                if (output.includes('\n# ') || output.trim().endsWith('#')) break;
            }
        }
    } finally {
        try {
            await reader.cancel();
        } catch (_) {}
        reader.releaseLock();
    }

    return output;
}

/**
 * Sends one or more DShot commands to an individual ESC channel (0..3) or broadcast (255).
 *
 * 1. First dispatches `MSP2_SEND_DSHOT_COMMAND` (0x3003) via MSPv2 (both BLOCKING and INLINE)
 *    while the flight controller is in MSP mode and all motors are at 1000µs.
 * 2. Next, enters Betaflight CLI mode (`#`), runs `dshotprog <index> <cmds...>` (which queues
 *    the 10x required DShot command repeats + save), waits for transmission to finish, and
 *    exits back to MSP mode via `exit noreboot` so the FC does not reboot and can immediately
 *    resume `MSP_SET_MOTOR`.
 *
 * @param {SerialPort} port
 * @param {number} escIndex 0-indexed (0=ESC1, 1=ESC2, 2=ESC3, 3=ESC4, 255=All)
 * @param {number|number[]} dshotCmds DShot command code(s), e.g. [8, 12]
 */
export async function sendDshotProgCommand(port, escIndex, dshotCmds) {
    if (!port.readable || !port.writable) {
        await port.open({ baudRate: 115200 });
    }

    const cmdArray = Array.isArray(dshotCmds) ? dshotCmds : [dshotCmds];
    const cmdListStr = cmdArray.join(' ');

    // 1. Send via MSPv2 (MSP2_SEND_DSHOT_COMMAND = 0x3003) while in MSP mode
    const writer = port.writable.getWriter();
    try {
        await sendMsp2DshotCommand(writer, escIndex, cmdArray, DSHOT_CMD_TYPE_BLOCKING);
        await delay(120);
        await sendMsp2DshotCommand(writer, escIndex, cmdArray, DSHOT_CMD_TYPE_INLINE);
        await delay(120);
    } finally {
        writer.releaseLock();
    }

    // 2. Also execute via Betaflight CLI `dshotprog` and return via `exit noreboot`
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();

    const writeRaw = async (str) => {
        const w = port.writable.getWriter();
        try {
            await w.write(encoder.encode(str));
        } finally {
            w.releaseLock();
        }
    };

    // Enter CLI mode
    await writeRaw('#\r\n');
    await delay(300);

    // Send dshotprog command (e.g. `dshotprog 0 8 12\r\n`)
    await writeRaw(`dshotprog ${escIndex} ${cmdListStr}\r\n`);
    await delay(400); // Wait for 10x command repeats + EEPROM save delay

    // Exit CLI mode back to MSP without rebooting the FC
    await writeRaw('exit noreboot\r\n');
    await delay(250);

    // Drain any buffered CLI response so the stream stays clean
    let output = '';
    if (port.readable && !port.readable.locked) {
        const reader = port.readable.getReader();
        try {
            const start = Date.now();
            while (Date.now() - start < 200) {
                const { value, done } = await Promise.race([
                    reader.read(),
                    new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 60))
                ]).catch(() => ({ value: null, done: false }));
                if (done || !value) break;
                output += decoder.decode(value, { stream: true });
            }
        } finally {
            try {
                await reader.cancel();
            } catch (_) {}
            reader.releaseLock();
        }
    }

    return output;
}
