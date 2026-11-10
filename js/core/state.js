export const state = {
    port: null,
    availablePorts: [],
    popupTimer: null,
    ignoreRebootEventsUntil: 0,
    lastFcDetails: null,
    escChecksPassed: null,
    escSession: {
        isConnected: false,
        port: null,
        reader: null,
        writer: null
    }
};
