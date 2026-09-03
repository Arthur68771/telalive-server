// ---------- Estado geral ----------
let token = localStorage.getItem("telalive-token") || null;
let currentUser = null;
let myServers = [];
let activeServerId = null;
let activeChannelId = null;
let activeChannelType = "text";
let authMode = "login"; // ou "register"

let ws = null;
let selfPeerId = null;
let knownPeers = new Map(); // peerId -> username (quem está no canal agora)
let pcsOut = new Map(); // peerId -> RTCPeerConnection (conexões que eu abri pra compartilhar MINHA tela)
let pcsIn = new Map(); // peerId -> RTCPeerConnection (conexões que recebem a tela de OUTRA pessoa)
const pendingIceCandidates = new Map(); // peerId -> lista de candidatos que chegaram cedo demais
let localScreenStream = null;
let localMicStream = null;
let micMuted = false;

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
const participantsCircleRow = document.getElementById("participants-circle-row");
const waitingText = document.getElementById("waiting-text");
const statusText = document.getElementById("status-text");
const shareBtn = document.getElementById("share-btn");
const stopShareBtn = document.getElementById("stop-share-btn");
const micBtn = document.getElementById("mic-btn");
const deafenBtn = document.getElementById("deafen-btn");
const leaveChannelBtn = document.getElementById("leave-channel-btn");
let deafened = false;

let audioContext = null;
const audioAnalysers = new Map(); // "me" ou peerId -> AnalyserNode
let speakingLoopRunning = false;

// ---------- Sons de notificação ----------
const joinSound = new Audio("join.mp3");
const leaveSound = new Audio("leave.mp3");
const messageSound = new Audio("message.mp3");
[joinSound, leaveSound, messageSound].forEach((a) => (a.volume = 0.5));
function playJoinSound() { joinSound.currentTime = 0; joinSound.play().catch(() => {}); }
function playLeaveSound() { leaveSound.currentTime = 0; leaveSound.play().catch(() => {}); }
function playMessageSound() { messageSound.currentTime = 0; messageSound.play().catch(() => {}); }
const chatMessagesEl = document.getElementById("chat-messages");
const chatEmptyEl = document.getElementById("chat-empty");
const chatInput = document.getElementById("chat-input");
const chatSendBtn = document.getElementById("chat-send-btn");
const chatAttachBtn = document.getElementById("chat-attach-btn");
const chatImageInput = document.getElementById("chat-image-input");
const chatImagePreview = document.getElementById("chat-image-preview");
const chatImagePreviewImg = document.getElementById("chat-image-preview-img");
const chatImagePreviewRemove = document.getElementById("chat-image-preview-remove");
let pendingChatImageDataUrl = null;
const mentionDropdown = document.getElementById("mention-dropdown");
let cachedFriendsForMention = null;
let mentionActiveIndex = 0;

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

const newChannelCategory = document.getElementById("new-channel-category");
const typeTextBtn = document.getElementById("type-text-btn");
const typeVoiceBtn = document.getElementById("type-voice-btn");
let selectedChannelType = "text";

const categoryModal = document.getElementById("category-modal");
const newCategoryName = document.getElementById("new-category-name");
const newCategoryPrivate = document.getElementById("new-category-private");
const categoryMembersField = document.getElementById("category-members-field");
const categoryMembersList = document.getElementById("category-members-list");
const categoryModalStatus = document.getElementById("category-modal-status");
const categoryModalCancel = document.getElementById("category-modal-cancel");
const categoryModalConfirm = document.getElementById("category-modal-confirm");

const serverContextMenu = document.getElementById("server-context-menu");
const ctxCreateChannel = document.getElementById("ctx-create-channel");
const ctxCreateCategory = document.getElementById("ctx-create-category");
const ctxInvite = document.getElementById("ctx-invite");
const ctxToggleMuted = document.getElementById("ctx-toggle-muted");
const ctxToggleMutedSwitch = document.getElementById("ctx-toggle-muted-switch");

const itemContextMenu = document.getElementById("item-context-menu");
const itemCtxCreateChannel = document.getElementById("item-ctx-create-channel");
const itemCtxDelete = document.getElementById("item-ctx-delete");
let itemContextTarget = null; // { type: "channel" | "category", id }

let contextMenuServerId = null;
let hideMutedChannels = localStorage.getItem("telalive-hide-muted") === "1";

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

