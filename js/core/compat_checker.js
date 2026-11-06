/**
 * Compatibility Checker Module
 * Compares detected drone hardware (FC, ESCs) against expected firmware, target boards, and presets.
 */

export const CompatibilityStatus = Object.freeze({
    COMPATIBLE: 'COMPATIBLE',
    WARNING: 'WARNING',
    INCOMPATIBLE: 'INCOMPATIBLE',
    UNKNOWN: 'UNKNOWN'
});

export class CompatibilityChecker {
    /**
     * Evaluates Flight Controller Compatibility
     * @param {Object} detected
     * @param {string} [detected.boardName]
     * @param {string} [detected.mcuType]
     * @param {string} [detected.firmwareVersion]
     * @param {string} [detected.craftName]
     * @param {Object} expected
     * @param {string} [expected.boardName]
     * @param {string} [expected.mcuType]
     * @param {string} [expected.firmwareVersion]
     * @param {string} [expected.presetText]
     * @returns {Object}
     */
    static checkFlightController(detected = {}, expected = {}) {
        const checks = [];
        const warnings = [];
        const errors = [];
        const recommendations = [];

        // 1. Board Name / Target Verification
        if (!detected.boardName) {
            checks.push({ name: 'FC Board Target', status: CompatibilityStatus.UNKNOWN, detail: 'Target board not detected.' });
            warnings.push('FC board name could not be identified from hardware.');
            recommendations.push('Verify USB connection and query CLI status.');
        } else if (expected.boardName) {
            const detectedNorm = detected.boardName.toUpperCase().replace(/[^A-Z0-9]/g, '');
            const expectedNorm = expected.boardName.toUpperCase().replace(/[^A-Z0-9]/g, '');

            if (detectedNorm === expectedNorm || detectedNorm.includes(expectedNorm) || expectedNorm.includes(detectedNorm)) {
                checks.push({ name: 'FC Board Target', status: CompatibilityStatus.COMPATIBLE, detail: `Board matches: ${detected.boardName}` });
            } else {
                checks.push({ name: 'FC Board Target', status: CompatibilityStatus.INCOMPATIBLE, detail: `Mismatch! Detected: ${detected.boardName}, Expected: ${expected.boardName}` });
                errors.push(`Target board mismatch: connected board [${detected.boardName}] does not match target [${expected.boardName}].`);
                recommendations.push('Do NOT flash this firmware or preset. Select the correct hardware profile.');
            }
        } else {
            checks.push({ name: 'FC Board Target', status: CompatibilityStatus.UNKNOWN, detail: `Detected: ${detected.boardName} (No expected target defined)` });
        }

        // 2. MCU Family Check
        if (detected.mcuType && expected.mcuType) {
            const mcuDet = detected.mcuType.toUpperCase().replace(/[^A-Z0-9]/g, '');
            const mcuExp = expected.mcuType.toUpperCase().replace(/[^A-Z0-9]/g, '');
            if (mcuDet === mcuExp || mcuDet.includes(mcuExp) || mcuExp.includes(mcuDet)) {
                checks.push({ name: 'MCU Architecture', status: CompatibilityStatus.COMPATIBLE, detail: `MCU matches: ${detected.mcuType}` });
            } else {
                checks.push({ name: 'MCU Architecture', status: CompatibilityStatus.INCOMPATIBLE, detail: `MCU mismatch: ${detected.mcuType} vs ${expected.mcuType}` });
                errors.push(`MCU architecture mismatch: detected [${detected.mcuType}] vs expected [${expected.mcuType}].`);
            }
        } else if (detected.mcuType && !expected.mcuType) {
            checks.push({ name: 'MCU Architecture', status: CompatibilityStatus.UNKNOWN, detail: `MCU detected: ${detected.mcuType} (No expected MCU specified)` });
        } else if (expected.mcuType && !detected.mcuType) {
            checks.push({ name: 'MCU Architecture', status: CompatibilityStatus.UNKNOWN, detail: `Expected MCU: ${expected.mcuType} (Hardware MCU unknown)` });
        }

        // 3. Firmware Version Comparison
        // Version check generates WARNING only when target is not INCOMPATIBLE
        if (detected.firmwareVersion && expected.firmwareVersion) {
            const detVer = detected.firmwareVersion.trim();
            const expVer = expected.firmwareVersion.trim();
            if (detVer === expVer || detVer.includes(expVer)) {
                checks.push({ name: 'Firmware Version', status: CompatibilityStatus.COMPATIBLE, detail: `Version matches: ${detVer}` });
            } else {
                checks.push({ name: 'Firmware Version', status: CompatibilityStatus.WARNING, detail: `Version difference: detected ${detVer}, expected ${expVer}` });
                warnings.push(`Firmware version differs: detected ${detVer}, expected ${expVer}.`);
                recommendations.push('Review firmware release notes for breaking configuration changes.');
            }
        } else if (detected.firmwareVersion) {
            checks.push({ name: 'Firmware Version', status: CompatibilityStatus.UNKNOWN, detail: `Detected version: ${detected.firmwareVersion}` });
        } else if (expected.firmwareVersion) {
            checks.push({ name: 'Firmware Version', status: CompatibilityStatus.UNKNOWN, detail: `Expected version: ${expected.firmwareVersion} (Hardware version unknown)` });
        }

        // 4. Preset Compatibility Check
        if (expected.presetText && detected.boardName) {
            const presetMatch = expected.presetText.match(/(?:board_name|#\s*target:?)\s+([A-Za-z0-9_-]+)/i);
            const presetTarget = presetMatch ? presetMatch[1].toUpperCase() : null;

            if (presetTarget) {
                const detectedNorm = detected.boardName.toUpperCase().replace(/[^A-Z0-9]/g, '');
                const presetNorm = presetTarget.replace(/[^A-Z0-9]/g, '');

                if (detectedNorm === presetNorm || detectedNorm.includes(presetNorm) || presetNorm.includes(detectedNorm)) {
                    checks.push({ name: 'CLI Preset Target', status: CompatibilityStatus.COMPATIBLE, detail: `Preset designed for: ${presetTarget}` });
                } else {
                    checks.push({ name: 'CLI Preset Target', status: CompatibilityStatus.INCOMPATIBLE, detail: `Preset mismatch: target ${presetTarget} vs actual ${detected.boardName}` });
                    errors.push(`Preset compatibility error: script is intended for [${presetTarget}], but board is [${detected.boardName}].`);
                    recommendations.push('Update the preset target or select the correct preset script.');
                }
            } else {
                checks.push({ name: 'CLI Preset Target', status: CompatibilityStatus.WARNING, detail: 'Preset does not specify a target board tag.' });
                warnings.push('Preset script does not declare an explicit board_name or target tag.');
            }
        }

        return this._computeOverallResult(checks, warnings, errors, recommendations);
    }

    /**
     * Evaluates Electronic Speed Controller (ESC) Compatibility & Uniformity
     * @param {Object} detected
     * @param {Array<{index: number, signature?: string, version?: string, ok?: boolean}>} detected.escs
     * @param {number} [detected.expectedCount=4]
     * @param {Object} expected
     * @param {string} [expected.firmwareVersion]
     * @param {string} [expected.signature]
     * @returns {Object}
     */
    static checkEscs(detected = { escs: [], expectedCount: 4 }, expected = {}) {
        const checks = [];
        const warnings = [];
        const errors = [];
        const recommendations = [];

        const escs = detected.escs || [];
        const expectedCount = detected.expectedCount !== undefined ? detected.expectedCount : 4;

        // 1. ESC Discovery Count Check
        if (escs.length === 0) {
            checks.push({ name: 'ESC Discovery', status: CompatibilityStatus.INCOMPATIBLE, detail: 'No ESCs responded to 4-Way probe.' });
            errors.push('No ESCs detected. Check LiPo battery connection and signal wiring.');
            recommendations.push('Connect LiPo battery and verify ESC initialization beeps.');
        } else if (escs.length < expectedCount) {
            checks.push({ name: 'ESC Discovery', status: CompatibilityStatus.WARNING, detail: `Found ${escs.length} of ${expectedCount} ESCs.` });
            warnings.push(`Incomplete ESC count: detected ${escs.length} ESCs, expected ${expectedCount}.`);
            recommendations.push('Inspect unresponding ESC motor wiring and power supply.');
        } else {
            checks.push({ name: 'ESC Discovery', status: CompatibilityStatus.COMPATIBLE, detail: `All ${expectedCount} ESCs responding.` });
        }

        // 2. Cross-ESC Version & Signature Uniformity
        if (escs.length > 1) {
            const versions = new Map();
            const signatures = new Map();

            escs.forEach(e => {
                const ch = e.index !== undefined ? e.index + 1 : '?';
                if (e.version) {
                    if (!versions.has(e.version)) versions.set(e.version, []);
                    versions.get(e.version).push(`ESC #${ch}`);
                }
                if (e.signature) {
                    if (!signatures.has(e.signature)) signatures.set(e.signature, []);
                    signatures.get(e.signature).push(`ESC #${ch}`);
                }
            });

            if (versions.size > 1) {
                const detailStr = [...versions.entries()].map(([ver, list]) => `${ver} (${list.join(', ')})`).join('; ');
                checks.push({ name: 'Version Uniformity', status: CompatibilityStatus.WARNING, detail: `Non-uniform versions: ${detailStr}` });
                warnings.push(`ESC firmware versions are not uniform across motors: ${detailStr}.`);
                recommendations.push('Flash all ESCs to the same firmware revision for balanced flight performance.');
            } else if (versions.size === 1) {
                checks.push({ name: 'Version Uniformity', status: CompatibilityStatus.COMPATIBLE, detail: `Uniform version: ${[...versions.keys()][0]}` });
            } else {
                checks.push({ name: 'Version Uniformity', status: CompatibilityStatus.UNKNOWN, detail: 'Firmware versions not reported.' });
            }

            if (signatures.size > 1) {
                const sigStr = [...signatures.entries()].map(([sig, list]) => `${sig} (${list.join(', ')})`).join('; ');
                checks.push({ name: 'Hardware Uniformity', status: CompatibilityStatus.WARNING, detail: `Mixed chip signatures: ${sigStr}` });
                warnings.push(`Detected mixed ESC hardware/chip signatures on the same drone: ${sigStr}.`);
            }
        }

        // 3. Expected vs Actual Firmware Version Check
        if (expected.firmwareVersion && escs.length > 0) {
            const mismatches = escs.filter(e => e.version && e.version !== expected.firmwareVersion);
            if (mismatches.length > 0) {
                const list = mismatches.map(e => `ESC #${(e.index !== undefined ? e.index + 1 : '?')} (v${e.version})`).join(', ');
                checks.push({
                    name: 'Expected Firmware Match',
                    status: CompatibilityStatus.WARNING,
                    detail: `Differ from expected v${expected.firmwareVersion}: ${list}`
                });
                warnings.push(`ESC firmware differs from expected v${expected.firmwareVersion}: ${list}.`);
            } else if (escs.every(e => e.version === expected.firmwareVersion)) {
                checks.push({ name: 'Expected Firmware Match', status: CompatibilityStatus.COMPATIBLE, detail: `All match v${expected.firmwareVersion}` });
            }
        }

        return this._computeOverallResult(checks, warnings, errors, recommendations);
    }

    /**
     * Computes overall status & operation clearance.
     * Conservative rule: Operation is allowed ONLY when status is COMPATIBLE or WARNING with no blockers.
     * UNKNOWN or INCOMPATIBLE never allow operations.
     */
    static _computeOverallResult(checks, warnings, errors, recommendations) {
        let overallStatus = CompatibilityStatus.COMPATIBLE;

        if (errors.length > 0) {
            overallStatus = CompatibilityStatus.INCOMPATIBLE;
        } else if (checks.some(c => c.status === CompatibilityStatus.UNKNOWN)) {
            overallStatus = CompatibilityStatus.UNKNOWN;
        } else if (warnings.length > 0) {
            overallStatus = CompatibilityStatus.WARNING;
        }

        // Conservative policy: INCOMPATIBLE and UNKNOWN block operations
        const operationAllowed = (overallStatus === CompatibilityStatus.COMPATIBLE || overallStatus === CompatibilityStatus.WARNING);

        return {
            overallStatus,
            checks,
            warnings,
            errors,
            recommendations,
            operationAllowed
        };
    }
}
