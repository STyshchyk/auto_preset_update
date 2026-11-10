import { state } from '../core/state.js';

export function showPopup(type, title, message, autoCloseMs = 0, callback = null) {
    const modal = document.getElementById('statusModal');
    const box = document.getElementById('modalBox');
    const closeBtn = document.getElementById('modalCloseBtn');

    if (state.popupTimer) {
        clearTimeout(state.popupTimer);
        state.popupTimer = null;
    }

    box.className = 'modal-box ' + type;
    document.getElementById('modalTitle').textContent = title;
    document.getElementById('modalMsg').textContent = message;

    if (autoCloseMs > 0) {
        closeBtn.style.display = 'none';
        modal.classList.add('active');
        state.popupTimer = setTimeout(() => {
            closeModal();
            if (typeof callback === 'function') callback();
        }, autoCloseMs);
    } else {
        closeBtn.style.display = 'inline-block';
        modal.classList.add('active');
    }
}

export function closeModal() {
    document.getElementById('statusModal').classList.remove('active');
    if (state.popupTimer) {
        clearTimeout(state.popupTimer);
        state.popupTimer = null;
    }
}

const INSTRUCTIONS_ACK_STORAGE_KEY = 'drone_station_instructions_ack_v1';

/**
 * Checks if the operator has acknowledged reading the instructions.
 * If not, displays a modal dialog requiring confirmation before proceeding.
 * @param {Function} onConfirmed Callback executed once acknowledged
 */
export function ensureInstructionsAcknowledged(onConfirmed) {
    const isAcknowledged = localStorage.getItem(INSTRUCTIONS_ACK_STORAGE_KEY) === 'true';
    if (isAcknowledged) {
        if (typeof onConfirmed === 'function') onConfirmed();
        return;
    }

    const modal = document.getElementById('instructionsModal');
    const chk = document.getElementById('chkAgreeInstructions');
    const btnConfirm = document.getElementById('btnConfirmInstructions');
    if (!modal || !btnConfirm) {
        if (typeof onConfirmed === 'function') onConfirmed();
        return;
    }

    chk.checked = false;
    btnConfirm.disabled = true;

    chk.onchange = () => {
        btnConfirm.disabled = !chk.checked;
    };

    btnConfirm.onclick = () => {
        if (chk.checked) {
            localStorage.setItem(INSTRUCTIONS_ACK_STORAGE_KEY, 'true');
            modal.classList.remove('active');
            if (typeof onConfirmed === 'function') onConfirmed();
        }
    };

    modal.classList.add('active');
}
