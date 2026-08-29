// ---------- Estado geral ----------
let token = localStorage.getItem("telalive-token") || null;
let currentUser = null;
let myServers = [];
let activeServerId = null;
let activeChannelId = null;
let authMode = "login"; // ou "register"

let ws = null;
let pc = null;
let localStream = null;

const rtcConfig = { iceServers: [{ urls: "stun:stun.l.google.com:19302" }] };

// ---------- Elementos ----------
const authScreen = document.getElementById("auth-screen");
const appScreen = document.getElementById("app-screen");
const authUsername = document.getElementById("auth-username");
const authPassword = document.getElementById("auth-password");
const authSubmit = document.getElementById("auth-submit");
const authStatus = document.getElementById("auth-status");
const authSubtitle = document.getElementById("auth-subtitle");
const switchLink = document.getElementById("switch-link");
const switchModeText = document.getElementById("switch-mode");

const serverRail = document.getElementById("server-rail");
const addServerBtn = document.getElementById("add-server-btn");
const currentServerName = document.getElementById("current-server-name");
const inviteHint = document.getElementById("invite-hint");
const inviteCodeEl = document.getElementById("invite-code");
const channelList = document.getElementById("channel-list");
const addChannelBtn = document.getElementById("add-channel-btn");

const emptyState = document.getElementById("empty-state");
const callView = document.getElementById("call-view");
const activeChannelName = document.getElementById("active-channel-name");
const remoteVideo = document.getElementById("remote-video");
const waitingState = document.getElementById("waiting-state");
const waitingText = document.getElementById("waiting-text");
const statusText = document.getElementById("status-text");
const shareBtn = document.getElementById("share-btn");
const stopShareBtn = document.getElementById("stop-share-btn");
const chatMessagesEl = document.getElementById("chat-messages");
const chatEmptyEl = document.getElementById("chat-empty");
const chatInput = document.getElementById("chat-input");
const chatSendBtn = document.getElementById("chat-send-btn");

const serverModal = document.getElementById("server-modal");
const tabCreateServer = document.getElementById("tab-create-server");
const tabJoinServer = document.getElementById("tab-join-server");
const createServerForm = document.getElementById("create-server-form");
const joinServerForm = document.getElementById("join-server-form");
const newServerName = document.getElementById("new-server-name");
const joinServerCode = document.getElementById("join-server-code");
const serverModalStatus = document.getElementById("server-modal-status");
const serverModalCancel = document.getElementById("server-modal-cancel");
const serverModalConfirm = document.getElementById("server-modal-confirm");

const channelModal = document.getElementById("channel-modal");
const newChannelName = document.getElementById("new-channel-name");
const channelModalStatus = document.getElementById("channel-modal-status");
const channelModalCancel = document.getElementById("channel-modal-cancel");
const channelModalConfirm = document.getElementById("channel-modal-confirm");

// ---------- Chamadas à API ----------
async function api(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Algo deu errado.");
  return data;
}

// ---------- Autenticação ----------
switchLink.addEventListener("click", () => {
  authMode = authMode === "login" ? "register" : "login";
  updateAuthUI();
});

function updateAuthUI() {
  authStatus.textContent = "";
  if (authMode === "login") {
    authSubtitle.textContent = "Entre para acessar seus servidores";
    authSubmit.textContent = "Entrar";
    switchModeText.innerHTML = 'Não tem conta? <a id="switch-link">Criar uma agora</a>';
  } else {
    authSubtitle.textContent = "Crie sua conta pra começar";
    authSubmit.textContent = "Criar conta";
    switchModeText.innerHTML = 'Já tem conta? <a id="switch-link">Entrar</a>';
  }
  document.getElementById("switch-link").addEventListener("click", () => {
    authMode = authMode === "login" ? "register" : "login";
    updateAuthUI();
  });
}

authSubmit.addEventListener("click", async () => {
  const username = authUsername.value.trim();
  const password = authPassword.value;
  authStatus.textContent = "";
  authSubmit.disabled = true;
  try {
    const endpoint = authMode === "login" ? "/api/login" : "/api/register";
    const data = await api(endpoint, { method: "POST", body: JSON.stringify({ username, password }) });
    token = data.token;
    currentUser = data.user;
    localStorage.setItem("telalive-token", token);
    enterApp();
  } catch (err) {
    authStatus.textContent = err.message;
  } finally {
    authSubmit.disabled = false;
  }
});

async function tryResumeSession() {
  if (!token) return;
  try {
    currentUser = await api("/api/me");
    enterApp();
  } catch {
    token = null;
    localStorage.removeItem("telalive-token");
  }
}

// ---------- App principal ----------
async function enterApp() {
  authScreen.classList.add("hidden");
  appScreen.style.display = "flex";
  await loadServers();
}

async function loadServers() {
  myServers = await api("/api/servers");
  renderServerRail();
}

