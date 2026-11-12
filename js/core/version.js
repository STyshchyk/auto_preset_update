/**
 * Drone Setup Station - Version & Build Information
 * Automatically updated on deployment.
 */
export const APP_VERSION = 'v1.0.6';
export const APP_BUILD_DATE = '2026-11-12';

export function initVersionBadge() {
    const badge = document.getElementById('appVersionBadge');
    if (badge) {
        badge.textContent = `${APP_VERSION} • ${APP_BUILD_DATE}`;
        badge.title = `Версія: ${APP_VERSION} (${APP_BUILD_DATE})`;
    }
}
