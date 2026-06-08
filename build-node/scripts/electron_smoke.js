"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
let win = null;
electron_1.app.whenReady().then(() => {
    win = new electron_1.BrowserWindow({
        width: 800,
        height: 600,
        show: false,
    });
    void win.loadURL('about:blank');
    win.once('ready-to-show', () => {
        console.log('ready-to-show');
        electron_1.app.quit();
    });
});
electron_1.app.on('window-all-closed', () => {
    electron_1.app.quit();
});