function renderServerRail() {
  serverRail.querySelectorAll(".server-icon:not(.add-btn)").forEach((el) => el.remove());
  for (const server of myServers) {
    const icon = document.createElement("div");
    icon.className = "server-icon" + (server.id === activeServerId ? " active" : "");
    icon.textContent = server.name.slice(0, 2).toUpperCase();
    icon.title = server.name;
    icon.addEventListener("click", () => selectServer(server.id));
    serverRail.insertBefore(icon, addServerBtn);
  }
}

function selectServer(serverId) {
  activeServerId = serverId;
  activeChannelId = null;
  leaveCall();
  renderServerRail();
  renderChannelList();
  showEmptyState();
}

function renderChannelList() {
  const server = myServers.find((s) => s.id === activeServerId);
  channelList.innerHTML = "";
  if (!server) {
    currentServerName.textContent = "Selecione um servidor";
    inviteHint.classList.add("hidden");
    addChannelBtn.classList.add("hidden");
    return;
  }
  currentServerName.textContent = server.name;
  inviteCodeEl.textContent = server.inviteCode;
  inviteHint.classList.remove("hidden");
  addChannelBtn.classList.remove("hidden");

  for (const channel of server.channels) {
    const item = document.createElement("div");
    item.className = "channel-item" + (channel.id === activeChannelId ? " active" : "");
    item.innerHTML = `<span class="hash">#</span><span>${escapeHtml(channel.name)}</span>`;
    item.addEventListener("click", () => selectChannel(channel.id, channel.name));
    channelList.appendChild(item);
  }
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

inviteHint.addEventListener("click", () => {
  navigator.clipboard.writeText(inviteCodeEl.textContent);
  inviteHint.querySelector("strong").textContent = "copiado!";
  setTimeout(() => {
    const server = myServers.find((s) => s.id === activeServerId);
    if (server) inviteCodeEl.textContent = server.inviteCode;
  }, 1200);
});

function showEmptyState() {
  emptyState.classList.remove("hidden");
  callView.classList.add("hidden");
}

function selectChannel(channelId, channelName) {
  leaveCall();
  activeChannelId = channelId;
  renderChannelList();
  emptyState.classList.add("hidden");
  callView.classList.remove("hidden");
  activeChannelName.textContent = channelName;
  waitingState.classList.remove("hidden");
  waitingText.textContent = "Aguardando alguém entrar no canal...";
  remoteVideo.style.display = "none";
  shareBtn.classList.remove("hidden");
  stopShareBtn.classList.add("hidden");
  statusText.textContent = "Conectado ao canal";
  loadMessageHistory(channelId);
  connectToChannel(channelId);
}

async function loadMessageHistory(channelId) {
  chatMessagesEl.innerHTML = "";
  try {
    const messages = await api(`/api/channels/${channelId}/messages`);
    if (messages.length === 0) {
      chatMessagesEl.innerHTML = '<p class="chat-empty">Nenhuma mensagem ainda. Diga oi!</p>';
    } else {
      for (const msg of messages) appendChatMessage(msg);
    }
  } catch (err) {
    console.error(err);
  }
}

function appendChatMessage(msg) {
  const emptyMsg = chatMessagesEl.querySelector(".chat-empty");
  if (emptyMsg) emptyMsg.remove();

  const isMe = currentUser && msg.userId === currentUser.id;
  const time = new Date(msg.createdAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

  const el = document.createElement("div");
  el.className = "chat-msg";
  el.innerHTML = `
    <div class="chat-msg-head">
      <span class="chat-msg-author${isMe ? " me" : ""}">${escapeHtml(msg.username)}</span>
      <span class="chat-msg-time">${time}</span>
    </div>
    <div class="chat-msg-text">${escapeHtml(msg.text)}</div>
  `;
  chatMessagesEl.appendChild(el);
  chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
}

function sendChatMessage() {
  const text = chatInput.value.trim();
  if (!text || !ws || ws.readyState !== WebSocket.OPEN || !activeChannelId) return;
  ws.send(JSON.stringify({ type: "chat-message", channelId: activeChannelId, text }));
  chatInput.value = "";
}

chatSendBtn.addEventListener("click", sendChatMessage);
chatInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") sendChatMessage();
});

