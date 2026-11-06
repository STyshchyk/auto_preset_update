export function log(msg) {
    const logDiv = document.getElementById('log');
    logDiv.textContent += msg + '\n';
    logDiv.scrollTop = logDiv.scrollHeight;
}