function resizeImageKeepAspect(file, maxDimension = 640) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = () => {
      const img = new Image();
      img.onerror = reject;
      img.onload = () => {
        let { width, height } = img;
        if (width > height && width > maxDimension) {
          height = Math.round((height * maxDimension) / width);
          width = maxDimension;
        } else if (height > maxDimension) {
          width = Math.round((width * maxDimension) / height);
          height = maxDimension;
        }
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        canvas.getContext("2d").drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL("image/jpeg", 0.82));
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
  serverRail.querySelectorAll(".server-icon:not(.add-btn):not(#friends-btn)").forEach((el) => el.remove());
  for (const server of myServers) {
    const icon = document.createElement("div");
    icon.className = "server-icon" + (server.id === activeServerId ? " active" : "");
    icon.innerHTML = server.iconDataUrl
      ? `<img class="server-icon-img" src="${server.iconDataUrl}" alt="" />`
      : escapeHtml(server.name.slice(0, 2).toUpperCase());
    icon.title = server.name;
    icon.addEventListener("click", () => selectServer(server.id));
    icon.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      openServerContextMenu(server.id, e.clientX, e.clientY);
    });
    serverRail.insertBefore(icon, addServerBtn);
  }
}

function selectServer(serverId) {
  friendsPanel.style.display = "none";
  document.querySelector(".channel-panel").style.display = "flex";
  document.querySelector(".main-panel").style.display = "flex";
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

  const categories = server.categories || [];
  const channelsByCategory = new Map();
  const uncategorized = [];
  for (const channel of server.channels) {
    if (hideMutedChannels && channel.muted) continue;
    if (channel.categoryId) {
      if (!channelsByCategory.has(channel.categoryId)) channelsByCategory.set(channel.categoryId, []);
      channelsByCategory.get(channel.categoryId).push(channel);
    } else {
      uncategorized.push(channel);
    }
  }

  for (const channel of uncategorized) channelList.appendChild(renderChannelItem(channel));

  for (const category of categories) {
    const header = document.createElement("div");
    header.className = "category-header";
    header.innerHTML = `<span>${escapeHtml(category.name)}</span>`;
    header.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      openItemContextMenu("category", category.id, e.clientX, e.clientY);
    });
    channelList.appendChild(header);
    const items = channelsByCategory.get(category.id) || [];
    for (const channel of items) channelList.appendChild(renderChannelItem(channel));
  }
}