// ---------- WebSocket + WebRTC ----------
function connectToChannel(channelId) {
  const wsProtocol = location.protocol === "https:" ? "wss" : "ws";
  ws = new WebSocket(`${wsProtocol}://${location.host}?token=${encodeURIComponent(token)}`);

  ws.onopen = () => {
    ws.send(JSON.stringify({ type: "enter-channel", channelId }));
  };

  ws.onmessage = async (event) => {
    const msg = JSON.parse(event.data);

    switch (msg.type) {
      case "entered":
        pc = createPeerConnection();
        break;

      case "peer-joined":
        waitingText.textContent = "Alguém entrou! Clique em \"Compartilhar minha tela\" quando quiser.";
        break;

      case "room-full":
        waitingText.textContent = "Esse canal já tem 2 pessoas em chamada.";
        shareBtn.classList.add("hidden");
        break;

      case "offer":
        await pc.setRemoteDescription(new RTCSessionDescription(msg.sdp));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        ws.send(JSON.stringify({ type: "answer", sdp: answer }));
        break;

      case "answer":
        await pc.setRemoteDescription(new RTCSessionDescription(msg.sdp));
        break;

      case "ice-candidate":
        if (msg.candidate) {
          try {
            await pc.addIceCandidate(new RTCIceCandidate(msg.candidate));
          } catch (err) {
            console.error(err);
          }
        }
        break;

      case "peer-left":
        statusText.textContent = "A outra pessoa saiu do canal";
        remoteVideo.style.display = "none";
        waitingState.classList.remove("hidden");
        waitingText.textContent = "A outra pessoa saiu do canal";
        break;

      case "chat-message":
        appendChatMessage(msg.message);
        break;
    }
  };
}

function createPeerConnection() {
  const conn = new RTCPeerConnection(rtcConfig);

  conn.onicecandidate = (event) => {
    if (event.candidate) ws.send(JSON.stringify({ type: "ice-candidate", candidate: event.candidate }));
  };

  conn.ontrack = (event) => {
    remoteVideo.srcObject = event.streams[0];
    remoteVideo.style.display = "block";
    waitingState.classList.add("hidden");
  };

  conn.onconnectionstatechange = () => {
    if (conn.connectionState === "connected") statusText.textContent = "Transmitindo ao vivo";
  };

  return conn;
}

shareBtn.addEventListener("click", async () => {
  try {
    localStream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 30 }, audio: true });
    for (const track of localStream.getTracks()) pc.addTrack(track, localStream);

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    ws.send(JSON.stringify({ type: "offer", sdp: offer }));

    shareBtn.classList.add("hidden");
    stopShareBtn.classList.remove("hidden");
    waitingText.textContent = "Transmitindo sua tela...";

    localStream.getVideoTracks()[0].onended = () => {
      statusText.textContent = "Você parou de compartilhar a tela";
      stopShareBtn.classList.add("hidden");
      shareBtn.classList.remove("hidden");
    };
  } catch (err) {
    console.error(err);
  }
});

stopShareBtn.addEventListener("click", () => {
  if (localStream) for (const track of localStream.getTracks()) track.stop();
  statusText.textContent = "Compartilhamento parado";
  stopShareBtn.classList.add("hidden");
  shareBtn.classList.remove("hidden");
});

function leaveCall() {
  if (localStream) for (const track of localStream.getTracks()) track.stop();
  if (pc) pc.close();
  if (ws) ws.close();
  pc = null;
  ws = null;
  localStream = null;
}

// ---------- Modal: criar/entrar em servidor ----------
addServerBtn.addEventListener("click", () => {
  serverModal.classList.remove("hidden");
  serverModalStatus.textContent = "";
  newServerName.value = "";
  joinServerCode.value = "";
  setServerTab("create");
});

function setServerTab(mode) {
  tabCreateServer.classList.toggle("active", mode === "create");
  tabJoinServer.classList.toggle("active", mode === "join");
  createServerForm.classList.toggle("hidden", mode !== "create");
  joinServerForm.classList.toggle("hidden", mode !== "join");
  serverModal.dataset.mode = mode;
}
tabCreateServer.addEventListener("click", () => setServerTab("create"));
tabJoinServer.addEventListener("click", () => setServerTab("join"));

serverModalCancel.addEventListener("click", () => serverModal.classList.add("hidden"));

serverModalConfirm.addEventListener("click", async () => {
  serverModalStatus.textContent = "";
  try {
    let server;
    if (serverModal.dataset.mode === "join") {
      server = await api("/api/servers/join", {
        method: "POST",
        body: JSON.stringify({ inviteCode: joinServerCode.value.trim() }),
      });
    } else {
      server = await api("/api/servers", {
        method: "POST",
        body: JSON.stringify({ name: newServerName.value.trim() }),
      });
    }
    await loadServers();
    serverModal.classList.add("hidden");
    selectServer(server.id);
  } catch (err) {
    serverModalStatus.textContent = err.message;
  }
});

// ---------- Modal: criar canal ----------
addChannelBtn.addEventListener("click", () => {
  channelModal.classList.remove("hidden");
  channelModalStatus.textContent = "";
  newChannelName.value = "";
});
channelModalCancel.addEventListener("click", () => channelModal.classList.add("hidden"));

channelModalConfirm.addEventListener("click", async () => {
  channelModalStatus.textContent = "";
  try {
    await api(`/api/servers/${activeServerId}/channels`, {
      method: "POST",
      body: JSON.stringify({ name: newChannelName.value.trim() }),
    });
    await loadServers();
    renderChannelList();
    channelModal.classList.add("hidden");
  } catch (err) {
    channelModalStatus.textContent = err.message;
  }
});

// ---------- Início ----------
updateAuthUI();
tryResumeSession();
