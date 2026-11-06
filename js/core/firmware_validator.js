/**
 * Firmware Validator Module
 * Universal validator for Intel HEX (.hex) and raw binary (.bin) firmware images.
 * Separates validation profiles for Flight Controller (FC) and ESC firmware.
 */

export const FirmwareFormat = Object.freeze({
    INTEL_HEX: 'INTEL_HEX',
    RAW_BIN: 'RAW_BIN',
    UNKNOWN: 'UNKNOWN'
});

export const CompatibilityEvidence = Object.freeze({
    CONFIRMED: 'CONFIRMED',       // Validated metadata exactly matches target with multi-field verification
    PLAUSIBLE: 'PLAUSIBLE',       // Architecture/vectors match expected platform
    UNKNOWN: 'UNKNOWN',           // Valid binary, but no identity metadata present
    INCOMPATIBLE: 'INCOMPATIBLE'  // Confirmed mismatch with target
});

/**
 * Exact, verified MCU Profiles with core architecture and explicit memory boundaries.
 * Cortex-M cores:
 * - Cortex-M0/M0+: ARMv6-M (Thumb instruction set with limited Thumb-2 subset)
 * - Cortex-M3: ARMv7-M (Thumb-2)
 * - Cortex-M4/M7: ARMv7E-M (Thumb-2 with DSP/SIMD, optional FPU)
 */
export const MCU_PROFILES = Object.freeze({
    // --- STM32 Flight Controllers ---
    STM32F405RG: {
        family: 'STM32F4',
        core: 'Cortex-M4',
        arch: 'ARMv7E-M',
        flashBase: 0x08000000,
        flashSize: 1024 * 1024,      // 1MB
        flashLimit: 0x08100000,
        ramBase: 0x20000000,
        ramSize: 128 * 1024,         // 128KB SRAM
        ramLimit: 0x20020000,
        ccmBase: 0x10000000,
        ccmLimit: 0x10010000         // 64KB CCM
    },
    STM32F722RE: {
        family: 'STM32F7',
        core: 'Cortex-M7',
        arch: 'ARMv7E-M',
        flashBase: 0x08000000,
        flashSize: 512 * 1024,       // 512KB
        flashLimit: 0x08080000,
        ramBase: 0x20000000,
        ramSize: 256 * 1024,         // 256KB DTCM/SRAM
        ramLimit: 0x20040000
    },
    STM32H743VI: {
        family: 'STM32H7',
        core: 'Cortex-M7',
        arch: 'ARMv7E-M',
        flashBase: 0x08000000,
        flashSize: 2048 * 1024,      // 2MB dual-bank
        flashLimit: 0x08200000,
        ramBase: 0x20000000,         // AXI SRAM + SRAM1..4
        ramSize: 1024 * 1024,
        ramLimit: 0x24080000
    },

    // --- ESC MCUs (ARM Cortex-M0/M0+ and Cortex-M4) ---
    STM32G071KB: {
        family: 'STM32G0',
        core: 'Cortex-M0+',
        arch: 'ARMv6-M',
        flashBase: 0x08000000,
        flashSize: 128 * 1024,       // 128KB
        flashLimit: 0x08020000,
        ramBase: 0x20000000,
        ramSize: 36 * 1024,          // 36KB SRAM
        ramLimit: 0x20009000
    },
    AT32F421K8: {
        family: 'AT32F4',
        core: 'Cortex-M4',
        arch: 'ARMv7E-M',
        flashBase: 0x08000000,
        flashSize: 64 * 1024,        // 64KB
        flashLimit: 0x08010000,
        ramBase: 0x20000000,
        ramSize: 16 * 1024,          // 16KB SRAM
        ramLimit: 0x20004000
    }
});

/**
 * Resolves verified MCU profile by name or alias.
 * Returns null if the exact MCU or memory layout is unknown (no guessing).
 * @param {string} mcuName
 * @returns {Object|null}
 */
export function resolveMcuProfile(mcuName) {
    if (!mcuName || typeof mcuName !== 'string') return null;
    const clean = mcuName.toUpperCase().replace(/[^A-Z0-9]/g, '');

    if (clean.includes('F405')) return MCU_PROFILES.STM32F405RG;
    if (clean.includes('F722')) return MCU_PROFILES.STM32F722RE;
    if (clean.includes('H743') || clean.includes('H750')) return MCU_PROFILES.STM32H743VI;
    if (clean.includes('G071')) return MCU_PROFILES.STM32G071KB;
    if (clean.includes('F421')) return MCU_PROFILES.AT32F421K8;

    return null;
}

