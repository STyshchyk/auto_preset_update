import { delay, downloadTextFile } from '../utils/bytes.js';
import { state } from '../core/state.js';
import { resolveSelectedPort, closeSerialSession } from '../core/serial.js';
import { log } from '../ui/log.js';
import { showPopup } from '../ui/modal.js';
import { readCliResponse, parseBoardName } from './cli.js';
import { isEscSessionActive, disconnectEscSession } from '../blheli/session.js';

export async function backupBetaflightConfig() {
    if (!('serial' in navigator)) {
        showPopup('error', 'Браузер не підтримується', 'Потрібен браузер із підтримкою Web Serial API.');
        return;
    }

    const btnFlashFC = document.getElementById('btnFlashFC');
    const btnBackup = document.getElementById('btnBackup');
    const backupTypeSelect = document.getElementById('backupType');

    btnFlashFC.disabled = true;
    btnBackup.disabled = true;
    let reader = null, writer = null, textEncoder = null;
    const cmd = backupTypeSelect.value;

    try {
        if (isEscSessionActive()) {
            log('[Бекап] Закриття активної 4-Way сесії ESC перед входом у CLI...');
            await disconnectEscSession();
        }
        state.port = await resolveSelectedPort(log);
        await state.port.open({ baudRate: 115200 });
        log(`[Бекап] Порт відкрито на 115200. Ініціалізація CLI...`);

        textEncoder = new TextEncoderStream();
        textEncoder.readable.pipeTo(state.port.writable);
        writer = textEncoder.writable.getWriter();

        const textDecoder = new TextDecoderStream();
        state.port.readable.pipeTo(textDecoder.writable);
        reader = textDecoder.readable.getReader();

        await writer.write('#\r\n');
        await delay(350);
        let initEcho = await readCliResponse(reader, 800);
        if (!initEcho.includes('#')) {
            await writer.write('\r\n#\r\n');
            await delay(350);
            initEcho += await readCliResponse(reader, 800);
        }

        log('Зчитування ідентифікатора плати...');
        await writer.write('status\r\n');
        await delay(150);
        const statusText = await readCliResponse(reader, 1200);
        const boardName = parseBoardName(initEcho + '\n' + statusText) || 'SPEDIXF722';
        log(`Виявлена плата: ${boardName}`);

        log(`Виконується команда "${cmd}"...`);
        await writer.write(`${cmd}\r\n`);

        let dumpContent = '';
        const dumpStart = Date.now();
        const maxDumpTime = 14000;

        while (Date.now() - dumpStart < maxDumpTime) {
            const chunk = await readCliResponse(reader, 1500, false);
            if (chunk) {
                dumpContent += chunk;
                if (dumpContent.includes('\n# ') || dumpContent.trim().endsWith('#')) {
                    break;
                }
            }
        }

        if (!dumpContent || dumpContent.length < 80) {
            throw new Error('Отримано порожню або обірвану відповідь від контролера.');
        }

        const now = new Date();
        const pad = n => String(n).padStart(2, '0');
        const timeStr = `${now.getFullYear()}${pad(now.getMonth()+1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
        const filename = `BTFL_backup_${boardName}_${timeStr}.txt`;

        downloadTextFile(filename, dumpContent);
        log(`Бекап завантажено: ${filename}`);

        try { await writer.write('exit\r\n'); await delay(200); } catch (_) {}
        await closeSerialSession(state.port, reader, writer, textEncoder);
        state.port = null;

        log('[Бекап] COM-порт звільнено.');
        showPopup('success', 'Бекап збережено', `Конфігурацію (${cmd}) успішно експортовано у файл ${filename}!`, 2500);

    } catch (err) {
        console.error(err);
        log(`[Помилка бекапу]: ${err.message}`);
        await closeSerialSession(state.port, reader, writer, textEncoder);
        state.port = null;
        showPopup('error', 'Збій створення бекапу', err.message);
    } finally {
        btnFlashFC.disabled = false;
        btnBackup.disabled = false;
    }
}
