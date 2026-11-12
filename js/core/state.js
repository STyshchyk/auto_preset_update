export const state = {
    port: null,
    availablePorts: [],
    popupTimer: null,
    ignoreRebootEventsUntil: 0,
    lastFcDetails: null,
    escChecksPassed: null,
    escDirections: ['normal', 'normal', 'normal', 'normal'],
    escSession: {
        isConnected: false,
        port: null,
        reader: null,
        writer: null
    }
};
