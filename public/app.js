// ---------- Estado geral ----------
let token = localStorage.getItem("telalive-token") || null;
let currentUser = null;
let myServers = [];
let activeServerId = null;
let activeChannelId = null;
let authMode = "login"; // ou "register"

let ws = null;
let selfPeerId = null;
let knownPeers = new Map(); // peerId -> username (quem está no canal agora)
let pcsOut = new Map(); // peerId -> RTCPeerConnection (conexões que eu abri pra compartilhar MINHA tela)
let pcsIn = new Map(); // peerId -> RTCPeerConnection (conexões que recebem a tela de OUTRA pessoa)
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
const videoGrid = document.getElementById("video-grid");
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

const profileBtn = document.getElementById("profile-btn");
const profileModal = document.getElementById("profile-modal");
const profileAvatarPreview = document.getElementById("profile-avatar-preview");
const profileAvatarInput = document.getElementById("profile-avatar-input");
const profileAvatarChooseBtn = document.getElementById("profile-avatar-choose-btn");
const profileModalStatus = document.getElementById("profile-modal-status");
const profileModalCancel = document.getElementById("profile-modal-cancel");
const profileModalConfirm = document.getElementById("profile-modal-confirm");
const profileLogoutBtn = document.getElementById("profile-logout-btn");

const editServerIconBtn = document.getElementById("edit-server-icon-btn");
const serverIconModal = document.getElementById("server-icon-modal");
const serverIconPreview = document.getElementById("server-icon-preview");
const serverIconInput = document.getElementById("server-icon-input");
const serverIconChooseBtn = document.getElementById("server-icon-choose-btn");
const serverIconModalStatus = document.getElementById("server-icon-modal-status");
const serverIconModalCancel = document.getElementById("server-icon-modal-cancel");
const serverIconModalConfirm = document.getElementById("server-icon-modal-confirm");

const friendsBtn = document.getElementById("friends-btn");
const friendsPanel = document.getElementById("friends-panel");
const addFriendInput = document.getElementById("add-friend-input");
const addFriendBtn = document.getElementById("add-friend-btn");
const addFriendStatus = document.getElementById("add-friend-status");
const incomingList = document.getElementById("incoming-list");
const outgoingList = document.getElementById("outgoing-list");
const friendsList = document.getElementById("friends-list");

let pendingAvatarDataUrl = null;
let pendingServerIconDataUrl = null;

// ---------- Redimensionar imagem antes de enviar (fica pequena e leve) ----------
function resizeImageFile(file, maxSize = 160) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = () => {
      const img = new Image();
      img.onerror = reject;
      img.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = maxSize;
        canvas.height = maxSize;
        const ctx = canvas.getContext("2d");
        const side = Math.min(img.width, img.height);
        const sx = (img.width - side) / 2;
        const sy = (img.height - side) / 2;
        ctx.drawImage(img, sx, sy, side, side, 0, 0, maxSize, maxSize);
        resolve(canvas.toDataURL("image/jpeg", 0.85));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

function avatarHtml(username, avatarDataUrl) {
  if (avatarDataUrl) return `<img src="${avatarDataUrl}" alt="" />`;
  return escapeHtml((username || "?").slice(0, 2).toUpperCase());
}

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
  updateProfileBtn();
  await loadServers();
}

function updateProfileBtn() {
  profileBtn.innerHTML = avatarHtml(currentUser?.username, currentUser?.avatarDataUrl);
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
    icon.innerHTML = server.iconDataUrl
      ? `<img class="server-icon-img" src="${server.iconDataUrl}" alt="" />`
      : escapeHtml(server.name.slice(0, 2).toUpperCase());
    icon.title = server.name;
    icon.addEventListener("click", () => selectServer(server.id));
    serverRail.insertBefore(icon, addServerBtn);
  }
}

function selectServer(serverId) {
  friendsPanel.style.display = "none";
  document.querySelector(".channel-panel").style.display = "flex";
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
    editServerIconBtn.classList.add("hidden");
    return;
  }
  currentServerName.textContent = server.name;
  inviteCodeEl.textContent = server.inviteCode;
  inviteHint.classList.remove("hidden");
  addChannelBtn.classList.remove("hidden");
  editServerIconBtn.classList.toggle("hidden", server.ownerId !== currentUser?.id);

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
  videoGrid.innerHTML = "";
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
    <div class="avatar">${avatarHtml(msg.username, msg.avatarDataUrl)}</div>
    <div class="chat-msg-body">
      <div class="chat-msg-head">
        <span class="chat-msg-author${isMe ? " me" : ""}">${escapeHtml(msg.username)}</span>
        <span class="chat-msg-time">${time}</span>
      </div>
      <div class="chat-msg-text">${escapeHtml(msg.text)}</div>
    </div>
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

