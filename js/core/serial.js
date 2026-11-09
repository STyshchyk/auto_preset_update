import { state } from './state.js';
import { delay } from '../utils/bytes.js';

export const FLIGHT_CONTROLLER_USB_FILTERS = [
    { usbVendorId: 0x0483 }, // STMicroelectronics (Standard STM32 Betaflight VCP)
    { usbVendorId: 1155 },   // STMicroelectronics (decimal notation)
    { usbVendorId: 0x2e3c }, // AT32 / Artery (AT32F435 / AT32F437)
    { usbVendorId: 0x10c4 }, // Silicon Labs (CP210x USB to UART bridge)
    { usbVendorId: 0x1a86 }, // WCH (CH340 / CH341 USB to Serial)
    { usbVendorId: 0x0403 }, // FTDI (FT232 / FT230X)
    { usbVendorId: 0x2e8a }, // Raspberry Pi (RP2040 FCs)
];

export function updateGrantButtonVisibility() {
    const btnGrantPort = document.getElementById('btnGrantPort');
    if (!btnGrantPort) return;
    const portSelect = document.getElementById('portSelect');
    // If no ports available or selection is 'new', show prompt button if supported
    if (!state.availablePorts || state.availablePorts.length === 0 || (portSelect && portSelect.value === 'new')) {
        btnGrantPort.style.display = 'inline-flex';
    } else {
        btnGrantPort.style.display = 'none';
    }
}

export async function promptGrantNewPort(log) {
    if (!('serial' in navigator)) return null;
    try {
        if (typeof log === 'function') {
            log('Відкриття фільтрованого списку польотних контролерів...');
        }
        const requested = await navigator.serial.requestPort({ filters: FLIGHT_CONTROLLER_USB_FILTERS });
        await refreshPortList();
        updateGrantButtonVisibility();
        return requested;
    } catch (e) {
        if (e.name !== 'NotFoundError') {
            console.warn('requestPort error:', e);
        }
        return null;
    }
}

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
        } else if (info.usbVendorId === 0x2e3c) {
            label = `Betaflight AT32 (VID:${vid} PID:${pid})`;
            isFC = true;
        } else if (info.usbVendorId === 0x10c4 || info.usbVendorId === 0x1a86 || info.usbVendorId === 0x0403) {
            label = `Betaflight UART (VID:${vid} PID:${pid})`;
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

    updateGrantButtonVisibility();
}

export function initSerialEvents(log, resetAllStepStatuses) {
    if ('serial' in navigator) {
        navigator.serial.addEventListener('connect', async () => {
            log('Виявлено підключення USB. Перевірка доступності...');
            const prevCount = state.availablePorts ? state.availablePorts.length : 0;
            await refreshPortList();
            const newCount = state.availablePorts ? state.availablePorts.length : 0;
            
            // If new hardware was plugged in but browser has no saved permission for it
            if (newCount === 0 || newCount === prevCount) {
                log('⚡ Підключено нову плату. Натисніть "🔌 Дозволити новий пристрій" або почніть прошивку.');
                const btnGrantPort = document.getElementById('btnGrantPort');
                if (btnGrantPort) {
                    btnGrantPort.style.display = 'inline-flex';
                }
            }

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
    if ('serial' in navigator) {
        await refreshPortList();
    }
    const portSelect = document.getElementById('portSelect');
    const selectedVal = portSelect.value;
    if (selectedVal === 'new' || !state.availablePorts[selectedVal]) {
        if (typeof log === 'function') {
            log('Відкриття діалогу вибору COM-порту з фільтром FC...');
        }
        let requested;
        try {
            requested = await navigator.serial.requestPort({ filters: FLIGHT_CONTROLLER_USB_FILTERS });
        } catch (e) {
            // Fallback without filters if user has unusual USB-serial bridge
            if (e.name === 'NotFoundError') throw e;
            requested = await navigator.serial.requestPort();
        }
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
