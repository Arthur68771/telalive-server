const { app, BrowserWindow, desktopCapturer, session } = require("electron");
const path = require("path");

// COLOQUE O SEU ENDEREÇO DO RENDER AQUI
const SERVER_URL = "https://nexzone.onrender.com"; 

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1000,
    height: 720,
    minWidth: 700,
    minHeight: 500,
    backgroundColor: "#1e1f26",
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      // ESSA LINHA É A CHAVE PRA TELA NÃO FICAR PRETA:
      webSecurity: false, 
    },
  });

  mainWindow.loadURL(SERVER_URL);
}

function setupScreenSharing() {
  // Configuração específica pro Electron não dar tela preta
  session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
    desktopCapturer.getSources({ types: ["screen", "window"] }).then((sources) => {
      if (sources.length > 0) {
        // Pega a primeira tela (a principal)
        callback({ video: sources[0], audio: "loopback" });
      } else {
        callback({});
      }
    }).catch((err) => {
      console.error("Erro ao capturar tela:", err);
      callback({});
    });
  });
}

app.whenReady().then(() => {
  setupScreenSharing();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
