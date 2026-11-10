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
