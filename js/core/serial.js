import { state } from './state.js';
import { delay } from '../utils/bytes.js';

export async function refreshPortList() {
    if (!('serial' in navigator)) return;
    const portSelect = document.getElementById('portSelect');
    state.availablePorts = await navigator.serial.getPorts();
    portSelect.innerHTML = '';

    let bestIndex = -1;
    state.availablePorts.forEach((p, idx) => {
        const info = p.getInfo();
        const vid = info.usbVendorId ? '0x' + info.usbVendorId.toString(16).padStart(4, '0') : null;
        const pid = info.usbProductId ? '0x' + info.usbProductId.toString(16).padStart(4, '0') : null;

        let label = `Пристрій ${idx + 1}`;
        let isFC = false;
        if (info.usbVendorId === 0x0483 || info.usbVendorId === 1155) {
            label = `Betaflight STM32 (VID:${vid} PID:${pid})`;
            isFC = true;
        } else if (vid && pid) {
            label = `Serial (VID:${vid} PID:${pid})`;
        }

        const opt = document.createElement('option');
        opt.value = idx;
        opt.textContent = label;
        portSelect.appendChild(opt);

        if (isFC && bestIndex === -1) bestIndex = idx;
    });

    const optNew = document.createElement('option');
    optNew.value = 'new';
    optNew.textContent = '+ Обрати / Додати новий порт...';
    portSelect.appendChild(optNew);

    if (bestIndex !== -1) {
        portSelect.value = bestIndex;
    } else if (state.availablePorts.length > 0) {
        portSelect.value = 0;
    } else {
        portSelect.value = 'new';
    }
}

export function initSerialEvents(log, resetAllStepStatuses) {
    if ('serial' in navigator) {
        navigator.serial.addEventListener('connect', () => {
            log('Виявлено підключення USB. Оновлення списку...');
            refreshPortList();
            if (Date.now() > state.ignoreRebootEventsUntil) {
                resetAllStepStatuses();
            }
        });
        navigator.serial.addEventListener('disconnect', () => {
            log('USB-пристрій відключено.');
            refreshPortList();
            if (Date.now() > state.ignoreRebootEventsUntil) {
                resetAllStepStatuses();
            }
        });
        refreshPortList();
    }
}

export async function resolveSelectedPort(log) {
    const portSelect = document.getElementById('portSelect');
    const selectedVal = portSelect.value;
    if (selectedVal === 'new' || !state.availablePorts[selectedVal]) {
        if (typeof log === 'function') {
            log('Відкриття діалогу вибору COM-порту...');
        }
        const requested = await navigator.serial.requestPort();
        await refreshPortList();
        return requested;
    }
    return state.availablePorts[selectedVal];
}

export async function closeSerialSession(portObj, readerObj, writerObj, encoderObj) {
    // 1. Reader cancellation
    if (readerObj) {
        try {
            await readerObj.cancel();
        } catch (e) {
            console.warn('reader.cancel() warning:', e);
        }
        // 2. Reader lock release attempted independently
        try {
            readerObj.releaseLock();
        } catch (e) {
            console.warn('reader.releaseLock() warning:', e);
        }
    }

    // 3. Writer operations finishing & lock release attempted independently
    if (writerObj) {
        try {
            await writerObj.close();
        } catch (e) {
            // If writer is already closed or errored, close() may throw
        }
        try {
            writerObj.releaseLock();
        } catch (e) {
            console.warn('writer.releaseLock() warning:', e);
        }
    }

    // 4. Encoder cancellation if pipeline used
    if (encoderObj && encoderObj.readable) {
        try {
            await encoderObj.readable.cancel();
        } catch (e) {
            console.warn('encoder.readable.cancel() warning:', e);
        }
    }

    // 5. Port closing attempted with explicit logging
    if (portObj) {
        try {
            await delay(50);
            await portObj.close();
        } catch (e) {
            console.warn('port.close() warning:', e);
        }
    }
}
