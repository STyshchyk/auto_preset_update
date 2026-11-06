/**
 * Preset Comparison Coordinator (Phase 12B)
 * Coordinates non-destructive read of effective FC configuration via Web Serial,
 * runs the comparison engine, updates the UI panel, and logs formatted reports.
 */

import { delay } from '../utils/bytes.js';
import { state } from '../core/state.js';
import { resolveSelectedPort, closeSerialSession } from '../core/serial.js';
import { readCliResponse, parseBoardName } from './cli.js';
import { parseDiffOutput } from './preset_validator.js';
import { parseFcTelemetry } from './fc_diag.js';
import {
    parsePresetDirectives,
    compareConfigurations,
    logComparisonReport,
    COMPARISON_SCOPE
} from './comparison_engine.js';
import { updateFcInfoPanel, ComparisonStatus } from '../ui/fc_panel.js';
import { errorManager, Category, Severity } from '../core/error_manager.js';

class PresetComparisonCoordinator {
    constructor() {
        this.activeComparisonId = 0;
        this.isRunning = false;
        this.lastComparisonResult = null;
        this.lastComparedPresetText = null;
    }

    /**
     * Executes read-only comparison workflow.
     * Guaranteed never to apply presets, modify settings, or execute write commands.
     *
     * @param {Object} options
     * @param {string} options.presetScript
     * @param {Function} [options.log]
     * @param {Object} [options.fcTelemetry]
     * @returns {Promise<Object>}
     */
    async runComparison(options = {}) {
        const logger = options.log || (() => {});
        const script = options.presetScript || '';

        // Monotonic sequence guard against out-of-order async race conditions
        const comparisonId = ++this.activeComparisonId;

        if (this.isRunning) {
            const busyMsg = 'Preset comparison already running. Request skipped.';
            logger(`ℹ️ [Порівняння пресету]: ${busyMsg}`);
            return {
                status: ComparisonStatus.NOT_CHECKED,
                reason: 'CONCURRENT_CALL_DENIED'
            };
        }

        // Concurrency check on serial port
        if (state.port && (state.port.readable?.locked || state.port.writable?.locked)) {
            const busyMsg = 'Serial port is currently in use by another task.';
            logger(`⚠️ [Порівняння пресету]: ${busyMsg}`);
            return {
                status: ComparisonStatus.NOT_CHECKED,
                reason: 'PORT_BUSY'
            };
        }

        if (!script.trim()) {
            logger('⚠️ [Порівняння пресету]: Пресет порожній. Немає параметрів для перевірки.');
            updateFcInfoPanel({
                presetName: 'Empty',
                comparisonStatus: ComparisonStatus.NOT_CHECKED,
                totalParams: 0,
                matchCount: 0,
                diffCount: 0,
                unverifiedCount: 0
            });
            return {
                status: ComparisonStatus.NOT_CHECKED,
                reason: 'EMPTY_PRESET'
            };
        }

        this.isRunning = true;
        this.lastComparedPresetText = script;

        // Transition UI to CHECKING state and zero out old counts
        const presetParsedInitial = parsePresetDirectives(script);
        updateFcInfoPanel({
            presetName: presetParsedInitial.presetName || 'Preset',
            comparisonStatus: ComparisonStatus.CHECKING
        });

        errorManager.clear(COMPARISON_SCOPE);

        let reader = null, writer = null, textEncoder = null;
        let dumpAllOutput = '';
        let detectedBoard = null;
        let detectedVersion = null;
        let detectedMcu = null;

        try {
            logger('\n--- Запуск перевірки відповідності пресету FC (Read-Only) ---');
            state.port = await resolveSelectedPort(logger);
            await state.port.open({ baudRate: 115200 });
            logger('[Порівняння] COM-порт відкрито на 115200.');

            textEncoder = new TextEncoderStream();
            textEncoder.readable.pipeTo(state.port.writable);
            writer = textEncoder.writable.getWriter();

            const textDecoder = new TextDecoderStream();
            state.port.readable.pipeTo(textDecoder.writable);
            reader = textDecoder.readable.getReader();

            // 1. Enter CLI mode
            await writer.write('#\r\n');
            await delay(300);
            let echo = await readCliResponse(reader, 700);
            if (!echo.includes('#')) {
                await writer.write('\r\n#\r\n');
                await delay(300);
                echo += await readCliResponse(reader, 700);
            }

            if (!echo.includes('#')) {
                throw new Error('FC did not respond with CLI prompt (#). Check baud rate or connection.');
            }

            // 2. Query version and status for target/firmware validation
            await writer.write('version\r\n');
            await delay(150);
            const verText = await readCliResponse(reader, 1000);

            await writer.write('status\r\n');
            await delay(150);
            const statusText = await readCliResponse(reader, 1200);

            const telemetry = parseFcTelemetry(echo + '\n' + verText + '\n' + statusText);
            detectedBoard = telemetry.boardName || parseBoardName(echo + '\n' + verText + '\n' + statusText);
            detectedVersion = telemetry.firmwareVersion;
            detectedMcu = telemetry.mcu;

            // Target Board Compatibility Check
            if (presetParsedInitial.targetBoard && detectedBoard) {
                const expNorm = presetParsedInitial.targetBoard.replace(/[^A-Z0-9]/g, '');
                const actNorm = detectedBoard.replace(/[^A-Z0-9]/g, '');
                if (expNorm !== actNorm && !expNorm.includes(actNorm) && !actNorm.includes(expNorm)) {
                    // Clean CLI exit
                    try { await writer.write('exit\r\n'); } catch (_) {}
                    await closeSerialSession(state.port, reader, writer, textEncoder);
                    state.port = null;

                    const mismatchMsg = `Target mismatch: preset expects [${presetParsedInitial.targetBoard}], FC is [${detectedBoard}].`;
                    logger(`❌ [НЕСУМІСНІСТЬ]: ${mismatchMsg}`);

                    if (this.activeComparisonId === comparisonId) {
                        updateFcInfoPanel({
                            comparisonStatus: ComparisonStatus.MISMATCH,
                            diffCount: 1,
                            totalParams: 1
                        });
                    }

                    return {
                        status: ComparisonStatus.MISMATCH,
                        reason: 'TARGET_MISMATCH',
                        mismatchMsg
                    };
                }
            }

            // 3. Read effective configuration via read-only 'dump all'
            // 'dump all' outputs master + all profiles including effective defaults
            logger('[Порівняння] Зчитування повної ефективної конфігурації FC (dump all)...');
            await writer.write('dump all\r\n');

            const startDump = Date.now();
            while (Date.now() - startDump < 14000) {
                const chunk = await readCliResponse(reader, 1500, false);
                if (chunk) {
                    dumpAllOutput += chunk;
                    if (dumpAllOutput.includes('\n# ') || dumpAllOutput.trim().endsWith('#')) {
                        break;
                    }
                } else {
                    break;
                }
            }

            logger(`[Порівняння] Отримано конфігурацію FC (${dumpAllOutput.length} байт).`);

            // 4. Clean exit from CLI
            try {
                await writer.write('exit\r\n');
                await delay(200);
            } catch (_) {}

            await closeSerialSession(state.port, reader, writer, textEncoder);
            state.port = null;
            logger('[Порівняння] COM-порт закрито.');

        } catch (err) {
            logger(`❌ [Помилка зчитування FC]: ${err.message}`);
            try { await closeSerialSession(state.port, reader, writer, textEncoder); } catch (_) {}
            state.port = null;

            errorManager.error('COMPARE_CLI_ERR', Category.PROTOCOL, 'COMPARATOR', err.message, err, 'Verify serial link', false, COMPARISON_SCOPE);

            if (this.activeComparisonId === comparisonId) {
                updateFcInfoPanel({
                    comparisonStatus: ComparisonStatus.UNVERIFIED
                });
            }

            return {
                status: ComparisonStatus.UNVERIFIED,
                error: err.message
            };
        } finally {
            this.isRunning = false;
        }

        // Outdated check: verify another comparison was not triggered while we were reading
        if (this.activeComparisonId !== comparisonId) {
            logger('ℹ️ [Порівняння]: Результат застарів (викликано нове порівняння). Проігноровано.');
            return {
                status: ComparisonStatus.NOT_CHECKED,
                reason: 'STALE_SUPERSEDED'
            };
        }

        // 5. Parse in-memory FC configuration and compare against preset directives
        const parsedFc = parseDiffOutput(dumpAllOutput);
        const meta = {
            fcBoard: detectedBoard,
            fcVersion: detectedVersion ? `Betaflight ${detectedVersion}` : null,
            fcTarget: detectedBoard,
            presetName: presetParsedInitial.presetName
        };

        const comparison = compareConfigurations(presetParsedInitial, parsedFc, meta);
        this.lastComparisonResult = comparison;

        // 6. Update FC Info Panel UI
        updateFcInfoPanel({
            presetName: comparison.presetName,
            comparisonStatus: comparison.status,
            totalParams: comparison.totalParams,
            matchCount: comparison.matchCount,
            diffCount: comparison.diffCount,
            unverifiedCount: comparison.unverifiedCount
        });

        // 7. Write detailed report to logging console
        logComparisonReport(comparison, meta, logger);

        return comparison;
    }

    /**
     * Invalidates any active/cached comparison state (e.g. on disconnect or preset text edit).
     */
    invalidate(reason = 'RESET') {
        this.activeComparisonId++;
        this.lastComparisonResult = null;
        this.lastComparedPresetText = null;
    }
}

export const presetComparator = new PresetComparisonCoordinator();