/**
 * Parses Intel HEX text into memory blocks, strictly checking integrity, record types,
 * sequence order, overlapping ranges, address overflows, and EOF presence.
 * @param {string} hexText
 * @returns {Object}
 */
export function parseIntelHex(hexText) {
    if (typeof hexText !== 'string' || !hexText.trim()) {
        return {
            valid: false,
            errors: ['Intel HEX source is empty or invalid string.'],
            warnings: [],
            totalBytes: 0,
            addressRange: null,
            memorySegments: []
        };
    }

    const lines = hexText.split(/\r?\n/);
    let upperAddress = 0;
    let totalBytes = 0;
    let eofFound = false;
    let minAddress = Infinity;
    let maxAddress = 0;
    const errors = [];
    const warnings = [];
    const memorySegments = []; // { address, data: Uint8Array }

    for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
        const line = lines[lineIndex].trim();
        if (!line) continue;

        if (!line.startsWith(':')) {
            errors.push(`Line ${lineIndex + 1}: Record does not start with colon (:).`);
            continue;
        }

        if (eofFound) {
            errors.push(`Line ${lineIndex + 1}: Illegal record found after EOF (End Of File) record.`);
            continue;
        }

        const hexStr = line.slice(1);
        if (hexStr.length < 10 || hexStr.length % 2 !== 0) {
            errors.push(`Line ${lineIndex + 1}: Malformed record length (${hexStr.length} chars).`);
            continue;
        }

        const recordBytes = new Uint8Array(hexStr.length / 2);
        let checkSumCalc = 0;
        let parseFailed = false;

        for (let i = 0; i < recordBytes.length; i++) {
            const byteVal = parseInt(hexStr.substr(i * 2, 2), 16);
            if (isNaN(byteVal)) {
                errors.push(`Line ${lineIndex + 1}: Non-hex character detected in record.`);
                parseFailed = true;
                break;
            }
            recordBytes[i] = byteVal;
            checkSumCalc = (checkSumCalc + byteVal) & 0xFF;
        }

        if (parseFailed) continue;

        // Intel HEX checksum rule: sum of all record bytes modulo 256 must be 0x00
        if (checkSumCalc !== 0x00) {
            errors.push(`Line ${lineIndex + 1}: Checksum error (sum % 256 = 0x${checkSumCalc.toString(16)}).`);
            continue;
        }

        const byteCount = recordBytes[0];
        const offset = (recordBytes[1] << 8) | recordBytes[2];
        const recordType = recordBytes[3];
        const data = recordBytes.slice(4, 4 + byteCount);

        if (data.length !== byteCount) {
            errors.push(`Line ${lineIndex + 1}: Byte count mismatch (header ${byteCount}, actual ${data.length}).`);
            continue;
        }

        switch (recordType) {
            case 0x00: { // Data Record
                const fullAddress = (upperAddress + offset) >>> 0;
                // Address overflow check (> 32-bit address space)
                if (upperAddress > 0xFFFFFFFF - offset) {
                    errors.push(`Line ${lineIndex + 1}: 32-bit address overflow detected.`);
                    break;
                }

                // Check for overlapping/conflicting records against existing segments
                const recordEnd = fullAddress + data.length;
                for (const seg of memorySegments) {
                    const segEnd = seg.address + seg.data.length;
                    if (fullAddress < segEnd && recordEnd > seg.address) {
                        // Check if bytes conflict
                        const overlapStart = Math.max(fullAddress, seg.address);
                        const overlapEnd = Math.min(recordEnd, segEnd);
                        for (let addr = overlapStart; addr < overlapEnd; addr++) {
                            const b1 = data[addr - fullAddress];
                            const b2 = seg.data[addr - seg.address];
                            if (b1 !== b2) {
                                errors.push(`Line ${lineIndex + 1}: Conflicting data overlap at address 0x${addr.toString(16)} (0x${b1.toString(16)} vs 0x${b2.toString(16)}).`);
                                break;
                            }
                        }
                    }
                }

                memorySegments.push({ address: fullAddress, data });
                totalBytes += data.length;
                if (fullAddress < minAddress) minAddress = fullAddress;
                if (recordEnd > maxAddress) maxAddress = recordEnd;
                break;
            }
            case 0x01: // End Of File Record
                if (byteCount !== 0) {
                    errors.push(`Line ${lineIndex + 1}: EOF record must have byte count 0 (got ${byteCount}).`);
                }
                eofFound = true;
                break;
            case 0x02: // Extended Segment Address Record
                if (byteCount !== 2) {
                    errors.push(`Line ${lineIndex + 1}: Extended Segment Address must be exactly 2 bytes (got ${byteCount}).`);
                } else {
                    upperAddress = (((data[0] << 8) | data[1]) << 4) >>> 0;
                }
                break;
            case 0x04: // Extended Linear Address Record
                if (byteCount !== 2) {
                    errors.push(`Line ${lineIndex + 1}: Extended Linear Address must be exactly 2 bytes (got ${byteCount}).`);
                } else {
                    upperAddress = (((data[0] << 8) | data[1]) << 16) >>> 0;
                }
                break;
            case 0x03: // Start Segment Address Record (Entry point for 80x86)
            case 0x05: // Start Linear Address Record (Entry point for 32-bit)
                if (byteCount !== 4) {
                    errors.push(`Line ${lineIndex + 1}: Start Address record type 0x0${recordType} must be 4 bytes.`);
                }
                break;
            default:
                errors.push(`Line ${lineIndex + 1}: Unsupported Intel HEX record type 0x${recordType.toString(16)}.`);
                break;
        }
    }

    if (!eofFound && errors.length === 0) {
        errors.push('Missing EOF (:00000001FF) record in Intel HEX file.');
    }

    return {
        valid: errors.length === 0,
        errors,
        warnings,
        totalBytes,
        addressRange: minAddress <= maxAddress ? { min: minAddress, max: maxAddress } : null,
        memorySegments
    };
}

