/**
 * UI Controller for Simplified Mode Progression Timeline & Status Banner
 */

const STEP_IDS = ['progStep1', 'progStep2', 'progStep3', 'progStep4', 'progStep5'];

/**
 * Updates the overall top badge in the progression card header.
 * @param {'pending'|'progressing'|'success'|'failed'} state
 */
export function setOverallProgressionBadge(state) {
    const badge = document.getElementById('progOverallBadge');
    if (!badge) return;

    badge.className = 'step-status';
    if (state === 'pending') {
        badge.classList.add('awaiting');
        badge.innerHTML = '<span class="status-icon">⏳</span> Очікування';
    } else if (state === 'progressing') {
        badge.classList.add('working');
        badge.innerHTML = '<span class="status-icon rotating">⚙️</span> Прошивання...';
    } else if (state === 'success') {
        badge.classList.add('success');
        badge.innerHTML = '<span class="status-icon">✅</span> Успішно';
    } else if (state === 'failed') {
        badge.classList.add('fail');
        badge.innerHTML = '<span class="status-icon">❌</span> Збій';
    }
}

/**
 * Resets the progression panel to initial ready state.
 */
export function resetProgression() {
    setOverallProgressionBadge('pending');

    STEP_IDS.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.className = 'prog-step awaiting';
            const icon = el.querySelector('.step-icon');
            if (icon) icon.textContent = '⏳';
        }
        const stepNum = id.replace('progStep', '');
        const timeEl = document.getElementById(`progTimeStep${stepNum}`);
        if (timeEl) timeEl.textContent = '';
    });

    const banner = document.getElementById('progBanner');
    if (banner) {
        banner.className = 'prog-banner ready';
        banner.innerHTML = '<span class="banner-icon">🎯</span><span>Готовий до запуску. Натисніть кнопку нижче.</span>';
    }
}

/**
 * Sets a specific step state in the timeline.
 * @param {number} stepNumber 1..4
 * @param {'working'|'success'|'fail'|'awaiting'} status
 * @param {string} [msg] Optional custom detail message
 */
export function setProgressionStep(stepNumber, status, msg = '', durationSeconds = null) {
    const id = `progStep${stepNumber}`;
    const el = document.getElementById(id);
    if (!el) return;

    el.className = `prog-step ${status}`;
    const icon = el.querySelector('.step-icon');
    if (icon) {
        if (status === 'working') icon.textContent = '⚙️';
        else if (status === 'success') icon.textContent = '✅';
        else if (status === 'fail') icon.textContent = '❌';
        else icon.textContent = '⏳';
    }

    if (msg) {
        const sub = el.querySelector('.step-subtitle');
        if (sub) sub.textContent = msg;
    }

    if (durationSeconds !== null && durationSeconds !== undefined) {
        const timeEl = document.getElementById(`progTimeStep${stepNumber}`);
        if (timeEl) {
            timeEl.textContent = `⏱️ ${durationSeconds}s`;
        }
    }
}

/**
 * Updates the overall outcome banner.
 * @param {'ready'|'working'|'success'|'fail'} type
 * @param {string} title
 * @param {string} [details]
 */
export function setProgressionBanner(type, title, details = '') {
    const banner = document.getElementById('progBanner');
    if (!banner) return;

    banner.className = `prog-banner ${type}`;
    let icon = '🎯';
    if (type === 'working') icon = '🔄';
    else if (type === 'success') icon = '🎉';
    else if (type === 'fail') icon = '⚠️';

    banner.innerHTML = `
        <div class="banner-title"><span class="banner-icon">${icon}</span> <strong>${title}</strong></div>
        ${details ? `<div class="banner-details">${details}</div>` : ''}
    `;

    // Sync header badge with banner state
    if (type === 'ready') {
        setOverallProgressionBadge('pending');
    } else if (type === 'working') {
        setOverallProgressionBadge('progressing');
    } else if (type === 'success') {
        setOverallProgressionBadge('success');
    } else if (type === 'fail') {
        setOverallProgressionBadge('failed');
    }
}