// ---------- WebSocket + WebRTC (suporta várias pessoas na mesma chamada) ----------
function connectToChannel(channelId) {
  const wsProtocol = location.protocol === "https:" ? "wss" : "ws";
  ws = new WebSocket(`${wsProtocol}://${location.host}?token=${encodeURIComponent(token)}`);

  ws.onopen = () => {
    ws.send(JSON.stringify({ type: "enter-channel", channelId }));
  };

  ws.onmessage = async (event) => {
    const msg = JSON.parse(event.data);

    switch (msg.type) {
      case "entered": {
        selfPeerId = msg.selfId;
        knownPeers = new Map(msg.peers.map((p) => [p.id, p.username]));
        updateWaitingText();
        break;
      }

      case "peer-joined": {
        knownPeers.set(msg.id, msg.username);
        updateWaitingText();
        // se eu já estiver compartilhando minha tela, o recém-chegado
        // também precisa receber - abro uma conexão nova com ele
        if (localStream) await startShareToPeer(msg.id);
        break;
      }

      case "offer": {
        let pcIn = pcsIn.get(msg.from);
        if (!pcIn) {
          pcIn = createPeerConnection(msg.from, "in");
          pcsIn.set(msg.from, pcIn);
        }
        await pcIn.setRemoteDescription(new RTCSessionDescription(msg.sdp));
        const answer = await pcIn.createAnswer();
        await pcIn.setLocalDescription(answer);
        ws.send(JSON.stringify({ type: "answer", target: msg.from, sdp: answer }));
        break;
      }

      case "answer": {
        const pcOut = pcsOut.get(msg.from);
        if (pcOut) await pcOut.setRemoteDescription(new RTCSessionDescription(msg.sdp));
        break;
      }

      case "ice-candidate": {
        if (!msg.candidate) break;
        const pc = pcsOut.get(msg.from) || pcsIn.get(msg.from);
        if (pc) {
          try {
            await pc.addIceCandidate(new RTCIceCandidate(msg.candidate));
          } catch (err) {
            console.error(err);
          }
        }
        break;
      }

      case "peer-left": {
        knownPeers.delete(msg.id);
        closePeerConnections(msg.id);
        removeVideoTile(msg.id);
        updateWaitingText();
        break;
      }

      case "chat-message":
        appendChatMessage(msg.message);
        break;
    }
  };
}

function updateWaitingText() {
  const count = knownPeers.size;
  if (count === 0) {
    waitingText.textContent = "Aguardando alguém entrar no canal...";
  } else {
    waitingText.textContent = `${count} pessoa${count > 1 ? "s" : ""} no canal. Clique em "Compartilhar minha tela" quando quiser.`;
  }
}

function createPeerConnection(peerId, direction) {
  const conn = new RTCPeerConnection(rtcConfig);

  conn.onicecandidate = (event) => {
    if (event.candidate) {
      ws.send(JSON.stringify({ type: "ice-candidate", target: peerId, candidate: event.candidate }));
    }
  };

  if (direction === "in") {
    conn.ontrack = (event) => {
      showVideoTile(peerId, knownPeers.get(peerId) || "Alguém", event.streams[0]);
    };
  }

  conn.onconnectionstatechange = () => {
    if (conn.connectionState === "connected") {
      statusText.textContent = "Transmitindo ao vivo";
    }
  };

  return conn;
}

function showVideoTile(peerId, username, stream) {
  waitingState.classList.add("hidden");
  let tile = document.getElementById(`tile-${peerId}`);
  if (!tile) {
    tile = document.createElement("div");
    tile.className = "video-tile";
    tile.id = `tile-${peerId}`;
    tile.innerHTML = `<video autoplay playsinline></video><span class="video-tile-label">${escapeHtml(username)}</span>`;
    videoGrid.appendChild(tile);
  }
  tile.querySelector("video").srcObject = stream;
}

function removeVideoTile(peerId) {
  const tile = document.getElementById(`tile-${peerId}`);
  if (tile) tile.remove();
  if (videoGrid.children.length === 0) waitingState.classList.remove("hidden");
}

function closePeerConnections(peerId) {
  const pOut = pcsOut.get(peerId);
  if (pOut) {
    pOut.close();
    pcsOut.delete(peerId);
  }
  const pIn = pcsIn.get(peerId);
  if (pIn) {
    pIn.close();
    pcsIn.delete(peerId);
  }
}

async function startShareToPeer(peerId) {
  const pcOut = createPeerConnection(peerId, "out");
  for (const track of localStream.getTracks()) pcOut.addTrack(track, localStream);
  pcsOut.set(peerId, pcOut);

  const offer = await pcOut.createOffer();
  await pcOut.setLocalDescription(offer);
  ws.send(JSON.stringify({ type: "offer", target: peerId, sdp: offer }));
}