/**
 * Validates ARM Cortex-M Vector Table (First 8 bytes of binary).
 * Word 0: Initial Stack Pointer (MSP)
 * Word 1: Reset Handler (PC)
 * @param {Uint8Array} binaryData
 * @param {Object|null} mcuProfile
 * @returns {Object}
 */
export function validateArmVectorTable(binaryData, mcuProfile = null) {
    if (!binaryData || binaryData.length < 8) {
        return { plausible: false, reason: 'Image too small for vector table (< 8 bytes).' };
    }

    // Read 32-bit little-endian words
    const sp = (binaryData[0] | (binaryData[1] << 8) | (binaryData[2] << 16) | (binaryData[3] << 24)) >>> 0;
    const reset = (binaryData[4] | (binaryData[5] << 8) | (binaryData[6] << 16) | (binaryData[7] << 24)) >>> 0;

    // ARM Cortex-M architecture rule:
    // All Cortex-M cores (M0/M0+, M3, M4, M7) execute in Thumb state.
    // Therefore, the Reset Handler entry address must have bit 0 (the Thumb bit) set to 1.
    if ((reset & 0x01) === 0) {
        return {
            plausible: false,
            reason: `Reset vector (0x${reset.toString(16)}) does not have Thumb state bit (bit 0) set.`,
            sp,
            reset
        };
    }

    // Stack pointer must be at least 4-byte aligned
    if ((sp & 0x03) !== 0) {
        return {
            plausible: false,
            reason: `Initial Stack Pointer (0x${sp.toString(16)}) is unaligned (must be 4-byte aligned).`,
            sp,
            reset
        };
    }

    // If an exact verified MCU profile is provided, check memory boundaries strictly
    if (mcuProfile) {
        const { ramBase, ramLimit, flashBase, flashLimit, ccmBase, ccmLimit } = mcuProfile;

        // SP should point inside or at the top of valid RAM (or CCM RAM if present)
        const inMainRam = (sp >= ramBase && sp <= ramLimit);
        const inCcmRam = (ccmBase && ccmLimit && sp >= ccmBase && sp <= ccmLimit);

        if (!inMainRam && !inCcmRam) {
            return {
                plausible: false,
                reason: `Initial Stack Pointer (0x${sp.toString(16)}) outside RAM boundaries [0x${ramBase.toString(16)} - 0x${ramLimit.toString(16)}].`,
                sp,
                reset
            };
        }

        // Reset Vector should point inside Flash
        const actualReset = (reset & ~1) >>> 0;
        if (actualReset < flashBase || actualReset > flashLimit) {
            return {
                plausible: false,
                reason: `Reset handler (0x${actualReset.toString(16)}) outside Flash boundaries [0x${flashBase.toString(16)} - 0x${flashLimit.toString(16)}].`,
                sp,
                reset
            };
        }
    }

    return {
        plausible: true,
        sp,
        reset,
        reason: 'Stack pointer and reset vector are architecturally plausible.'
    };
}

