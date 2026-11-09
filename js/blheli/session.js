/**
 * Persistent 4-Way ESC Session Manager.
 * Manages connecting, keeping alive, and cleanly disconnecting the ESC 4-Way interface.
 */

import { state } from '../core/state.js';
import { resolveSelectedPort, closeSerialSession } from '../core/serial.js';
import { delay } from '../utils/bytes.js';
import { log } from '../ui/log.js';
import { setEscSessionConnected, setStepStatus, setEscFlowStep } from '../ui/status.js';
import { showPopup } from '../ui/modal.js';
import {
    init4WayInterface,
    send4WayCmd,
    CMD_INTERFACE_EXIT
} from './protocol.js';

export function isEscSessionActive() {
    return Boolean(
        state.escSession &&
        state.escSession.isConnected &&
        state.escSession.port &&
        state.escSession.writer &&
        state.escSession.reader
    );
}

/**
 * Explicitly connects to the FC, switches to 4-Way interface, and keeps the port open.
 */
export async function connectEscSession() {
    if (isEscSessionActive()) {
        log('[BLHeli_32] Сесія вже активна.');
        return state.escSession;
    }

    if (!('serial' in navigator)) {
        showPopup('error', 'Помилка', 'Web Serial API не підтримується цим браузером.');
        return null;
    }

    const btnConnect = document.getElementById('btnConnectESC');
    if (btnConnect) btnConnect.disabled = true;
    setStepStatus(2, 'working');
    setEscFlowStep('connect', 'working');

    let port = null;
    let reader = null;
    let writer = null;

    try {
        log('\n[BLHeli_32] Підключення до COM-порту для налаштування ESC...');
        port = await resolveSelectedPort(log);
        await port.open({ baudRate: 115200 });
        log('[BLHeli_32] COM-порт відкрито на 115200.');

        writer = port.writable.getWriter();
        reader = port.readable.getReader();

        await init4WayInterface(writer, reader);

        state.escSession = {
            isConnected: true,
            port,
            reader,
            writer
        };
        state.port = port;

        setEscSessionConnected(true);
        setStepStatus(2, 'awaiting');
        setEscFlowStep('connect', 'success');
        log('[BLHeli_32] 4-Way сесія успішно встановлена. Тепер можна зчитувати або прошивати ESC.');
        showPopup('success', 'Зʼєднання встановлено', 'Сесію 4-Way відкрито! Тепер доступні зчитування та запис ESC.', 2000);

        return state.escSession;
    } catch (err) {
        console.error('[BLHeli_32 Connect Error]:', err);
        log(`[BLHeli_32 Помилка з'єднання]: ${err.message}`);
        
        try {
            if (writer && reader) {
                await send4WayCmd(writer, reader, CMD_INTERFACE_EXIT, 0, [0], 300);
            }
        } catch (_) {}

        await closeSerialSession(port, reader, writer, null);
        state.escSession = { isConnected: false, port: null, reader: null, writer: null };
        state.port = null;
        setEscSessionConnected(false);
        setStepStatus(2, 'fail');
        setEscFlowStep('connect', 'fail');

        showPopup('error', 'Збій зʼєднання з ESC', `Не вдалося підключитися до ESC 4-Way:\n${err.message}`);
        return null;
    }
}

/**
 * Explicitly sends CMD_INTERFACE_EXIT (0x34) and closes the serial port.
 */
export async function disconnectEscSession() {
    if (!state.escSession || !state.escSession.isConnected) {
        log('[BLHeli_32] Сесія вже закрита.');
        setEscSessionConnected(false);
        return;
    }

    const { port, reader, writer } = state.escSession;
    const btnDisconnect = document.getElementById('btnDisconnectESC');
    if (btnDisconnect) btnDisconnect.disabled = true;
    setEscFlowStep('close', 'working');

    try {
        log('\n[BLHeli_32] Закриття 4-Way сесії (CMD_INTERFACE_EXIT 0x34)...');
        try {
            const exitRes = await send4WayCmd(writer, reader, CMD_INTERFACE_EXIT, 0, [0], 600);
            log(`[BLHeli_32] Команду виходу 0x34 виконано (${exitRes.ok ? 'ACK OK' : exitRes.msg}).`);
        } catch (e) {
            console.warn('send4WayCmd CMD_INTERFACE_EXIT error:', e);
        }

        // Затримка перед закриттям порту, щоб FC перемкнув UART назад
        await delay(200);

        await closeSerialSession(port, reader, writer, null);
        log('[BLHeli_32] COM-порт закрито та дескриптор звільнено.');
        setEscFlowStep('close', 'success');
        showPopup('success', 'Відʼєднано', 'Сесію 4-Way успішно завершено, COM-порт звільнено.', 1800);
    } catch (err) {
        console.error('[BLHeli_32 Disconnect Error]:', err);
        log(`[BLHeli_32 Помилка від'єднання]: ${err.message}`);
        setEscFlowStep('close', 'fail');
    } finally {
        state.escSession = { isConnected: false, port: null, reader: null, writer: null };
        state.port = null;
        setEscSessionConnected(false);
        setStepStatus(2, 'awaiting');
    }
}