function renderChannelItem(channel) {
  const item = document.createElement("div");
  item.className = "channel-item" + (channel.id === activeChannelId ? " active" : "") + (channel.muted ? " muted" : "");
  item.dataset.channelId = channel.id;
  item.innerHTML = `
    <span class="hash">${channel.type === "voice" ? "🔊" : "#"}</span><span>${escapeHtml(channel.name)}</span>
    <div class="channel-item-presence" id="presence-${channel.id}"></div>
    <button class="mute-toggle" title="${channel.muted ? "Reativar" : "Silenciar"}">${channel.muted ? "🔇" : "🔊"}</button>
  `;
  item.addEventListener("click", (e) => {
    if (e.target.closest(".mute-toggle")) return;
    selectChannel(channel.id, channel.name);
  });
  item.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    openItemContextMenu("channel", channel.id, e.clientX, e.clientY);
  });
  item.querySelector(".mute-toggle").addEventListener("click", async (e) => {
    e.stopPropagation();
    await api(`/api/channels/${channel.id}/mute`, { method: "POST" });
    await loadServers();
    renderChannelList();
  });
  return item;
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

  const server = myServers.find((s) => s.id === activeServerId);
  const channel = server?.channels.find((c) => c.id === channelId);
  activeChannelType = channel?.type === "voice" ? "voice" : "text";
  const callColumn = document.querySelector(".call-column");
  const chatColumn = document.querySelector(".chat-column");
  if (activeChannelType === "voice") {
    callColumn.style.display = "flex";
    chatColumn.style.display = "none";
  } else {
    callColumn.style.display = "none";
    chatColumn.style.display = "flex";
    chatColumn.style.width = "100%";
  }

  loadMessageHistory(channelId);
  connectToChannel(channelId);
  renderParticipantsBar();
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
      ${msg.text ? `<div class="chat-msg-text">${highlightMentions(escapeHtml(msg.text))}</div>` : ""}
      ${msg.imageDataUrl ? `<img class="chat-msg-image" src="${msg.imageDataUrl}" alt="imagem" />` : ""}
    </div>
  `;
  if (msg.imageDataUrl) {
    el.querySelector(".chat-msg-image").addEventListener("click", () => window.open(msg.imageDataUrl, "_blank"));
  }
  chatMessagesEl.appendChild(el);
  chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
}

function sendChatMessage() {
  const text = chatInput.value.trim();
  if ((!text && !pendingChatImageDataUrl) || !ws || ws.readyState !== WebSocket.OPEN || !activeChannelId) return;
  ws.send(
    JSON.stringify({
      type: "chat-message",
      channelId: activeChannelId,
      text,
      imageDataUrl: pendingChatImageDataUrl || undefined,
    })
  );
  chatInput.value = "";
  clearPendingChatImage();
}

chatSendBtn.addEventListener("click", sendChatMessage);
chatInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && mentionDropdown.classList.contains("hidden")) sendChatMessage();
});

// ---------- Enviar imagem no chat (colar ou escolher arquivo) ----------
async function setPendingChatImage(file) {
  if (!file || !file.type.startsWith("image/")) return;
  pendingChatImageDataUrl = await resizeImageKeepAspect(file, 640);
  chatImagePreviewImg.src = pendingChatImageDataUrl;
  chatImagePreview.classList.remove("hidden");
}

function clearPendingChatImage() {
  pendingChatImageDataUrl = null;
  chatImagePreview.classList.add("hidden");
  chatImagePreviewImg.src = "";
  chatImageInput.value = "";
}

chatAttachBtn.addEventListener("click", () => chatImageInput.click());
chatImageInput.addEventListener("change", () => setPendingChatImage(chatImageInput.files[0]));
chatImagePreviewRemove.addEventListener("click", clearPendingChatImage);

chatInput.addEventListener("paste", (e) => {
  const items = e.clipboardData?.items || [];
  for (const item of items) {
    if (item.type.startsWith("image/")) {
      setPendingChatImage(item.getAsFile());
      e.preventDefault();
      break;
    }
  }
});

// ---------- Menções com @ ----------
async function getMentionOptions(query) {
  if (!cachedFriendsForMention) {
    try {
      const data = await api("/api/friends");
      cachedFriendsForMention = data.friends;
    } catch {
      cachedFriendsForMention = [];
    }
  }
  const options = [{ everyone: true, label: "everyone" }, ...cachedFriendsForMention.map((f) => ({ user: f }))];
  const q = query.toLowerCase();
  return options.filter((o) => (o.everyone ? "everyone" : o.user.username.toLowerCase()).includes(q));
}

function getMentionQuery() {
  const cursor = chatInput.selectionStart;
  const textBefore = chatInput.value.slice(0, cursor);
  const match = textBefore.match(/(?:^|\s)@([a-zA-Z0-9_]*)$/);
  return match ? match[1] : null;
}

async function updateMentionDropdown() {
  const query = getMentionQuery();
  if (query === null) {
    mentionDropdown.classList.add("hidden");
    return;
  }
  const options = await getMentionOptions(query);
  if (options.length === 0) {
    mentionDropdown.classList.add("hidden");
    return;
  }
  mentionActiveIndex = 0;
  mentionDropdown.innerHTML = "";
  options.forEach((opt, i) => {
    const item = document.createElement("div");
    item.className = "mention-item" + (i === 0 ? " active" : "");
    if (opt.everyone) {
      item.innerHTML = `<div class="mention-everyone">@</div><span>everyone</span>`;
    } else {
      item.innerHTML = `<div class="avatar">${avatarHtml(opt.user.username, opt.user.avatarDataUrl)}</div><span>${escapeHtml(opt.user.username)}</span>`;
    }
    item.addEventListener("click", () => applyMention(opt));
    mentionDropdown.appendChild(item);
  });
  mentionDropdown.classList.remove("hidden");
}

function applyMention(opt) {
  const name = opt.everyone ? "everyone" : opt.user.username;
  const cursor = chatInput.selectionStart;
  const textBefore = chatInput.value.slice(0, cursor);
  const textAfter = chatInput.value.slice(cursor);
  const newBefore = textBefore.replace(/@([a-zA-Z0-9_]*)$/, `@${name} `);
  chatInput.value = newBefore + textAfter;
  mentionDropdown.classList.add("hidden");
  chatInput.focus();
}

chatInput.addEventListener("input", updateMentionDropdown);

chatInput.addEventListener("keydown", (e) => {
  if (mentionDropdown.classList.contains("hidden")) return;
  const items = [...mentionDropdown.children];
  if (e.key === "ArrowDown") {
    e.preventDefault();
    mentionActiveIndex = (mentionActiveIndex + 1) % items.length;
    items.forEach((el, i) => el.classList.toggle("active", i === mentionActiveIndex));
  } else if (e.key === "ArrowUp") {
    e.preventDefault();
    mentionActiveIndex = (mentionActiveIndex - 1 + items.length) % items.length;
    items.forEach((el, i) => el.classList.toggle("active", i === mentionActiveIndex));
  } else if (e.key === "Enter" || e.key === "Tab") {
    e.preventDefault();
    items[mentionActiveIndex]?.click();
  } else if (e.key === "Escape") {
    mentionDropdown.classList.add("hidden");
  }
});

function highlightMentions(text) {
  return text.replace(/@(everyone|[a-zA-Z0-9_]{3,24})/g, '<span class="chat-mention">@$1</span>');
}

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
        knownPeers = new Map(msg.peers.map((p) => [p.id, { username: p.username, avatarDataUrl: p.avatarDataUrl }]));
        updateWaitingText();
        renderParticipantsBar();
        for (const peerId of knownPeers.keys()) await syncOutgoingTracksToPeer(peerId);
        if (activeChannelType === "voice") await ensureMicJoined();
        break;
      }

      case "peer-joined": {
        knownPeers.set(msg.id, { username: msg.username, avatarDataUrl: msg.avatarDataUrl });
        playJoinSound();
        updateWaitingText();
        renderParticipantsBar();
        // se eu já tiver microfone ou tela ativos, o recém-chegado
        // também precisa receber - sincroniza minha mídia com ele
        await syncOutgoingTracksToPeer(msg.id);
        break;
      }

      case "offer": {
        let pcIn = pcsIn.get(msg.from);
        if (!pcIn) {
          pcIn = createPeerConnection(msg.from, "in");
          pcsIn.set(msg.from, pcIn);
        }
        await pcIn.setRemoteDescription(new RTCSessionDescription(msg.sdp));
        await flushPendingIceCandidates(msg.from, pcIn);
        const answer = await pcIn.createAnswer();
        await pcIn.setLocalDescription(answer);
        ws.send(JSON.stringify({ type: "answer", target: msg.from, sdp: answer }));
        break;
      }

      case "answer": {
        const pcOut = pcsOut.get(msg.from);
        if (pcOut) {
          await pcOut.setRemoteDescription(new RTCSessionDescription(msg.sdp));
          await flushPendingIceCandidates(msg.from, pcOut);
        }
        break;
      }

      case "ice-candidate": {
        if (!msg.candidate) break;
        const pc = pcsOut.get(msg.from) || pcsIn.get(msg.from);
        if (pc) {
          if (pc.remoteDescription) {
            try {
              await pc.addIceCandidate(new RTCIceCandidate(msg.candidate));
            } catch (err) {
              console.error(err);
            }
          } else {
            // ainda não temos a descrição remota - guarda pra aplicar depois
            if (!pendingIceCandidates.has(msg.from)) pendingIceCandidates.set(msg.from, []);
            pendingIceCandidates.get(msg.from).push(msg.candidate);
          }
        }
        break;
      }

      case "peer-left": {
        knownPeers.delete(msg.id);
        closePeerConnections(msg.id);
        removeVideoTile(msg.id);
        cleanupPeerAudio(msg.id);
        playLeaveSound();
        updateWaitingText();
        renderParticipantsBar();
        break;
      }

      case "screen-share-ended": {
        removeVideoTile(msg.from);
        break;
      }

      case "chat-message":
        if (msg.message.userId !== currentUser?.id) playMessageSound();
        appendChatMessage(msg.message);
        break;
    }
  };
}

function updateWaitingText() {
  const count = knownPeers.size;
  if (count === 0) {
    waitingText.textContent = "Você é a única pessoa aqui por enquanto...";
  } else {
    waitingText.textContent = `${count} pessoa${count > 1 ? "s" : ""} no canal. Clique em "Compartilhar minha tela" quando quiser.`;
  }
}

function renderParticipantsBar() {
  participantsCircleRow.innerHTML = "";

  const meCircle = document.createElement("div");
  meCircle.className = "participant-circle";
  meCircle.dataset.key = "me";
  meCircle.innerHTML = `<div class="avatar-lg">${avatarHtml(currentUser?.username, currentUser?.avatarDataUrl)}</div><div class="participant-name">Você</div>`;
  participantsCircleRow.appendChild(meCircle);

  for (const [peerId, peer] of knownPeers) {
    const circle = document.createElement("div");
    circle.className = "participant-circle";
    circle.dataset.key = peerId;
    circle.innerHTML = `<div class="avatar-lg">${avatarHtml(peer.username, peer.avatarDataUrl)}</div><div class="participant-name">${escapeHtml(peer.username)}</div>`;
    participantsCircleRow.appendChild(circle);
  }

  updateChannelSidebarPresence();
}

function updateChannelSidebarPresence() {
  if (!activeChannelId) return;
  const holder = document.getElementById(`presence-${activeChannelId}`);
  if (!holder) return;
  holder.innerHTML = "";

  const meMini = document.createElement("div");
  meMini.className = "mini-avatar";
  meMini.title = "Você";
  meMini.innerHTML = avatarHtml(currentUser?.username, currentUser?.avatarDataUrl);
  holder.appendChild(meMini);

  for (const peer of knownPeers.values()) {
    const mini = document.createElement("div");
    mini.className = "mini-avatar";
    mini.title = peer.username;
    mini.innerHTML = avatarHtml(peer.username, peer.avatarDataUrl);
    holder.appendChild(mini);
  }
}

async function flushPendingIceCandidates(peerId, pc) {
  const queued = pendingIceCandidates.get(peerId);
  if (!queued) return;
  pendingIceCandidates.delete(peerId);
  for (const candidate of queued) {
    try {
      await pc.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (err) {
      console.error(err);
    }
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
      const stream = event.streams[0];
      if (event.track.kind === "video") {
        showVideoTile(peerId, knownPeers.get(peerId)?.username || "Alguém", stream);
      } else if (event.track.kind === "audio" && stream.getVideoTracks().length === 0) {
        // áudio "puro" (microfone) - toca escondido e liga o detector de fala
        playRemoteAudio(peerId, stream);
        setupSpeakingDetector(stream, peerId);
      }
      // se o áudio vier junto com vídeo (ex: compartilhamento com som do
      // sistema), o próprio elemento de vídeo já toca ele - não duplica.
    };
  }

  conn.onconnectionstatechange = () => {
    if (conn.connectionState === "connected") {
      statusText.textContent = "Transmitindo ao vivo";
    }
  };

  return conn;
}

function playRemoteAudio(peerId, stream) {
  let audioEl = document.getElementById(`audio-${peerId}`);
  if (!audioEl) {
    audioEl = document.createElement("audio");
    audioEl.id = `audio-${peerId}`;
    audioEl.autoplay = true;
    audioEl.style.display = "none";
    document.body.appendChild(audioEl);
  }
  audioEl.srcObject = stream;
  audioEl.muted = deafened;
}

deafenBtn.addEventListener("click", () => {
  deafened = !deafened;
  document.querySelectorAll('audio[id^="audio-"]').forEach((el) => (el.muted = deafened));
  document.querySelectorAll(".video-tile video").forEach((el) => (el.muted = deafened));
  deafenBtn.textContent = deafened ? "🔇" : "🎧";
  deafenBtn.classList.toggle("off", deafened);
  deafenBtn.title = deafened ? "Ativar áudio recebido" : "Mutar áudio recebido";
});

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
  const videoEl = tile.querySelector("video");
  videoEl.srcObject = stream;
  videoEl.muted = deafened;
}

function removeVideoTile(peerId) {
  const tile = document.getElementById(`tile-${peerId}`);
  if (tile) tile.remove();
  if (videoGrid.children.length === 0) waitingState.classList.remove("hidden");
}

function cleanupPeerAudio(peerId) {
  const audioEl = document.getElementById(`audio-${peerId}`);
  if (audioEl) audioEl.remove();
  removeSpeakingDetector(peerId);
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

// Garante que essa pessoa recebe TODA a minha mídia ativa no momento
// (microfone e/ou tela). Reaproveita a mesma conexão pra tudo, e
// renegocia (manda uma nova oferta) sempre que adiciona alguma faixa nova.
async function syncOutgoingTracksToPeer(peerId) {
  let pc = pcsOut.get(peerId);
  if (!pc) {
    pc = createPeerConnection(peerId, "out");
    pcsOut.set(peerId, pc);
  }

  const existingTrackIds = new Set(pc.getSenders().map((s) => s.track?.id).filter(Boolean));
  let addedAny = false;

  if (localMicStream) {
    for (const track of localMicStream.getTracks()) {
      if (!existingTrackIds.has(track.id)) {
        pc.addTrack(track, localMicStream);
        addedAny = true;
      }
    }
  }
  if (localScreenStream) {
    for (const track of localScreenStream.getTracks()) {
      if (!existingTrackIds.has(track.id)) {
        pc.addTrack(track, localScreenStream);
        addedAny = true;
      }
    }
  }

  if (addedAny) {
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    ws.send(JSON.stringify({ type: "offer", target: peerId, sdp: offer }));
  }
}

// ---------- Detectar quem está falando (anel verde no avatar/vídeo) ----------
function setupSpeakingDetector(stream, key) {
  if (!audioContext) audioContext = new (window.AudioContext || window.webkitAudioContext)();
  try {
    const source = audioContext.createMediaStreamSource(stream);
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = 0.6;
    source.connect(analyser);
    audioAnalysers.set(key, analyser);
    if (!speakingLoopRunning) {
      speakingLoopRunning = true;
      requestAnimationFrame(speakingLoop);
    }
  } catch (err) {
    console.error("Não foi possível analisar o áudio:", err);
  }
}

function removeSpeakingDetector(key) {
  audioAnalysers.delete(key);
}

function speakingLoop() {
  const data = new Uint8Array(256);
  for (const [key, analyser] of audioAnalysers) {
    analyser.getByteFrequencyData(data);
    let sum = 0;
    for (const v of data) sum += v;
    const isSpeaking = sum / data.length > 12;

    const circle = document.querySelector(`.participant-circle[data-key="${key}"] .avatar-lg`);
    if (circle) circle.classList.toggle("speaking", isSpeaking);

    const tile = document.getElementById(`tile-${key}`);
    if (tile) tile.classList.toggle("speaking", isSpeaking);
  }
  requestAnimationFrame(speakingLoop);
}

// ---------- Microfone ----------
let noiseSuppressionProcessor = null;

async function ensureMicJoined() {
  if (localMicStream) return;
  try {
    const rawStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        sampleRate: { ideal: 48000 },
        sampleSize: { ideal: 480 },
        channelCount: { exact: 1 },
      },
    });

    // Tenta melhorar ainda mais com redução de ruído por IA (só funciona
    // em navegadores baseados em Chromium - Chrome, Edge, Brave). Se não
    // der, usa o áudio normal mesmo (que já tem redução de ruído básica).
    if (window.Shiguredo) {
      try {
        const assetsPath = "https://cdn.jsdelivr.net/npm/@shiguredo/noise-suppression@latest/dist";
        noiseSuppressionProcessor = new Shiguredo.NoiseSuppressionProcessor(assetsPath);
        const rawTrack = rawStream.getAudioTracks()[0];
        const processedTrack = await noiseSuppressionProcessor.startProcessing(rawTrack);
        localMicStream = new MediaStream([processedTrack]);
      } catch (err) {
        console.error("Redução de ruído por IA indisponível, usando áudio normal:", err);
        localMicStream = rawStream;
      }
    } else {
      localMicStream = rawStream;
    }

    setupSpeakingDetector(localMicStream, "me");
    for (const peerId of knownPeers.keys()) await syncOutgoingTracksToPeer(peerId);
  } catch (err) {
    console.error("Não foi possível acessar o microfone:", err);
  }
}

micBtn.addEventListener("click", async () => {
  if (!localMicStream) {
    await ensureMicJoined();
    micMuted = false;
  } else {
    micMuted = !micMuted;
    for (const track of localMicStream.getTracks()) track.enabled = !micMuted;
  }
  micBtn.textContent = micMuted ? "🔇" : "🎤";
  micBtn.classList.toggle("off", micMuted);
  micBtn.title = micMuted ? "Ativar microfone" : "Mutar microfone";
});

// ---------- Compartilhar tela ----------
shareBtn.addEventListener("click", async () => {
  try {
    localScreenStream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 30 }, audio: true });

    for (const peerId of knownPeers.keys()) await syncOutgoingTracksToPeer(peerId);

    shareBtn.classList.add("hidden");
    stopShareBtn.classList.remove("hidden");
    statusText.textContent = "Transmitindo sua tela";

    localScreenStream.getVideoTracks()[0].onended = () => stopSharing();
  } catch (err) {
    console.error(err);
  }
});

stopShareBtn.addEventListener("click", stopSharing);

function stopSharing() {
  if (localScreenStream) {
    for (const track of localScreenStream.getTracks()) {
      track.stop();
      for (const pc of pcsOut.values()) {
        const sender = pc.getSenders().find((s) => s.track === track);
        if (sender) pc.removeTrack(sender);
      }
    }
  }
  localScreenStream = null;
  statusText.textContent = "Compartilhamento parado";
  stopShareBtn.classList.add("hidden");
  shareBtn.classList.remove("hidden");
  if (ws) ws.send(JSON.stringify({ type: "screen-share-ended" }));
}

leaveChannelBtn.addEventListener("click", () => {
  leaveCall();
  activeChannelId = null;
  renderChannelList();
  emptyState.classList.remove("hidden");
  callView.classList.add("hidden");
});

function leaveCall() {
  if (localScreenStream) for (const track of localScreenStream.getTracks()) track.stop();
  if (localMicStream) for (const track of localMicStream.getTracks()) track.stop();
  if (noiseSuppressionProcessor) {
    noiseSuppressionProcessor.stopProcessing();
    noiseSuppressionProcessor = null;
  }
  for (const pc of pcsOut.values()) pc.close();
  for (const pc of pcsIn.values()) pc.close();
  document.querySelectorAll('audio[id^="audio-"]').forEach((el) => el.remove());
  audioAnalysers.clear();
  pcsOut.clear();
  pcsIn.clear();
  knownPeers.clear();
  if (ws) ws.close();
  ws = null;
  localScreenStream = null;
  localMicStream = null;
  micMuted = false;
  micBtn.textContent = "🎤";
  micBtn.classList.remove("off");
  selfPeerId = null;
}

async function openDirectMessage(friendUser) {
  try {
    const data = await api(`/api/friends/${friendUser.id}/dm`, { method: "POST" });
    leaveCall();
    activeServerId = null;
    activeChannelId = data.channelId;
    activeChannelType = "dm";

    friendsPanel.style.display = "none";
    document.querySelector(".channel-panel").style.display = "none";
    document.querySelector(".main-panel").style.display = "flex";
    emptyState.classList.add("hidden");
    callView.classList.remove("hidden");

    activeChannelName.textContent = friendUser.username;
    waitingState.classList.remove("hidden");
    videoGrid.innerHTML = "";
    shareBtn.classList.remove("hidden");
    stopShareBtn.classList.add("hidden");
    statusText.textContent = "Conectado";

    const callColumn = document.querySelector(".call-column");
    const chatColumn = document.querySelector(".chat-column");
    callColumn.style.display = "flex";
    chatColumn.style.display = "flex";
    chatColumn.style.width = "";

    loadMessageHistory(activeChannelId);
    connectToChannel(activeChannelId);
    renderParticipantsBar();
  } catch (err) {
    alert(err.message);
  }
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
  selectedChannelType = "text";
  typeTextBtn.classList.add("active");
  typeVoiceBtn.classList.remove("active");
  const server = myServers.find((s) => s.id === activeServerId);
  newChannelCategory.innerHTML = '<option value="">Sem categoria</option>';
  for (const cat of server?.categories || []) {
    const opt = document.createElement("option");
    opt.value = cat.id;
    opt.textContent = cat.name;
    newChannelCategory.appendChild(opt);
  }
});

typeTextBtn.addEventListener("click", () => {
  selectedChannelType = "text";
  typeTextBtn.classList.add("active");
  typeVoiceBtn.classList.remove("active");
});
typeVoiceBtn.addEventListener("click", () => {
  selectedChannelType = "voice";
  typeVoiceBtn.classList.add("active");
  typeTextBtn.classList.remove("active");
});
channelModalCancel.addEventListener("click", () => channelModal.classList.add("hidden"));

channelModalConfirm.addEventListener("click", async () => {
  channelModalStatus.textContent = "";
  try {
    await api(`/api/servers/${activeServerId}/channels`, {
      method: "POST",
      body: JSON.stringify({
        name: newChannelName.value.trim(),
        categoryId: newChannelCategory.value || null,
        type: selectedChannelType,
      }),
    });
    await loadServers();
    renderChannelList();
    channelModal.classList.add("hidden");
  } catch (err) {
    channelModalStatus.textContent = err.message;
  }
});

// ---------- Modal: editar perfil ----------
const profileUsernameInput = document.getElementById("profile-username-input");

profileBtn.addEventListener("click", () => {
  pendingAvatarDataUrl = null;
  profileModalStatus.textContent = "";
  profileAvatarPreview.innerHTML = avatarHtml(currentUser?.username, currentUser?.avatarDataUrl);
  profileUsernameInput.value = currentUser?.username || "";
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
  const newUsername = profileUsernameInput.value.trim();
  const body = {};
  if (pendingAvatarDataUrl) body.avatarDataUrl = pendingAvatarDataUrl;
  if (newUsername && newUsername !== currentUser?.username) body.username = newUsername;

  if (Object.keys(body).length === 0) {
    profileModal.classList.add("hidden");
    return;
  }
  profileModalStatus.textContent = "";
  try {
    currentUser = await api("/api/me", { method: "PATCH", body: JSON.stringify(body) });
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
  document.querySelector(".main-panel").style.display = "none";
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
      : `<button class="friend-action-btn accept" id="dm-btn">Conversar</button>`;
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
  } else if (kind === "friend") {
    row.querySelector("#dm-btn").addEventListener("click", () => openDirectMessage(user));
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

// ---------- Menu de contexto do servidor (botão direito) ----------
function openServerContextMenu(serverId, x, y) {
  contextMenuServerId = serverId;
  ctxToggleMutedSwitch.classList.toggle("on", hideMutedChannels);
  serverContextMenu.style.left = `${x}px`;
  serverContextMenu.style.top = `${y}px`;
  serverContextMenu.classList.remove("hidden");
}

function closeServerContextMenu() {
  serverContextMenu.classList.add("hidden");
  contextMenuServerId = null;
}

document.addEventListener("click", (e) => {
  if (!serverContextMenu.contains(e.target)) closeServerContextMenu();
  if (!itemContextMenu.contains(e.target)) itemContextMenu.classList.add("hidden");
});

function openItemContextMenu(type, id, x, y) {
  itemContextTarget = { type, id };
  itemCtxCreateChannel.style.display = type === "category" ? "flex" : "none";
  itemCtxDelete.querySelector("span").textContent = type === "category" ? "Excluir categoria" : "Excluir canal";
  itemContextMenu.style.left = `${x}px`;
  itemContextMenu.style.top = `${y}px`;
  itemContextMenu.classList.remove("hidden");
}

itemCtxCreateChannel.addEventListener("click", () => {
  itemContextMenu.classList.add("hidden");
  addChannelBtn.click();
  if (itemContextTarget?.type === "category") newChannelCategory.value = itemContextTarget.id;
});

itemCtxDelete.addEventListener("click", async () => {
  itemContextMenu.classList.add("hidden");
  if (!itemContextTarget) return;
  try {
    if (itemContextTarget.type === "channel") {
      await api(`/api/channels/${itemContextTarget.id}`, { method: "DELETE" });
      if (activeChannelId === itemContextTarget.id) {
        activeChannelId = null;
        leaveCall();
        emptyState.classList.remove("hidden");
        callView.classList.add("hidden");
      }
    } else {
      await api(`/api/servers/${activeServerId}/categories/${itemContextTarget.id}`, { method: "DELETE" });
    }
    await loadServers();
    renderChannelList();
  } catch (err) {
    alert(err.message);
  }
});

ctxCreateChannel.addEventListener("click", () => {
  if (contextMenuServerId !== activeServerId) selectServer(contextMenuServerId);
  closeServerContextMenu();
  addChannelBtn.click();
});

ctxCreateCategory.addEventListener("click", () => {
  if (contextMenuServerId !== activeServerId) selectServer(contextMenuServerId);
  closeServerContextMenu();
  newCategoryName.value = "";
  newCategoryPrivate.checked = false;
  categoryMembersField.classList.add("hidden");
  categoryModalStatus.textContent = "";
  categoryModal.classList.remove("hidden");
});

newCategoryPrivate.addEventListener("change", async () => {
  if (!newCategoryPrivate.checked) {
    categoryMembersField.classList.add("hidden");
    return;
  }
  categoryMembersField.classList.remove("hidden");
  categoryMembersList.innerHTML = "Carregando...";
  try {
    const members = await api(`/api/servers/${activeServerId}/members`);
    categoryMembersList.innerHTML = "";
    for (const member of members) {
      if (member.id === currentUser.id) continue; // dono sempre vê, não precisa marcar
      const row = document.createElement("label");
      row.className = "member-check-row";
      row.innerHTML = `
        <input type="checkbox" value="${member.id}" />
        <div class="avatar">${avatarHtml(member.username, member.avatarDataUrl)}</div>
        <span>${escapeHtml(member.username)}</span>
      `;
      categoryMembersList.appendChild(row);
    }
    if (categoryMembersList.children.length === 0) {
      categoryMembersList.innerHTML = '<p class="friends-empty">Ninguém mais nesse servidor ainda.</p>';
    }
  } catch (err) {
    categoryMembersList.innerHTML = "";
  }
});

ctxInvite.addEventListener("click", () => {
  const server = myServers.find((s) => s.id === contextMenuServerId);
  if (server) {
    navigator.clipboard.writeText(server.inviteCode);
    ctxInvite.querySelector("span").textContent = "Código copiado!";
    setTimeout(() => (ctxInvite.querySelector("span").textContent = "Convidar para o servidor"), 1200);
  }
});

ctxToggleMuted.addEventListener("click", () => {
  hideMutedChannels = !hideMutedChannels;
  localStorage.setItem("telalive-hide-muted", hideMutedChannels ? "1" : "0");
  ctxToggleMutedSwitch.classList.toggle("on", hideMutedChannels);
  renderChannelList();
});

categoryModalCancel.addEventListener("click", () => categoryModal.classList.add("hidden"));

categoryModalConfirm.addEventListener("click", async () => {
  categoryModalStatus.textContent = "";
  const allowedUserIds = newCategoryPrivate.checked
    ? [...categoryMembersList.querySelectorAll("input:checked")].map((el) => el.value)
    : [];
  try {
    await api(`/api/servers/${activeServerId}/categories`, {
      method: "POST",
      body: JSON.stringify({
        name: newCategoryName.value.trim(),
        private: newCategoryPrivate.checked,
        allowedUserIds,
      }),
    });
    await loadServers();
    renderChannelList();
    categoryModal.classList.add("hidden");
  } catch (err) {
    categoryModalStatus.textContent = err.message;
  }
});

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