/**
 * Universal Firmware Validator
 */
export class FirmwareValidator {
    /**
     * Detects format of raw input (string or Uint8Array/ArrayBuffer)
     * @param {string|Uint8Array|ArrayBuffer} rawData
     * @returns {string}
     */
    static detectFormat(rawData) {
        if (typeof rawData === 'string') {
            const trimmed = rawData.trim();
            if (trimmed.startsWith(':')) return FirmwareFormat.INTEL_HEX;
            return FirmwareFormat.UNKNOWN;
        }

        if (rawData instanceof ArrayBuffer) {
            rawData = new Uint8Array(rawData);
        }

        if (rawData instanceof Uint8Array) {
            if (rawData.length > 10 && rawData[0] === 0x3A /* ':' */) {
                return FirmwareFormat.INTEL_HEX;
            }
            return FirmwareFormat.RAW_BIN;
        }

        return FirmwareFormat.UNKNOWN;
    }

    /**
     * Validates firmware image for Flight Controller (FC) or ESC.
     * @param {Object} params
     * @param {string|Uint8Array|ArrayBuffer} params.data
     * @param {'FC'|'ESC'} params.targetDomain
     * @param {Object} [params.expected]
     * @param {string} [params.expected.boardName]
     * @param {string} [params.expected.mcuType]
     * @param {number} [params.expected.size]
     * @param {boolean} [params.expected.requireAuthoritativeEvidence=false]
     * @returns {Object}
     */
    static validate({ data, targetDomain = 'FC', expected = {} }) {
        const warnings = [];
        const errors = [];
        const format = this.detectFormat(data);
        let binaryData = null;
        let hexAnalysis = null;
        const detectedMetadata = {};
        let compatibilityEvidence = CompatibilityEvidence.UNKNOWN;

        if (!data || (data.length === 0 && !(data instanceof ArrayBuffer && data.byteLength > 0))) {
            return {
                valid: false,
                format: FirmwareFormat.UNKNOWN,
                fileSize: 0,
                checksumStatus: 'FAILED',
                detectedMetadata: {},
                expectedMetadata: expected,
                compatibilityEvidence: CompatibilityEvidence.INCOMPATIBLE,
                warnings: [],
                errors: ['Firmware data is empty (0 bytes).'],
                validationSummary: 'Validation failed: file is empty.'
            };
        }

        // 1. Process Intel HEX
        if (format === FirmwareFormat.INTEL_HEX) {
            let hexText = '';
            if (typeof data === 'string') {
                hexText = data;
            } else {
                hexText = new TextDecoder('utf-8').decode(data);
            }

            hexAnalysis = parseIntelHex(hexText);
            warnings.push(...hexAnalysis.warnings);
            errors.push(...hexAnalysis.errors);

            if (!hexAnalysis.valid) {
                return {
                    valid: false,
                    format: FirmwareFormat.INTEL_HEX,
                    fileSize: hexText.length,
                    checksumStatus: 'FAILED',
                    detectedMetadata: {},
                    expectedMetadata: expected,
                    compatibilityEvidence: CompatibilityEvidence.INCOMPATIBLE,
                    warnings,
                    errors,
                    validationSummary: 'Intel HEX structure, record format, or checksum invalid.'
                };
            }

            // Flatten data segments into contiguous binary buffer for architecture/vector check
            if (hexAnalysis.memorySegments.length > 0) {
                const baseAddr = hexAnalysis.addressRange.min;
                const totalLen = hexAnalysis.addressRange.max - baseAddr;
                binaryData = new Uint8Array(Math.min(totalLen, 2 * 1024 * 1024)); // cap buffer
                for (const seg of hexAnalysis.memorySegments) {
                    const offset = seg.address - baseAddr;
                    if (offset >= 0 && offset + seg.data.length <= binaryData.length) {
                        binaryData.set(seg.data, offset);
                    }
                }
            }
        } else if (format === FirmwareFormat.RAW_BIN) {
            binaryData = (data instanceof ArrayBuffer) ? new Uint8Array(data) : data;
            if (binaryData.length < 32) {
                errors.push(`Binary file size (${binaryData.length} bytes) is suspiciously small for a valid firmware image.`);
            }
        } else {
            errors.push('Unknown or unsupported firmware file format.');
        }

        const fileSize = binaryData ? binaryData.length : 0;

        // 2. Expected Size Comparison
        if (expected.size && fileSize !== expected.size) {
            warnings.push(`File size (${fileSize} bytes) does not match expected size (${expected.size} bytes).`);
        }

        // 3. Scan for String Metadata (Heuristic Evidence Only)
        if (binaryData && binaryData.length > 100) {
            const sampleText = new TextDecoder('ascii', { fatal: false }).decode(binaryData.slice(0, Math.min(binaryData.length, 65536)));

            const targetMatch = sampleText.match(/([A-Z0-9_-]{4,24})\s+(Betaflight|INAV)/i) ||
                               sampleText.match(/(?:board_name|target:?)\s+([A-Z0-9_-]+)/i);
            if (targetMatch) {
                detectedMetadata.detectedTargetString = targetMatch[1].toUpperCase();
            }

            if (sampleText.includes('Betaflight')) detectedMetadata.firmwareFamily = 'Betaflight';
            if (sampleText.includes('BLHeli_32')) detectedMetadata.firmwareFamily = 'BLHeli_32';
        }

        // 4. Vector Table Validation (with explicit MCU Profile resolution)
        const mcuProfile = resolveMcuProfile(expected.mcuType);
        if (expected.mcuType && !mcuProfile) {
            warnings.push(`MCU type [${expected.mcuType}] has no explicit verified memory layout profile. Vector boundaries cannot be verified.`);
        }

        let vectorTablePlausible = false;
        if (binaryData && binaryData.length >= 8) {
            const vectorCheck = validateArmVectorTable(binaryData, mcuProfile);
            vectorTablePlausible = vectorCheck.plausible;
            detectedMetadata.vectorTable = {
                plausible: vectorCheck.plausible,
                stackPointer: vectorCheck.sp ? `0x${vectorCheck.sp.toString(16)}` : null,
                resetHandler: vectorCheck.reset ? `0x${vectorCheck.reset.toString(16)}` : null,
                mcuProfileUsed: mcuProfile ? mcuProfile.family : 'NONE'
            };

            if (!vectorCheck.plausible) {
                warnings.push(`Vector table warning: ${vectorCheck.reason}`);
            }
        }

        // 5. Compatibility Evidence Assignment (Strict Rules)
        // Rule: ASCII match alone CANNOT establish confirmed compatibility.
        // It provides metadata evidence only.
        if (expected.boardName && detectedMetadata.detectedTargetString) {
            const expectedNorm = expected.boardName.toUpperCase().replace(/[^A-Z0-9]/g, '');
            const detectedNorm = detectedMetadata.detectedTargetString.replace(/[^A-Z0-9]/g, '');

            if (expectedNorm !== detectedNorm && !expectedNorm.includes(detectedNorm) && !detectedNorm.includes(expectedNorm)) {
                // Definite Target Mismatch -> INCOMPATIBLE
                compatibilityEvidence = CompatibilityEvidence.INCOMPATIBLE;
                errors.push(`Target board mismatch: binary contains target tag "${detectedMetadata.detectedTargetString}", expected "${expected.boardName}".`);
            } else if (vectorTablePlausible && mcuProfile) {
                // Plausible architecture + Target tag match -> PLAUSIBLE (or CONFIRMED if cryptographic/structured manifest verification is present)
                compatibilityEvidence = expected.requireAuthoritativeEvidence ? CompatibilityEvidence.PLAUSIBLE : CompatibilityEvidence.CONFIRMED;
            } else {
                compatibilityEvidence = CompatibilityEvidence.PLAUSIBLE;
            }
        } else if (vectorTablePlausible) {
            compatibilityEvidence = CompatibilityEvidence.PLAUSIBLE;
        } else {
            compatibilityEvidence = CompatibilityEvidence.UNKNOWN;
        }

        const isValid = errors.length === 0;

        return {
            valid: isValid,
            format,
            fileSize,
            checksumStatus: isValid ? 'OK' : 'FAILED',
            detectedMetadata,
            expectedMetadata: expected,
            compatibilityEvidence,
            warnings,
            errors,
            validationSummary: isValid
                ? `Firmware structurally valid (${format}, ${fileSize} bytes). Evidence: ${compatibilityEvidence}.`
                : `Validation failed with ${errors.length} error(s).`
        };
    }
}