shareBtn.addEventListener("click", async () => {
  try {
    localStream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 30 }, audio: true });

    for (const peerId of knownPeers.keys()) {
      await startShareToPeer(peerId);
    }

    shareBtn.classList.add("hidden");
    stopShareBtn.classList.remove("hidden");
    statusText.textContent = "Transmitindo sua tela";

    localStream.getVideoTracks()[0].onended = () => stopSharing();
  } catch (err) {
    console.error(err);
  }
});

stopShareBtn.addEventListener("click", stopSharing);

function stopSharing() {
  if (localStream) for (const track of localStream.getTracks()) track.stop();
  for (const pc of pcsOut.values()) pc.close();
  pcsOut.clear();
  localStream = null;
  statusText.textContent = "Compartilhamento parado";
  stopShareBtn.classList.add("hidden");
  shareBtn.classList.remove("hidden");
}

function leaveCall() {
  if (localStream) for (const track of localStream.getTracks()) track.stop();
  for (const pc of pcsOut.values()) pc.close();
  for (const pc of pcsIn.values()) pc.close();
  pcsOut.clear();
  pcsIn.clear();
  knownPeers.clear();
  if (ws) ws.close();
  ws = null;
  localStream = null;
  selfPeerId = null;
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

// ---------- Modal: editar perfil ----------
profileBtn.addEventListener("click", () => {
  pendingAvatarDataUrl = null;
  profileModalStatus.textContent = "";
  profileAvatarPreview.innerHTML = avatarHtml(currentUser?.username, currentUser?.avatarDataUrl);
  profileModal.classList.remove("hidden");
});

profileAvatarChooseBtn.addEventListener("click", () => profileAvatarInput.click());

profileAvatarInput.addEventListener("change", async () => {
  const file = profileAvatarInput.files[0];
  if (!file) return;
  pendingAvatarDataUrl = await resizeImageFile(file);
  profileAvatarPreview.innerHTML = `<img src="${pendingAvatarDataUrl}" alt="" />`;
});

profileModalCancel.addEventListener("click", () => profileModal.classList.add("hidden"));

profileLogoutBtn.addEventListener("click", () => {
  leaveCall();
  token = null;
  currentUser = null;
  myServers = [];
  activeServerId = null;
  activeChannelId = null;
  localStorage.removeItem("telalive-token");
  profileModal.classList.add("hidden");
  appScreen.style.display = "none";
  authScreen.classList.remove("hidden");
  authUsername.value = "";
  authPassword.value = "";
});

profileModalConfirm.addEventListener("click", async () => {
  if (!pendingAvatarDataUrl) {
    profileModal.classList.add("hidden");
    return;
  }
  profileModalStatus.textContent = "";
  try {
    currentUser = await api("/api/me", {
      method: "PATCH",
      body: JSON.stringify({ avatarDataUrl: pendingAvatarDataUrl }),
    });
    updateProfileBtn();
    profileModal.classList.add("hidden");
  } catch (err) {
    profileModalStatus.textContent = err.message;
  }
});

// ---------- Modal: editar ícone do servidor ----------
editServerIconBtn.addEventListener("click", () => {
  pendingServerIconDataUrl = null;
  serverIconModalStatus.textContent = "";
  const server = myServers.find((s) => s.id === activeServerId);
  serverIconPreview.innerHTML = server?.iconDataUrl
    ? `<img src="${server.iconDataUrl}" alt="" />`
    : escapeHtml((server?.name || "?").slice(0, 2).toUpperCase());
  serverIconModal.classList.remove("hidden");
});

serverIconChooseBtn.addEventListener("click", () => serverIconInput.click());

serverIconInput.addEventListener("change", async () => {
  const file = serverIconInput.files[0];
  if (!file) return;
  pendingServerIconDataUrl = await resizeImageFile(file);
  serverIconPreview.innerHTML = `<img src="${pendingServerIconDataUrl}" alt="" />`;
});

serverIconModalCancel.addEventListener("click", () => serverIconModal.classList.add("hidden"));

serverIconModalConfirm.addEventListener("click", async () => {
  if (!pendingServerIconDataUrl) {
    serverIconModal.classList.add("hidden");
    return;
  }
  serverIconModalStatus.textContent = "";
  try {
    await api(`/api/servers/${activeServerId}`, {
      method: "PATCH",
      body: JSON.stringify({ iconDataUrl: pendingServerIconDataUrl }),
    });
    await loadServers();
    serverIconModal.classList.add("hidden");
  } catch (err) {
    serverIconModalStatus.textContent = err.message;
  }
});

// ---------- Amigos ----------
friendsBtn.addEventListener("click", () => {
  activeServerId = null;
  activeChannelId = null;
  leaveCall();
  renderServerRail();
  document.querySelector(".channel-panel").style.display = "none";
  friendsPanel.style.display = "flex";
  loadFriends();
});

async function loadFriends() {
  try {
    const data = await api("/api/friends");
    renderFriends(data);
  } catch (err) {
    console.error(err);
  }
}

function renderFriendRow({ user, requestId, kind }) {
  const row = document.createElement("div");
  row.className = "friend-row";
  const actionsHtml =
    kind === "incoming"
      ? `<button class="friend-action-btn accept" data-id="${requestId}">Aceitar</button>
         <button class="friend-action-btn decline" data-id="${requestId}">Recusar</button>`
      : kind === "outgoing"
      ? `<button class="friend-action-btn decline" data-id="${requestId}">Cancelar</button>`
      : "";
  row.innerHTML = `
    <div class="avatar">${avatarHtml(user.username, user.avatarDataUrl)}</div>
    <div class="friend-name">${escapeHtml(user.username)}</div>
    <div class="friend-actions">${actionsHtml}</div>
  `;
  if (kind === "incoming") {
    row.querySelector(".accept").addEventListener("click", () => respondFriendRequest(requestId, "accept"));
    row.querySelector(".decline").addEventListener("click", () => respondFriendRequest(requestId, "decline"));
  } else if (kind === "outgoing") {
    row.querySelector(".decline").addEventListener("click", () => respondFriendRequest(requestId, "decline"));
  }
  return row;
}

function renderFriends(data) {
  incomingList.innerHTML = "";
  if (data.incoming.length === 0) {
    incomingList.innerHTML = '<p class="friends-empty">Nenhum pedido recebido.</p>';
  } else {
    for (const r of data.incoming) incomingList.appendChild(renderFriendRow({ ...r, kind: "incoming" }));
  }

  outgoingList.innerHTML = "";
  if (data.outgoing.length === 0) {
    outgoingList.innerHTML = '<p class="friends-empty">Nenhum pedido enviado.</p>';
  } else {
    for (const r of data.outgoing) outgoingList.appendChild(renderFriendRow({ ...r, kind: "outgoing" }));
  }

  friendsList.innerHTML = "";
  if (data.friends.length === 0) {
    friendsList.innerHTML = '<p class="friends-empty">Você ainda não tem amigos adicionados.</p>';
  } else {
    for (const user of data.friends) friendsList.appendChild(renderFriendRow({ user, kind: "friend" }));
  }
}

addFriendBtn.addEventListener("click", async () => {
  const username = addFriendInput.value.trim();
  if (!username) return;
  addFriendStatus.textContent = "";
  try {
    const result = await api("/api/friends/request", {
      method: "POST",
      body: JSON.stringify({ username }),
    });
    addFriendInput.value = "";
    addFriendStatus.textContent = result.autoAccepted ? "Vocês agora são amigos!" : "Pedido enviado!";
    addFriendStatus.style.color = "var(--success)";
    loadFriends();
  } catch (err) {
    addFriendStatus.style.color = "var(--danger)";
    addFriendStatus.textContent = err.message;
  }
});

addFriendInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") addFriendBtn.click();
});

