// Ponto de entrada do app desktop. Em vez de ligar um servidor dentro
// do proprio PC, agora ele se conecta num servidor hospedado online -
// assim funciona entre amigos em casas diferentes, nao so na mesma rede.

const { app, BrowserWindow, desktopCapturer, session } = require("electron");
const path = require("path");

// TROQUE aqui pelo endereco do seu servidor depois de hospedar (passo a
// passo no README). Exemplo: "https://telalive.onrender.com"
const SERVER_URL = "https://COLOQUE-O-ENDERECO-AQUI.onrender.com";

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1000,
    height: 720,
    minWidth: 700,
    minHeight: 500,
    backgroundColor: "#1e1f26",
    autoHideMenuBar: true,
    icon: path.join(__dirname, "assets", "icon.png"),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadURL(SERVER_URL);
}

function setupScreenSharing() {
  session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
    desktopCapturer.getSources({ types: ["screen", "window"] }).then((sources) => {
      callback({ video: sources[0], audio: "loopback" });
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
