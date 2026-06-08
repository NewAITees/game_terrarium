import { app, BrowserWindow } from 'electron';

let win: BrowserWindow | null = null;

app.whenReady().then(() => {
  win = new BrowserWindow({
    width: 800,
    height: 600,
    show: false,
  });

  void win.loadURL('about:blank');
  win.once('ready-to-show', () => {
    console.log('ready-to-show');
    app.quit();
  });
});

app.on('window-all-closed', () => {
  app.quit();
});