async function respondFriendRequest(requestId, action) {
  try {
    await api(`/api/friends/${requestId}/${action}`, { method: "POST" });
    loadFriends();
  } catch (err) {
    console.error(err);
  }
}

// ---------- Início ----------
updateAuthUI();
tryResumeSession();

// ---------- Login com Google ----------
const GOOGLE_CLIENT_ID = "174563350206-669sgb3rc9fmombqjeearvf8rao54n8u.apps.googleusercontent.com";

async function handleGoogleCredential(response) {
  authStatus.textContent = "";
  try {
    const data = await api("/api/auth/google", {
      method: "POST",
      body: JSON.stringify({ idToken: response.credential }),
    });
    token = data.token;
    currentUser = data.user;
    localStorage.setItem("telalive-token", token);
    enterApp();
  } catch (err) {
    authStatus.textContent = err.message;
  }
}

function initGoogleButton() {
  if (!window.google || !window.google.accounts) {
    setTimeout(initGoogleButton, 300);
    return;
  }
  google.accounts.id.initialize({ client_id: GOOGLE_CLIENT_ID, callback: handleGoogleCredential });
  google.accounts.id.renderButton(document.getElementById("google-signin-btn"), {
    theme: "filled_black",
    size: "large",
    shape: "pill",
    text: "continue_with",
  });
}
initGoogleButton();
