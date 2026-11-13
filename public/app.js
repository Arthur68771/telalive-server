// ---------- Estado geral ----------
let token = localStorage.getItem("telalive-token") || null;
let currentUser = null;
let myServers = [];
let activeServerId = null;
let activeChannelId = null;
let activeChannelType = "text";
let authMode = "login";

let ws = null;
let selfPeerId = null;
let knownPeers = new Map();
let pcsOut = new Map();
let pcsIn = new Map();
const pendingIceCandidates = new Map();
let localScreenStream = null;
let localMicStream = null;
let micMuted = false;

let rtcConfig = { iceServers: [{ urls: "stun:stun.l.google.com:19302" }] };
const typingUsers = new Map();
let typingTimeout = null;
let isTyping = false;

let isLoadingHistory = false;
let hasMoreHistory = true;
let oldestMessageTime = null;
let lastMessageDate = null;

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
const audioAnalysers = new Map();
let speakingLoopRunning = false;

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

const chatRecordBtn = document.getElementById("chat-record-btn");
const chatAudioPreview = document.getElementById("chat-audio-preview");
const chatAudioPreviewPlayer = document.getElementById("chat-audio-preview-player");
const chatAudioPreviewRemove = document.getElementById("chat-audio-preview-remove");
let pendingChatAudioDataUrl = null;
let audioRecorder = null;
let audioRecorderChunks = [];

const typingIndicator = document.getElementById("typing-indicator");

let replyingToMessage = null;
const replyBanner = document.getElementById("reply-banner");
const replyBannerText = document.getElementById("reply-banner-text");
const replyBannerCancel = document.getElementById("reply-banner-cancel");

const forwardModal = document.getElementById("forward-modal");
const forwardTargetsList = document.getElementById("forward-targets-list");
const forwardModalStatus = document.getElementById("forward-modal-status");
const forwardModalCancel = document.getElementById("forward-modal-cancel");
let forwardingMessage = null;
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

const profileBannerPreview = document.getElementById("profile-banner-preview");
const profileBannerInput = document.getElementById("profile-banner-input");
const profileBannerChooseBtn = document.getElementById("profile-banner-choose-btn");
const profilePronounsInput = document.getElementById("profile-pronouns-input");
const profileBioInput = document.getElementById("profile-bio-input");
let pendingBannerDataUrl = null;

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
let itemContextTarget = null;

let contextMenuServerId = null;
let hideMutedChannels = localStorage.getItem("telalive-hide-muted") === "1";

let pendingAvatarDataUrl = null;
let pendingServerIconDataUrl = null;

const userCardModal = document.getElementById("user-card-modal");
const userCardBanner = document.getElementById("user-card-banner");
const userCardAvatar = document.getElementById("user-card-avatar");
const userCardName = document.getElementById("user-card-name");
const userCardPronouns = document.getElementById("user-card-pronouns");
const userCardBio = document.getElementById("user-card-bio");
const userCardClose = document.getElementById("user-card-close");

const channelPanel = document.querySelector(".channel-panel");
const resizeHandle = document.getElementById("resize-handle");
const savedWidth = localStorage.getItem("telalive-sidebar-width");
if (savedWidth) channelPanel.style.width = savedWidth + "px";
let isResizing = false;
resizeHandle.addEventListener("mousedown", (e) => { e.preventDefault(); isResizing = true; document.body.style.cursor = "ew-resize"; });
document.addEventListener("mousemove", (e) => {
  if (!isResizing) return;
  const newWidth = Math.max(160, Math.min(450, e.clientX));
  channelPanel.style.width = newWidth + "px";
});
document.addEventListener("mouseup", () => {
  if (isResizing) {
    isResizing = false;
    document.body.style.cursor = "";
    localStorage.setItem("telalive-sidebar-width", parseInt(channelPanel.style.width));
  }
});

async function loadIceServers() {
  try {
    const res = await fetch("/api/turn-credentials");
    const data = await res.json();
    if (data.iceServers) rtcConfig = { iceServers: data.iceServers };
  } catch (err) { console.warn("Falha ao carregar TURN."); }
}

function resizeImageFile(file, maxSize = 160) {
  return new Promise((resolve, reject) => {
    if (file.type === "image/gif") {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
      return;
    }
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = () => {
      const img = new Image();
      img.onerror = reject;
      img.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = maxSize; canvas.height = maxSize;
        const ctx = canvas.getContext("2d");
        const side = Math.min(img.width, img.height);
        const sx = (img.width - side) / 2; const sy = (img.height - side) / 2;
        ctx.drawImage(img, sx, sy, side, side, 0, 0, maxSize, maxSize);
        resolve(canvas.toDataURL("image/webp", 0.85));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

function resizeImageKeepAspect(file, maxDimension = 640) {
  return new Promise((resolve, reject) => {
    if (file.type === "image/gif") {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
      return;
    }
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = () => {
      const img = new Image();
      img.onerror = reject;
      img.onload = () => {
        let { width, height } = img;
        if (width > height && width > maxDimension) { height = Math.round((height * maxDimension) / width); width = maxDimension; } 
        else if (height > maxDimension) { width = Math.round((width * maxDimension) / height); height = maxDimension; }
        const canvas = document.createElement("canvas");
        canvas.width = width; canvas.height = height;
        canvas.getContext("2d").drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL("image/webp", 0.82));
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

async function openUserCard(user) {
  if (!user) return;
  if (user.id !== currentUser?.id) {
    try {
      const friends = await api("/api/friends");
      const freshUser = friends.friends.find((f) => f.id === user.id);
      if (freshUser) user = freshUser;
    } catch (err) {}
  } else user = currentUser;
  
  userCardName.textContent = user.username || "?";
  userCardAvatar.innerHTML = avatarHtml(user.username, user.avatarDataUrl);
  if (user.bannerDataUrl) userCardBanner.style.backgroundImage = `url(${user.bannerDataUrl})`;
  else userCardBanner.style.backgroundImage = "";
  if (user.pronouns) { userCardPronouns.textContent = user.pronouns; userCardPronouns.style.display = "block"; } 
  else userCardPronouns.style.display = "none";
  userCardBio.textContent = user.bio || "Sem bio.";
  userCardModal.classList.remove("hidden");
}
function closeUserCard() { userCardModal.classList.add("hidden"); }
userCardClose.addEventListener("click", closeUserCard);
userCardModal.addEventListener("click", (e) => { if (e.target === userCardModal) closeUserCard(); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !userCardModal.classList.contains("hidden")) closeUserCard(); });

async function api(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(options.headers || {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Algo deu errado.");
  return data;
}

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

async function enterApp() {
  authScreen.classList.add("hidden");
  appScreen.style.display = "flex";
  updateProfileBtn();
  await loadServers();
}

function updateProfileBtn() { profileBtn.innerHTML = avatarHtml(currentUser?.username, currentUser?.avatarDataUrl); }

async function loadServers() {
  myServers = await api("/api/servers");
  renderServerRail();
}

function renderServerRail() {
  serverRail.querySelectorAll(".server-icon:not(.add-btn):not(#friends-btn)").forEach((el) => el.remove());
  for (const server of myServers) {
    const icon = document.createElement("div");
    icon.className = "server-icon" + (server.id === activeServerId ? " active" : "");
    icon.innerHTML = server.iconDataUrl ? `<img class="server-icon-img" src="${server.iconDataUrl}" alt="" />` : escapeHtml(server.name.slice(0, 2).toUpperCase());
    icon.title = server.name;
    icon.addEventListener("click", () => selectServer(server.id));
    icon.addEventListener("contextmenu", (e) => { e.preventDefault(); openServerContextMenu(server.id, e.clientX, e.clientY); });
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
    inviteHint.classList.add("hidden"); addChannelBtn.classList.add("hidden"); editServerIconBtn.classList.add("hidden");
    return;
  }
  currentServerName.textContent = server.name;
  inviteCodeEl.textContent = server.inviteCode;
  inviteHint.classList.remove("hidden"); addChannelBtn.classList.remove("hidden");
  editServerIconBtn.classList.toggle("hidden", server.ownerId !== currentUser?.id);

  const categories = server.categories || [];
  const channelsByCategory = new Map();
  const uncategorized = [];
  for (const channel of server.channels) {
    if (hideMutedChannels && channel.muted) continue;
    if (channel.categoryId) {
      if (!channelsByCategory.has(channel.categoryId)) channelsByCategory.set(channel.categoryId, []);
      channelsByCategory.get(channel.categoryId).push(channel);
    } else uncategorized.push(channel);
  }

  for (const channel of uncategorized) channelList.appendChild(renderChannelItem(channel));
  for (const category of categories) {
    const header = document.createElement("div");
    header.className = "category-header";
    header.innerHTML = `<span>${escapeHtml(category.name)}</span>`;
    header.addEventListener("contextmenu", (e) => { e.preventDefault(); openItemContextMenu("category", category.id, e.clientX, e.clientY); });
    channelList.appendChild(header);
    const items = channelsByCategory.get(category.id) || [];
    for (const channel of items) channelList.appendChild(renderChannelItem(channel));
  }
}

function renderChannelItem(channel) {
  const item = document.createElement("div");
  item.className = "channel-item" + (channel.id === activeChannelId ? " active" : "") + (channel.muted ? " muted" : "");
  item.dataset.channelId = channel.id;
  item.innerHTML = `<span class="hash">${channel.type === "voice" ? "🔊" : "#"}</span><span>${escapeHtml(channel.name)}</span><div class="channel-item-presence" id="presence-${channel.id}"></div><button class="mute-toggle" title="${channel.muted ? "Reativar" : "Silenciar"}">${channel.muted ? "🔇" : "🔊"}</button>`;
  item.addEventListener("click", (e) => { if (e.target.closest(".mute-toggle")) return; selectChannel(channel.id, channel.name); });
  item.addEventListener("contextmenu", (e) => { e.preventDefault(); openItemContextMenu("channel", channel.id, e.clientX, e.clientY); });
  item.querySelector(".mute-toggle").addEventListener("click", async (e) => { e.stopPropagation(); await api(`/api/channels/${channel.id}/mute`, { method: "POST" }); await loadServers(); renderChannelList(); });
  return item;
}

function escapeHtml(str) { const div = document.createElement("div"); div.textContent = str; return div.innerHTML; }

inviteHint.addEventListener("click", () => {
  navigator.clipboard.writeText(inviteCodeEl.textContent);
  inviteHint.querySelector("strong").textContent = "copiado!";
  setTimeout(() => { const server = myServers.find((s) => s.id === activeServerId); if (server) inviteCodeEl.textContent = server.inviteCode; }, 1200);
});

function showEmptyState() { emptyState.classList.remove("hidden"); callView.classList.add("hidden"); }

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
  shareBtn.classList.remove("hidden"); stopShareBtn.classList.add("hidden");
  
  typingUsers.clear();
  updateTypingIndicator();

  const server = myServers.find((s) => s.id === activeServerId);
  const channel = server?.channels.find((c) => c.id === channelId);
  activeChannelType = channel?.type === "voice" ? "voice" : "text";
  const callColumn = document.querySelector(".call-column");
  const chatColumn = document.querySelector(".chat-column");
  if (activeChannelType === "voice") { callColumn.style.display = "flex"; chatColumn.style.display = "none"; }
  else { callColumn.style.display = "none"; chatColumn.style.display = "flex"; chatColumn.style.width = "100%"; }

  loadMessageHistory(channelId);
  connectToChannel(channelId);
  renderParticipantsBar();
  renderTopbarParticipants();
}

async function loadMessageHistory(channelId) {
  chatMessagesEl.innerHTML = '<div class="load-more-trigger" id="load-more-trigger"></div><p class="chat-empty" id="chat-empty">Carregando...</p>';
  isLoadingHistory = false;
  hasMoreHistory = true;
  oldestMessageTime = null;
  lastMessageDate = null;
  
  chatMessagesEl.onscroll = async () => {
    if (chatMessagesEl.scrollTop === 0 && hasMoreHistory && !isLoadingHistory) {
      await loadOlderMessages(channelId);
    }
  };

  try {
    const messages = await api(`/api/channels/${channelId}/messages?limit=50`);
    
    chatMessagesEl.innerHTML = '<div class="load-more-trigger" id="load-more-trigger"></div>';
    
    if (messages.length === 0) {
      chatMessagesEl.innerHTML += '<p class="chat-empty">Nenhuma mensagem ainda. Diga oi!</p>';
      hasMoreHistory = false;
      return;
    }

    if (messages.length < 50) hasMoreHistory = false;
    oldestMessageTime = messages[0].createdAt;

    for (const msg of messages) {
      appendChatMessage(msg, false);
    }
    
    chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
  } catch (err) {
    console.error(err);
    chatMessagesEl.innerHTML = '<p class="chat-empty">Erro ao carregar mensagens.</p>';
  }
}

async function loadOlderMessages(channelId) {
  if (isLoadingHistory || !hasMoreHistory || !oldestMessageTime) return;
  isLoadingHistory = true;
  
  const trigger = document.getElementById("load-more-trigger");
  if (trigger) trigger.classList.add("loading");

  try {
    const messages = await api(`/api/channels/${channelId}/messages?limit=50&before=${oldestMessageTime}`);
    
    if (messages.length === 0) {
      hasMoreHistory = false;
      if (trigger) trigger.classList.remove("loading");
      isLoadingHistory = false;
      return;
    }

    if (messages.length < 50) hasMoreHistory = false;
    oldestMessageTime = messages[0].createdAt;

    const allMessages = await api(`/api/channels/${channelId}/messages?limit=${(chatMessagesEl.querySelectorAll(".chat-msg").length || 50) + 50}`);
    
    chatMessagesEl.innerHTML = '<div class="load-more-trigger" id="load-more-trigger"></div>';
    lastMessageDate = null;
    
    for (const msg of allMessages) {
      appendChatMessage(msg, false);
    }
    
    if (allMessages.length < 50) hasMoreHistory = false;
    else oldestMessageTime = allMessages[0].createdAt;

  } catch (err) {
    console.error(err);
  } finally {
    isLoadingHistory = false;
    if (trigger) trigger.classList.remove("loading");
  }
}

function shouldHighlightMessage(msg) {
  if (!currentUser) return false;
  if (msg.mentions && msg.mentions.includes("everyone")) return true;
  if (msg.mentions && msg.mentions.includes(currentUser.id)) return true;
  if (msg.replyTo && msg.replyTo.username === currentUser.username) return true;
  return false;
}

function appendChatMessage(msg, scrollToBottom = true) {
  const emptyMsg = chatMessagesEl.querySelector(".chat-empty");
  if (emptyMsg) emptyMsg.remove();

  const isMe = currentUser && msg.userId === currentUser.id;
  const msgDate = new Date(msg.createdAt);
  const time = msgDate.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  
  const dateKey = msgDate.toLocaleDateString("pt-BR");
  if (dateKey !== lastMessageDate) {
    lastMessageDate = dateKey;
    
    const today = new Date();
    const yesterday = new Date();
    yesterday.setDate(today.getDate() - 1);
    
    let dateText = msgDate.toLocaleDateString("pt-BR", { day: "numeric", month: "long", year: "numeric" });
    if (dateKey === today.toLocaleDateString("pt-BR")) dateText = "Hoje";
    else if (dateKey === yesterday.toLocaleDateString("pt-BR")) dateText = "Ontem";

    const sep = document.createElement("div");
    sep.className = "chat-date-separator";
    sep.innerHTML = `<span>${dateText}</span>`;
    chatMessagesEl.appendChild(sep);
  }

  const highlighted = shouldHighlightMessage(msg);

  const el = document.createElement("div");
  el.className = "chat-msg" + (highlighted ? " mentioned" : "");
  el.dataset.messageId = msg.id;
  
  let formattedText = "";
  if (msg.text) {
    let html = escapeHtml(msg.text);
    html = html.replace(/@everyone/gi, '<span class="chat-mention">@everyone</span>');
    if (cachedFriendsForMention) {
      cachedFriendsForMention.forEach(f => {
        const safeName = f.username.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
        const regex = new RegExp(`@${safeName}\\b`, 'gi');
        html = html.replace(regex, `<span class="chat-mention">@${f.username}</span>`);
      });
    }
    formattedText = html;
  }

  let fileHtml = "";
  if (msg.fileId) {
    const fileUrl = `/api/media/${encodeURIComponent(msg.fileId)}?token=${encodeURIComponent(token)}&download=1`;
    const fileName = escapeHtml(msg.fileName || "Arquivo");
    fileHtml = `<a href="${fileUrl}" target="_blank" class="chat-file-attachment" title="Baixar arquivo"><div class="chat-file-icon">📄</div><div class="chat-file-info"><span class="chat-file-name">${fileName}</span><span class="chat-file-size">Clique para baixar</span></div><div class="chat-file-download-icon">⬇️</div></a>`;
  }

  el.innerHTML = `
    <div class="chat-msg-actions">
      <button class="chat-msg-action-btn" data-action="reply" title="Responder">↩️</button>
      ${isMe ? '<button class="chat-msg-action-btn" data-action="edit" title="Editar">✏️</button>' : ""}
      <button class="chat-msg-action-btn" data-action="forward" title="Encaminhar">➡️</button>
      ${isMe ? '<button class="chat-msg-action-btn" data-action="delete" title="Excluir">🗑️</button>' : ""}
    </div>
    <div class="avatar" data-user-id="${msg.userId}" style="cursor:pointer;">${avatarHtml(msg.username, msg.avatarDataUrl)}</div>
    <div class="chat-msg-body">
      <div class="chat-msg-head">
        <span class="chat-msg-author${isMe ? " me" : ""}" data-user-id="${msg.userId}" style="cursor:pointer;">${escapeHtml(msg.username)}</span>
        <span class="chat-msg-time">${time}</span>
        ${msg.editedAt ? '<span class="chat-msg-edited-tag">(editado)</span>' : ""}
      </div>
      ${msg.replyTo ? `<div class="chat-msg-reply-quote">↪ ${escapeHtml(msg.replyTo.username)}: ${escapeHtml(msg.replyTo.text)}</div>` : ""}
      <div class="chat-msg-text-wrap">${msg.text ? `<div class="chat-msg-text">${formattedText}</div>` : ""}</div>
      ${msg.imageDataUrl ? `<img class="chat-msg-image" src="${msg.imageDataUrl}" alt="imagem" />` : ""}
      ${msg.audioDataUrl ? `<audio class="chat-msg-audio" controls src="${msg.audioDataUrl}"></audio>` : ""}
      ${msg.videoId ? `<video class="chat-msg-video" controls preload="metadata" src="/api/media/${encodeURIComponent(msg.videoId)}?token=${encodeURIComponent(token)}"></video>` : ""}
      ${fileHtml}
    </div>
  `;

  el.querySelector('[data-user-id]').addEventListener("click", async () => {
    if (msg.userId === currentUser?.id) { openUserCard(currentUser); return; }
    try {
      const friends = await api("/api/friends");
      const friend = friends.friends.find((f) => f.id === msg.userId);
      if (friend) openUserCard(friend);
      else openUserCard({ id: msg.userId, username: msg.username, avatarDataUrl: msg.avatarDataUrl });
    } catch { openUserCard({ id: msg.userId, username: msg.username, avatarDataUrl: msg.avatarDataUrl }); }
  });

  if (msg.imageDataUrl) el.querySelector(".chat-msg-image").addEventListener("click", () => openImage(msg));
  el.querySelector('[data-action="reply"]').addEventListener("click", () => setReplyState(msg));
  el.querySelector('[data-action="forward"]').addEventListener("click", () => openForwardModal(msg));
  const editBtn = el.querySelector('[data-action="edit"]');
  if (editBtn) editBtn.addEventListener("click", () => startEditingMessage(el, msg));
  const deleteBtn = el.querySelector('[data-action="delete"]');
  if (deleteBtn) deleteBtn.addEventListener("click", () => deleteMessage(msg.id));

  chatMessagesEl.appendChild(el);
  
  if (scrollToBottom) {
    chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
  }
}
// ---------- Enviar arquivo no chat ----------
const MAX_CHAT_FILE_BYTES = 15 * 1024 * 1024;
const chatVideoPreview = document.getElementById("chat-video-preview");
const chatVideoPreviewPlayer = document.getElementById("chat-video-preview-player");
const chatVideoPreviewRemove = document.getElementById("chat-video-preview-remove");
let pendingChatFile = null;
let pendingChatFileObjectUrl = null;
let sendingChatMessage = false;

function clearPendingChatFile() {
  if (pendingChatFileObjectUrl) URL.revokeObjectURL(pendingChatFileObjectUrl);
  pendingChatFileObjectUrl = null;
  pendingChatFile = null;
  chatVideoPreview.classList.add("hidden");
  chatVideoPreviewPlayer.removeAttribute("src");
  chatVideoPreviewPlayer.load();
}

async function setPendingChatFile(file) {
  if (!file) return;
  if (file.type.startsWith("image/")) {
    clearPendingChatFile();
    await setPendingChatImage(file);
    return;
  }
  if (file.size > MAX_CHAT_FILE_BYTES) {
    alert(`Esse arquivo tem ${(file.size / 1024 / 1024).toFixed(1)} MB. O limite é 15 MB.`);
    chatImageInput.value = "";
    return;
  }
  clearPendingChatImage();
  if (pendingChatFileObjectUrl) URL.revokeObjectURL(pendingChatFileObjectUrl);
  pendingChatFile = file;
  pendingChatFileObjectUrl = URL.createObjectURL(file);
  if (file.type.startsWith("video/")) {
    chatVideoPreviewPlayer.src = pendingChatFileObjectUrl;
  } else {
    chatVideoPreviewPlayer.src = "";
    chatVideoPreviewPlayer.title = file.name;
  }
  chatVideoPreview.classList.remove("hidden");
}

async function uploadChatFile(file, channelId) {
  const res = await fetch(`/api/channels/${channelId}/media`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": file.type || "application/octet-stream" },
    body: file,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Não foi possível enviar o arquivo.");
  return data.mediaId;
}

// ---------- DIGITANDO ----------
function updateTypingIndicator() {
  const el = document.getElementById("typing-indicator");
  if (!el) return;
  if (typingUsers.size === 0) {
    el.classList.add("hidden");
    el.innerHTML = "";
    return;
  }
  el.classList.remove("hidden");
  const names = Array.from(typingUsers.values());
  let text = "";
  if (names.length === 1) text = `${names[0]} está digitando`;
  else if (names.length === 2) text = `${names[0]} e ${names[1]} estão digitando`;
  else text = `${names.length} pessoas estão digitando`;
  el.innerHTML = `<span>${escapeHtml(text)}</span><span class="dots"><span></span><span></span><span></span></span>`;
}

chatInput.addEventListener("input", () => {
  const text = chatInput.value.trim();
  if (!ws || ws.readyState !== WebSocket.OPEN || !activeChannelId) return;
  
  if (text.length > 0) {
    if (!isTyping) {
      isTyping = true;
      ws.send(JSON.stringify({ type: "typing-start", channelId: activeChannelId }));
    }
    if (typingTimeout) clearTimeout(typingTimeout);
    typingTimeout = setTimeout(() => {
      isTyping = false;
      if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "typing-stop", channelId: activeChannelId }));
    }, 2000);
  } else {
    if (isTyping) {
      isTyping = false;
      if (typingTimeout) clearTimeout(typingTimeout);
      ws.send(JSON.stringify({ type: "typing-stop", channelId: activeChannelId }));
    }
  }
});

async function sendChatMessage() {
  const text = chatInput.value.trim();
  const channelId = activeChannelId;
  const hasMedia = pendingChatImageDataUrl || pendingChatAudioDataUrl || pendingChatFile;
  if ((!text && !hasMedia) || !ws || ws.readyState !== WebSocket.OPEN || !channelId || sendingChatMessage) return;

  const mentions = [];
  if (text.includes("@everyone")) mentions.push("everyone");
  if (cachedFriendsForMention) {
    cachedFriendsForMention.forEach(f => {
      if (text.includes(`@${f.username}`)) mentions.push(f.id);
    });
  }

  let mediaId;
  let isVideo = false;
  let fileName = null;

  if (pendingChatFile) {
    sendingChatMessage = true;
    chatSendBtn.disabled = true;
    chatSendBtn.textContent = "Enviando...";
    try {
      mediaId = await uploadChatFile(pendingChatFile, channelId);
      isVideo = pendingChatFile.type.startsWith("video/");
      fileName = pendingChatFile.name;
    } catch (err) {
      alert(err.message);
      sendingChatMessage = false;
      chatSendBtn.disabled = false;
      chatSendBtn.textContent = "Enviar";
      return;
    }
    sendingChatMessage = false;
    chatSendBtn.disabled = false;
    chatSendBtn.textContent = "Enviar";
  }

  if (activeChannelId !== channelId || !ws || ws.readyState !== WebSocket.OPEN) {
    alert("Você saiu do canal antes do arquivo terminar de enviar.");
    return;
  }

  ws.send(JSON.stringify({
    type: "chat-message", channelId, text,
    imageDataUrl: pendingChatImageDataUrl || undefined,
    audioDataUrl: pendingChatAudioDataUrl || undefined,
    videoId: isVideo ? mediaId : undefined,
    fileId: !isVideo ? mediaId : undefined,
    fileName: !isVideo ? fileName : undefined,
    replyToId: replyingToMessage?.id || undefined,
    mentions: mentions,
  }));

  chatInput.value = "";
  clearPendingChatImage();
  clearPendingChatFile();
  chatImageInput.value = "";
  pendingChatAudioDataUrl = null;
  chatAudioPreview.classList.add("hidden");
  chatAudioPreviewPlayer.src = "";
  clearReplyState();
}

chatSendBtn.addEventListener("click", sendChatMessage);
chatInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && mentionDropdown.classList.contains("hidden")) sendChatMessage();
});

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
chatImageInput.addEventListener("change", () => setPendingChatFile(chatImageInput.files[0]));
chatImagePreviewRemove.addEventListener("click", clearPendingChatImage);
chatVideoPreviewRemove.addEventListener("click", () => {
  clearPendingChatFile();
  chatImageInput.value = "";
});

chatRecordBtn.addEventListener("click", async () => {
  if (audioRecorder && audioRecorder.state === "recording") { audioRecorder.stop(); return; }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    audioRecorderChunks = [];
    audioRecorder = new MediaRecorder(stream);
    audioRecorder.ondataavailable = (e) => { if (e.data.size > 0) audioRecorderChunks.push(e.data); };
    audioRecorder.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      const blob = new Blob(audioRecorderChunks, { type: "audio/webm" });
      const reader = new FileReader();
      reader.onload = () => {
        pendingChatAudioDataUrl = reader.result;
        chatAudioPreviewPlayer.src = pendingChatAudioDataUrl;
        chatAudioPreview.classList.remove("hidden");
      };
      reader.readAsDataURL(blob);
      chatRecordBtn.classList.remove("recording");
      chatRecordBtn.title = "Gravar áudio";
    };
    audioRecorder.start();
    chatRecordBtn.classList.add("recording");
    chatRecordBtn.title = "Parar gravação";
  } catch (err) { console.error("Não foi possível acessar o microfone:", err); }
});

chatAudioPreviewRemove.addEventListener("click", () => {
  pendingChatAudioDataUrl = null;
  chatAudioPreview.classList.add("hidden");
  chatAudioPreviewPlayer.src = "";
});

chatInput.addEventListener("paste", (e) => {
  const items = e.clipboardData?.items || [];
  for (const item of items) {
    if (item.type.startsWith("image/") || item.type.startsWith("video/")) {
      setPendingChatFile(item.getAsFile());
      e.preventDefault();
      break;
    }
  }
});

// ---------- MARCACOES ----------
async function getMentionOptions(query) {
  if (!cachedFriendsForMention) {
    try { const data = await api("/api/friends"); cachedFriendsForMention = data.friends; } catch { cachedFriendsForMention = []; }
  }
  const options = [{ everyone: true, label: "everyone" }, ...cachedFriendsForMention.map((f) => ({ user: f }))];
  const q = (query || "").toLowerCase().trim();
  if (q === "") return options;
  return options.filter((o) => {
    if (o.everyone) return "everyone".includes(q);
    return (o.user.username || "").toLowerCase().includes(q);
  });
}

function getMentionQuery() {
  const cursor = chatInput.selectionStart;
  const textBefore = chatInput.value.slice(0, cursor);
  const match = textBefore.match(/(?:^|\s)@([^@]*)$/);
  return match ? match[1] : null;
}

async function updateMentionDropdown() {
  const query = getMentionQuery();
  if (query === null) { mentionDropdown.classList.add("hidden"); return; }
  const options = await getMentionOptions(query);
  if (options.length === 0) { mentionDropdown.classList.add("hidden"); return; }
  mentionActiveIndex = 0;
  mentionDropdown.innerHTML = "";
  options.forEach((opt, i) => {
    const item = document.createElement("div");
    item.className = "mention-item" + (i === 0 ? " active" : "");
    if (opt.everyone) item.innerHTML = `<div class="mention-everyone">@</div><span>everyone</span>`;
    else item.innerHTML = `<div class="avatar">${avatarHtml(opt.user.username, opt.user.avatarDataUrl)}</div><span>${escapeHtml(opt.user.username)}</span>`;
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
  const newBefore = textBefore.replace(/@[^@]*$/, `@${name} `);
  chatInput.value = newBefore + textAfter;
  mentionDropdown.classList.add("hidden");
  chatInput.focus();
  const newCursorPos = newBefore.length;
  chatInput.setSelectionRange(newCursorPos, newCursorPos);
}

chatInput.addEventListener("input", updateMentionDropdown);
chatInput.addEventListener("keydown", (e) => {
  if (mentionDropdown.classList.contains("hidden")) return;
  const items = [...mentionDropdown.children];
  if (items.length === 0) return;
  if (e.key === "ArrowDown") { e.preventDefault(); mentionActiveIndex = (mentionActiveIndex + 1) % items.length; items.forEach((el, i) => el.classList.toggle("active", i === mentionActiveIndex)); } 
  else if (e.key === "ArrowUp") { e.preventDefault(); mentionActiveIndex = (mentionActiveIndex - 1 + items.length) % items.length; items.forEach((el, i) => el.classList.toggle("active", i === mentionActiveIndex)); } 
  else if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); items[mentionActiveIndex]?.click(); } 
  else if (e.key === "Escape") { mentionDropdown.classList.add("hidden"); }
});

// ---------- WebSocket + WebRTC (Perfect Negotiation) ----------
let makingOffer = false;
let ignoreOffer = false;
let isSettingRemoteAnswerPending = false;

async function connectToChannel(channelId) {
  await loadIceServers();
  const wsProtocol = location.protocol === "https:" ? "wss" : "ws";
  ws = new WebSocket(`${wsProtocol}://${location.host}?token=${encodeURIComponent(token)}`);

  ws.onopen = () => { ws.send(JSON.stringify({ type: "enter-channel", channelId })); };

  ws.onmessage = async (event) => {
    const msg = JSON.parse(event.data);
    switch (msg.type) {
      case "entered": {
        selfPeerId = msg.selfId;
        knownPeers = new Map(msg.peers.map((p) => [p.id, { username: p.username, avatarDataUrl: p.avatarDataUrl }]));
        updateWaitingText(); renderParticipantsBar(); renderTopbarParticipants();
        for (const peerId of knownPeers.keys()) await ensureConnection(peerId, "out");
        if (activeChannelType === "voice") await ensureMicJoined();
        break;
      }
      case "peer-joined": {
        knownPeers.set(msg.id, { username: msg.username, avatarDataUrl: msg.avatarDataUrl });
        playJoinSound(); updateWaitingText(); renderParticipantsBar(); renderTopbarParticipants();
        await ensureConnection(msg.id, "out");
        break;
      }
      case "offer": {
        let pcIn = pcsIn.get(msg.from);
        if (!pcIn) {
          pcIn = createPeerConnection(msg.from, "in");
          pcsIn.set(msg.from, pcIn);
        }
        try {
          await pcIn.setRemoteDescription(msg.sdp);
          if (pcIn.pendingIceCandidates) {
            for (const c of pcIn.pendingIceCandidates) { try { await pcIn.addIceCandidate(c); } catch (e) {} }
            pcIn.pendingIceCandidates = [];
          }
          await flushPendingIceCandidates(msg.from, pcIn);
          const answer = await pcIn.createAnswer();
          await pcIn.setLocalDescription(answer);
          ws.send(JSON.stringify({ type: "answer", target: msg.from, sdp: answer }));
        } catch (err) {
          console.error("Erro ao processar offer:", err);
        }
        break;
      }
      case "answer": {
        const pcOut = pcsOut.get(msg.from);
        if (pcOut) {
          try {
            await pcOut.setRemoteDescription(msg.sdp);
            if (pcOut.pendingIceCandidates) {
              for (const c of pcOut.pendingIceCandidates) { try { await pcOut.addIceCandidate(c); } catch (e) {} }
              pcOut.pendingIceCandidates = [];
            }
            await flushPendingIceCandidates(msg.from, pcOut);
          } catch (err) {
            console.error("Erro ao processar answer:", err);
          }
        }
        break;
      }
      case "ice-candidate": {
        if (!msg.candidate) break;
        const pc = pcsOut.get(msg.from) || pcsIn.get(msg.from);
        if (pc) {
          if (pc.remoteDescription) {
            try { await pc.addIceCandidate(new RTCIceCandidate(msg.candidate)); } catch (err) {}
          } else {
            if (!pc.pendingIceCandidates) pc.pendingIceCandidates = [];
            pc.pendingIceCandidates.push(new RTCIceCandidate(msg.candidate));
          }
        }
        break;
      }
      case "peer-left": {
        const leftPeer = knownPeers.get(msg.id);
        knownPeers.delete(msg.id); 
        closePeerConnections(msg.id); 
        removeVideoTile(msg.id); 
        cleanupPeerAudio(msg.id); 
        playLeaveSound(); 
        updateWaitingText(); 
        renderParticipantsBar(); 
        renderTopbarParticipants();
        if (leftPeer && !userCardModal.classList.contains("hidden") && userCardName.textContent === leftPeer.username) closeUserCard();
        break;
      }
      case "typing-start": { typingUsers.set(msg.userId, msg.username); updateTypingIndicator(); break; }
      case "typing-stop": { typingUsers.delete(msg.userId); updateTypingIndicator(); break; }
      case "screen-share-ended": { removeVideoTile(msg.from); break; }
      case "chat-message": {
        if (msg.message.userId !== currentUser?.id) playMessageSound();
        appendChatMessage(msg.message);
        chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
        break;
      }
      case "message-edited": {
        const el = chatMessagesEl.querySelector(`[data-message-id="${msg.message.id}"]`);
        if (el) {
          const wrap = el.querySelector(".chat-msg-text-wrap");
          let formatted = escapeHtml(msg.message.text);
          if (cachedFriendsForMention) {
            cachedFriendsForMention.forEach(f => {
              const safeName = f.username.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
              formatted = formatted.replace(new RegExp(`@${safeName}`, 'gi'), `<span class="chat-mention">@${f.username}</span>`);
            });
          }
          formatted = formatted.replace(/@everyone/gi, '<span class="chat-mention">@everyone</span>');
          wrap.innerHTML = `<div class="chat-msg-text">${formatted}</div>`;
          if (!el.querySelector(".chat-msg-edited-tag")) el.querySelector(".chat-msg-time").insertAdjacentHTML("afterend", '<span class="chat-msg-edited-tag">(editado)</span>');
          el.classList.toggle("mentioned", shouldHighlightMessage(msg.message));
        }
        break;
      }
      case "message-deleted": {
        const el = chatMessagesEl.querySelector(`[data-message-id="${msg.messageId}"]`);
        if (el) el.remove();
        if (chatMessagesEl.children.length === 0) chatMessagesEl.innerHTML = '<p class="chat-empty">Nenhuma mensagem ainda. Diga oi!</p>';
        break;
      }
      case "user-updated": {
        if (msg.user.id === currentUser.id) { currentUser = msg.user; updateProfileBtn(); }
        if (cachedFriendsForMention) {
          const friendIdx = cachedFriendsForMention.findIndex((f) => f.id === msg.user.id);
          if (friendIdx !== -1) cachedFriendsForMention[friendIdx] = msg.user;
        }
        document.querySelectorAll(`.chat-msg .avatar[data-user-id="${msg.user.id}"]`).forEach((el) => { el.innerHTML = avatarHtml(msg.user.username, msg.user.avatarDataUrl); });
        document.querySelectorAll(`.chat-msg .chat-msg-author[data-user-id="${msg.user.id}"]`).forEach((el) => { el.textContent = msg.user.username; });
        renderParticipantsBar(); renderTopbarParticipants();
        if (!userCardModal.classList.contains("hidden") && userCardName.textContent === msg.user.username) openUserCard(msg.user);
        break;
      }
    }
  };
}

async function ensureConnection(peerId, direction) {
  let pc = direction === "out" ? pcsOut.get(peerId) : pcsIn.get(peerId);
  if (!pc) {
    pc = createPeerConnection(peerId, direction);
    if (direction === "out") pcsOut.set(peerId, pc);
    else pcsIn.set(peerId, pc);
  }
  if (direction === "out" && localMicStream) {
    const existingTrackIds = new Set(pc.getSenders().map((s) => s.track?.id).filter(Boolean));
    let addedAny = false;
    for (const track of localMicStream.getTracks()) {
      if (!existingTrackIds.has(track.id)) { pc.addTrack(track, localMicStream); addedAny = true; }
    }
    if (localScreenStream) {
      for (const track of localScreenStream.getTracks()) {
        if (!existingTrackIds.has(track.id)) { pc.addTrack(track, localScreenStream); addedAny = true; }
      }
    }
    if (addedAny) {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      ws.send(JSON.stringify({ type: "offer", target: peerId, sdp: offer }));
    }
  }
  return pc;
}

function createPeerConnection(peerId, direction) {
  const conn = new RTCPeerConnection(rtcConfig);
  conn.onicecandidate = (event) => { if (event.candidate && ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "ice-candidate", target: peerId, candidate: event.candidate })); };
  
  conn.onconnectionstatechange = () => {
    if (conn.connectionState === "connected") {
      statusText.textContent = "Transmitindo ao vivo";
    } else if (conn.connectionState === "failed" || conn.connectionState === "disconnected") {
      console.warn(`Conexão com ${peerId} falhou. Tentando reconectar...`);
      statusText.textContent = "Reconectando...";
      setTimeout(async () => {
        if (ws && ws.readyState === WebSocket.OPEN) {
          const room = { type: "ice-restart", target: peerId };
        }
      }, 2000);
    }
  };

  if (direction === "in") {
    conn.ontrack = (event) => {
      const stream = event.streams[0];
      if (event.track.kind === "video") showVideoTile(peerId, knownPeers.get(peerId)?.username || "Alguém", stream);
      else if (event.track.kind === "audio") { playRemoteAudio(peerId, stream); setupSpeakingDetector(stream, peerId); }
    };
  }
  return conn;
}

function updateWaitingText() {
  const count = knownPeers.size;
  if (count === 0) waitingText.textContent = "Você é a única pessoa aqui por enquanto...";
  else waitingText.textContent = `${count} pessoa${count > 1 ? "s" : ""} no canal. Clique em "Compartilhar minha tela" quando quiser.`;
}

function renderParticipantsBar() {
  participantsCircleRow.innerHTML = "";
  const meCircle = document.createElement("div");
  meCircle.className = "participant-circle";
  meCircle.dataset.key = "me";
  meCircle.innerHTML = `<div class="avatar-lg" data-user-id="me" style="cursor:pointer;">${avatarHtml(currentUser?.username, currentUser?.avatarDataUrl)}</div><div class="participant-name">Você</div>`;
  meCircle.querySelector('[data-user-id="me"]').addEventListener("click", () => openUserCard(currentUser));
  participantsCircleRow.appendChild(meCircle);

  for (const [peerId, peer] of knownPeers) {
    const circle = document.createElement("div");
    circle.className = "participant-circle";
    circle.dataset.key = peerId;
    circle.innerHTML = `<div class="avatar-lg" data-peer-id="${peerId}" style="cursor:pointer;">${avatarHtml(peer.username, peer.avatarDataUrl)}</div><div class="participant-name">${escapeHtml(peer.username)}</div>`;
    circle.querySelector('[data-peer-id]').addEventListener("click", async () => {
      try {
        const friends = await api("/api/friends");
        const friend = friends.friends.find((f) => f.username === peer.username);
        if (friend) openUserCard(friend);
        else openUserCard({ username: peer.username, avatarDataUrl: peer.avatarDataUrl });
      } catch { openUserCard({ username: peer.username, avatarDataUrl: peer.avatarDataUrl }); }
    });
    participantsCircleRow.appendChild(circle);
  }
  updateChannelSidebarPresence();
}

function renderTopbarParticipants() {
  const container = document.getElementById("topbar-participants");
  if (!container) return;
  container.innerHTML = "";

  const meAvatar = document.createElement("div");
  meAvatar.className = "avatar"; meAvatar.style.cursor = "pointer"; meAvatar.title = "Você";
  meAvatar.innerHTML = avatarHtml(currentUser?.username, currentUser?.avatarDataUrl);
  meAvatar.addEventListener("click", () => openUserCard(currentUser));
  container.appendChild(meAvatar);

  let count = 1;
  for (const [peerId, peer] of knownPeers) {
    const avatar = document.createElement("div");
    avatar.className = "avatar"; avatar.style.cursor = "pointer"; avatar.title = peer.username;
    avatar.innerHTML = avatarHtml(peer.username, peer.avatarDataUrl);
    avatar.addEventListener("click", async () => {
      try {
        const friends = await api("/api/friends");
        const friend = friends.friends.find((f) => f.username === peer.username);
        if (friend) openUserCard(friend);
        else openUserCard({ username: peer.username, avatarDataUrl: peer.avatarDataUrl });
      } catch { openUserCard({ username: peer.username, avatarDataUrl: peer.avatarDataUrl }); }
    });
    container.appendChild(avatar);
    count++;
  }

  const countText = document.createElement("span");
  countText.className = "participant-count";
  countText.textContent = `${count} online`;
  container.appendChild(countText);
}

function updateChannelSidebarPresence() {
  if (!activeChannelId) return;
  const holder = document.getElementById(`presence-${activeChannelId}`);
  if (!holder) return;
  holder.innerHTML = "";
  const meMini = document.createElement("div");
  meMini.className = "mini-avatar"; meMini.title = "Você"; meMini.innerHTML = avatarHtml(currentUser?.username, currentUser?.avatarDataUrl);
  holder.appendChild(meMini);
  for (const peer of knownPeers.values()) {
    const mini = document.createElement("div");
    mini.className = "mini-avatar"; mini.title = peer.username; mini.innerHTML = avatarHtml(peer.username, peer.avatarDataUrl);
    holder.appendChild(mini);
  }
}

async function flushPendingIceCandidates(peerId, pc) {
  const queued = pc.pendingIceCandidates;
  if (!queued) return;
  pc.pendingIceCandidates = [];
  for (const candidate of queued) { try { await pc.addIceCandidate(candidate); } catch (err) { console.error(err); } }
}

function playRemoteAudio(peerId, stream) {
  const audioId = `audio-${peerId}`;
  let audioEl = document.getElementById(audioId);
  
  if (!audioEl) {
    audioEl = document.createElement("audio");
    audioEl.id = audioId;
    audioEl.autoplay = true;
    audioEl.style.display = "none";
    document.body.appendChild(audioEl);
  }
  
  if (audioEl.srcObject !== stream) {
    audioEl.srcObject = stream;
  }
  
  audioEl.muted = deafened;
  
  audioEl.play().catch((err) => {
    console.warn("Autoplay de áudio bloqueado:", err);
    document.addEventListener("click", () => audioEl.play().catch(() => {}), { once: true });
  });
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
    tile = document.createElement("div"); tile.className = "video-tile"; tile.id = `tile-${peerId}`;
    tile.innerHTML = `<video autoplay playsinline muted></video><span class="video-tile-label">${escapeHtml(username)}</span>`;
    videoGrid.appendChild(tile);
  }
  const videoEl = tile.querySelector("video");
  videoEl.srcObject = stream; videoEl.muted = deafened;
  videoEl.play().catch(() => {});
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
  const pOut = pcsOut.get(peerId); if (pOut) { pOut.close(); pcsOut.delete(peerId); }
  const pIn = pcsIn.get(peerId); if (pIn) { pIn.close(); pcsIn.delete(peerId); }
}

function setupSpeakingDetector(stream, key) {
  if (!audioContext) audioContext = new (window.AudioContext || window.webkitAudioContext)();
  try {
    const source = audioContext.createMediaStreamSource(stream);
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 512; analyser.smoothingTimeConstant = 0.6; source.connect(analyser);
    audioAnalysers.set(key, analyser);
    if (!speakingLoopRunning) { speakingLoopRunning = true; requestAnimationFrame(speakingLoop); }
  } catch (err) { console.error("Não foi possível analisar o áudio:", err); }
}

function removeSpeakingDetector(key) { audioAnalysers.delete(key); }

function speakingLoop() {
  const data = new Uint8Array(256);
  for (const [key, analyser] of audioAnalysers) {
    analyser.getByteFrequencyData(data);
    let sum = 0; for (const v of data) sum += v;
    const isSpeaking = sum / data.length > 12;
    const circle = document.querySelector(`.participant-circle[data-key="${key}"] .avatar-lg`);
    if (circle) circle.classList.toggle("speaking", isSpeaking);
    const tile = document.getElementById(`tile-${key}`);
    if (tile) tile.classList.toggle("speaking", isSpeaking);
  }
  requestAnimationFrame(speakingLoop);
}

let noiseSuppressionProcessor = null;
async function ensureMicJoined() {
  if (localMicStream) return;
  try {
    const rawStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, sampleRate: { ideal: 48000 }, sampleSize: { ideal: 480 }, channelCount: { exact: 1 } } });
    if (window.Shiguredo) {
      try {
        const assetsPath = "https://cdn.jsdelivr.net/npm/@shiguredo/noise-suppression@latest/dist";
        noiseSuppressionProcessor = new Shiguredo.NoiseSuppressionProcessor(assetsPath);
        const rawTrack = rawStream.getAudioTracks()[0];
        const processedTrack = await noiseSuppressionProcessor.startProcessing(rawTrack);
        localMicStream = new MediaStream([processedTrack]);
      } catch (err) { console.error("Redução de ruído indisponível:", err); localMicStream = rawStream; }
    } else localMicStream = rawStream;
    setupSpeakingDetector(localMicStream, "me");
    for (const peerId of knownPeers.keys()) await ensureConnection(peerId, "out");
  } catch (err) { console.error("Não foi possível acessar o microfone:", err); }
}

micBtn.addEventListener("click", async () => {
  if (!localMicStream) { await ensureMicJoined(); micMuted = false; } 
  else { micMuted = !micMuted; for (const track of localMicStream.getTracks()) track.enabled = !micMuted; }
  micBtn.textContent = micMuted ? "🔇" : "🎤"; micBtn.classList.toggle("off", micMuted);
});

shareBtn.addEventListener("click", async () => {
  try {
    localScreenStream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 30, max: 60 }, width: { max: 1280 }, height: { max: 720 }, cursor: "always", displaySurface: "monitor" }, audio: true });
    const videoTrack = localScreenStream.getVideoTracks()[0];
    if (videoTrack && 'contentHint' in videoTrack) videoTrack.contentHint = 'motion';
    for (const peerId of knownPeers.keys()) {
      await ensureConnection(peerId, "out");
      const pc = pcsOut.get(peerId);
      if (pc) {
        const sender = pc.getSenders().find(s => s.track === videoTrack);
        if (sender) {
          const params = sender.getParameters();
          if (!params.encodings) params.encodings = [{}];
          params.encodings[0].maxBitrate = 2500000;
          await sender.setParameters(params);
        }
      }
    }
    shareBtn.classList.add("hidden"); stopShareBtn.classList.remove("hidden");
    statusText.textContent = "Transmitindo sua tela";
    videoTrack.onended = () => stopSharing();
  } catch (err) { console.error("Erro ao compartilhar tela:", err); }
});

stopShareBtn.addEventListener("click", stopSharing);
function stopSharing() {
  if (localScreenStream) {
    for (const track of localScreenStream.getTracks()) {
      track.stop();
      for (const pc of pcsOut.values()) { const sender = pc.getSenders().find((s) => s.track === track); if (sender) pc.removeTrack(sender); }
    }
  }
  localScreenStream = null; statusText.textContent = "Compartilhamento parado";
  stopShareBtn.classList.add("hidden"); shareBtn.classList.remove("hidden");
  if (ws) ws.send(JSON.stringify({ type: "screen-share-ended" }));
}

leaveChannelBtn.addEventListener("click", () => {
  leaveCall(); activeChannelId = null; renderChannelList();
  emptyState.classList.remove("hidden"); callView.classList.add("hidden");
});

function leaveCall() {
  if (localScreenStream) for (const track of localScreenStream.getTracks()) track.stop();
  if (localMicStream) for (const track of localMicStream.getTracks()) track.stop();
  if (noiseSuppressionProcessor) { noiseSuppressionProcessor.stopProcessing(); noiseSuppressionProcessor = null; }
  for (const pc of pcsOut.values()) pc.close();
  for (const pc of pcsIn.values()) pc.close();
  document.querySelectorAll('audio[id^="audio-"]').forEach((el) => el.remove());
  audioAnalysers.clear(); pcsOut.clear(); pcsIn.clear(); knownPeers.clear();
  if (ws) ws.close();
  ws = null; localScreenStream = null; localMicStream = null;
  micMuted = false; micBtn.textContent = "🎤"; micBtn.classList.remove("off"); selfPeerId = null;
}

async function openDirectMessage(friendUser) {
  try {
    const data = await api(`/api/friends/${friendUser.id}/dm`, { method: "POST" });
    leaveCall(); activeServerId = null; activeChannelId = data.channelId; activeChannelType = "dm";
    friendsPanel.style.display = "none"; document.querySelector(".channel-panel").style.display = "none";
    document.querySelector(".main-panel").style.display = "flex";
    emptyState.classList.add("hidden"); callView.classList.remove("hidden");
    activeChannelName.textContent = friendUser.username;
    waitingState.classList.remove("hidden"); videoGrid.innerHTML = "";
    shareBtn.classList.remove("hidden"); stopShareBtn.classList.add("hidden");
    statusText.textContent = "Conectado";
    const callColumn = document.querySelector(".call-column"); const chatColumn = document.querySelector(".chat-column");
    callColumn.style.display = "flex"; chatColumn.style.display = "flex"; chatColumn.style.width = "";
    loadMessageHistory(activeChannelId); connectToChannel(activeChannelId); renderParticipantsBar(); renderTopbarParticipants();
  } catch (err) { alert(err.message); }
}

addServerBtn.addEventListener("click", () => {
  serverModal.classList.remove("hidden"); serverModalStatus.textContent = "";
  newServerName.value = ""; joinServerCode.value = ""; setServerTab("create");
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
    if (serverModal.dataset.mode === "join") server = await api("/api/servers/join", { method: "POST", body: JSON.stringify({ inviteCode: joinServerCode.value.trim() }) });
    else server = await api("/api/servers", { method: "POST", body: JSON.stringify({ name: newServerName.value.trim() }) });
    await loadServers(); serverModal.classList.add("hidden"); selectServer(server.id);
  } catch (err) { serverModalStatus.textContent = err.message; }
});

addChannelBtn.addEventListener("click", () => {
  channelModal.classList.remove("hidden"); channelModalStatus.textContent = ""; newChannelName.value = "";
  selectedChannelType = "text"; typeTextBtn.classList.add("active"); typeVoiceBtn.classList.remove("active");
  const server = myServers.find((s) => s.id === activeServerId);
  newChannelCategory.innerHTML = '<option value="">Sem categoria</option>';
  for (const cat of server?.categories || []) { const opt = document.createElement("option"); opt.value = cat.id; opt.textContent = cat.name; newChannelCategory.appendChild(opt); }
});

typeTextBtn.addEventListener("click", () => { selectedChannelType = "text"; typeTextBtn.classList.add("active"); typeVoiceBtn.classList.remove("active"); });
typeVoiceBtn.addEventListener("click", () => { selectedChannelType = "voice"; typeVoiceBtn.classList.add("active"); typeTextBtn.classList.remove("active"); });
channelModalCancel.addEventListener("click", () => channelModal.classList.add("hidden"));

channelModalConfirm.addEventListener("click", async () => {
  channelModalStatus.textContent = "";
  try {
    await api(`/api/servers/${activeServerId}/channels`, { method: "POST", body: JSON.stringify({ name: newChannelName.value.trim(), categoryId: newChannelCategory.value || null, type: selectedChannelType }) });
    await loadServers(); renderChannelList(); channelModal.classList.add("hidden");
  } catch (err) { channelModalStatus.textContent = err.message; }
});

const profileUsernameInput = document.getElementById("profile-username-input");
profileBtn.addEventListener("click", () => {
  pendingAvatarDataUrl = null; pendingBannerDataUrl = null; profileModalStatus.textContent = "";
  profileAvatarPreview.innerHTML = avatarHtml(currentUser?.username, currentUser?.avatarDataUrl);
  if (currentUser?.bannerDataUrl) { profileBannerPreview.style.backgroundImage = `url(${currentUser.bannerDataUrl})`; profileBannerPreview.innerHTML = ""; } 
  else { profileBannerPreview.style.backgroundImage = ""; profileBannerPreview.innerHTML = '<span style="color: var(--muted); font-size: 0.85rem;">Sem banner</span>'; }
  profileUsernameInput.value = currentUser?.username || "";
  profilePronounsInput.value = currentUser?.pronouns || "";
  profileBioInput.value = currentUser?.bio || "";
  profileModal.classList.remove("hidden");
});

profileAvatarChooseBtn.addEventListener("click", () => profileAvatarInput.click());
profileBannerChooseBtn.addEventListener("click", () => profileBannerInput.click());
profileAvatarInput.addEventListener("change", async () => { const file = profileAvatarInput.files[0]; if (!file) return; pendingAvatarDataUrl = await resizeImageFile(file); profileAvatarPreview.innerHTML = `<img src="${pendingAvatarDataUrl}" alt="" />`; });
profileBannerInput.addEventListener("change", async () => { const file = profileBannerInput.files[0]; if (!file) return; pendingBannerDataUrl = await resizeImageKeepAspect(file, 640); profileBannerPreview.style.backgroundImage = `url(${pendingBannerDataUrl})`; profileBannerPreview.innerHTML = ""; });
profileModalCancel.addEventListener("click", () => profileModal.classList.add("hidden"));

profileLogoutBtn.addEventListener("click", () => {
  leaveCall(); token = null; currentUser = null; myServers = []; activeServerId = null; activeChannelId = null;
  localStorage.removeItem("telalive-token"); profileModal.classList.add("hidden");
  appScreen.style.display = "none"; authScreen.classList.remove("hidden");
  authUsername.value = ""; authPassword.value = "";
});

profileModalConfirm.addEventListener("click", async () => {
  const newUsername = profileUsernameInput.value.trim();
  const newPronouns = profilePronounsInput.value.trim();
  const newBio = profileBioInput.value.trim();
  const body = {};
  if (pendingAvatarDataUrl) body.avatarDataUrl = pendingAvatarDataUrl;
  if (pendingBannerDataUrl) body.bannerDataUrl = pendingBannerDataUrl;
  if (newUsername && newUsername !== currentUser?.username) body.username = newUsername;
  if (newPronouns !== (currentUser?.pronouns || "")) body.pronouns = newPronouns;
  if (newBio !== (currentUser?.bio || "")) body.bio = newBio;
  if (Object.keys(body).length === 0) { profileModal.classList.add("hidden"); return; }
  profileModalStatus.textContent = "";
  try { currentUser = await api("/api/me", { method: "PATCH", body: JSON.stringify(body) }); updateProfileBtn(); profileModal.classList.add("hidden"); } 
  catch (err) { profileModalStatus.textContent = err.message; }
});

editServerIconBtn.addEventListener("click", () => {
  pendingServerIconDataUrl = null; serverIconModalStatus.textContent = "";
  const server = myServers.find((s) => s.id === activeServerId);
  serverIconPreview.innerHTML = server?.iconDataUrl ? `<img src="${server.iconDataUrl}" alt="" />` : escapeHtml((server?.name || "?").slice(0, 2).toUpperCase());
  serverIconModal.classList.remove("hidden");
});
serverIconChooseBtn.addEventListener("click", () => serverIconInput.click());
serverIconInput.addEventListener("change", async () => { const file = serverIconInput.files[0]; if (!file) return; pendingServerIconDataUrl = await resizeImageFile(file); serverIconPreview.innerHTML = `<img src="${pendingServerIconDataUrl}" alt="" />`; });
serverIconModalCancel.addEventListener("click", () => serverIconModal.classList.add("hidden"));

serverIconModalConfirm.addEventListener("click", async () => {
  if (!pendingServerIconDataUrl) { serverIconModal.classList.add("hidden"); return; }
  serverIconModalStatus.textContent = "";
  try { await api(`/api/servers/${activeServerId}`, { method: "PATCH", body: JSON.stringify({ iconDataUrl: pendingServerIconDataUrl }) }); await loadServers(); serverIconModal.classList.add("hidden"); } 
  catch (err) { serverIconModalStatus.textContent = err.message; }
});

friendsBtn.addEventListener("click", () => {
  activeServerId = null; activeChannelId = null; leaveCall(); renderServerRail();
  document.querySelector(".channel-panel").style.display = "none";
  document.querySelector(".main-panel").style.display = "none";
  friendsPanel.style.display = "flex"; loadFriends();
});

async function loadFriends() {
  try { const data = await api("/api/friends"); cachedFriendsForMention = data.friends; renderFriends(data); } catch (err) { console.error(err); }
}

function renderFriendRow({ user, requestId, kind }) {
  const row = document.createElement("div");
  row.className = "friend-row";
  const actionsHtml = kind === "incoming" ? `<button class="friend-action-btn accept" data-id="${requestId}">Aceitar</button><button class="friend-action-btn decline" data-id="${requestId}">Recusar</button>` : kind === "outgoing" ? `<button class="friend-action-btn decline" data-id="${requestId}">Cancelar</button>` : `<button class="friend-action-btn accept" id="dm-btn">Conversar</button>`;
  row.innerHTML = `<div class="avatar" style="cursor:pointer;">${avatarHtml(user.username, user.avatarDataUrl)}</div><div class="friend-name">${escapeHtml(user.username)}</div><div class="friend-actions">${actionsHtml}</div>`;
  row.querySelector(".avatar").addEventListener("click", () => openUserCard(user));
  if (kind === "incoming") { row.querySelector(".accept").addEventListener("click", () => respondFriendRequest(requestId, "accept")); row.querySelector(".decline").addEventListener("click", () => respondFriendRequest(requestId, "decline")); } 
  else if (kind === "outgoing") row.querySelector(".decline").addEventListener("click", () => respondFriendRequest(requestId, "decline"));
  else if (kind === "friend") row.querySelector("#dm-btn").addEventListener("click", () => openDirectMessage(user));
  return row;
}

function renderFriends(data) {
  incomingList.innerHTML = "";
  if (data.incoming.length === 0) incomingList.innerHTML = '<p class="friends-empty">Nenhum pedido recebido.</p>';
  else for (const r of data.incoming) incomingList.appendChild(renderFriendRow({ ...r, kind: "incoming" }));
  outgoingList.innerHTML = "";
  if (data.outgoing.length === 0) outgoingList.innerHTML = '<p class="friends-empty">Nenhum pedido enviado.</p>';
  else for (const r of data.outgoing) outgoingList.appendChild(renderFriendRow({ ...r, kind: "outgoing" }));
  friendsList.innerHTML = "";
  if (data.friends.length === 0) friendsList.innerHTML = '<p class="friends-empty">Você ainda não tem amigos adicionados.</p>';
  else for (const user of data.friends) friendsList.appendChild(renderFriendRow({ user, kind: "friend" }));
}

addFriendBtn.addEventListener("click", async () => {
  const username = addFriendInput.value.trim();
  if (!username) return;
  addFriendStatus.textContent = "";
  try {
    const result = await api("/api/friends/request", { method: "POST", body: JSON.stringify({ username }) });
    addFriendInput.value = ""; addFriendStatus.textContent = result.autoAccepted ? "Vocês agora são amigos!" : "Pedido enviado!"; addFriendStatus.style.color = "var(--success)"; loadFriends();
  } catch (err) { addFriendStatus.style.color = "var(--danger)"; addFriendStatus.textContent = err.message; }
});

addFriendInput.addEventListener("keydown", (e) => { if (e.key === "Enter") addFriendBtn.click(); });
async function respondFriendRequest(requestId, action) { try { await api(`/api/friends/${requestId}/${action}`, { method: "POST" }); loadFriends(); } catch (err) { console.error(err); } }

function openServerContextMenu(serverId, x, y) {
  contextMenuServerId = serverId; ctxToggleMutedSwitch.classList.toggle("on", hideMutedChannels);
  serverContextMenu.style.left = `${x}px`; serverContextMenu.style.top = `${y}px`; serverContextMenu.classList.remove("hidden");
}
function closeServerContextMenu() { serverContextMenu.classList.add("hidden"); contextMenuServerId = null; }
document.addEventListener("click", (e) => { if (!serverContextMenu.contains(e.target)) closeServerContextMenu(); if (!itemContextMenu.contains(e.target)) itemContextMenu.classList.add("hidden"); });
function openItemContextMenu(type, id, x, y) {
  itemContextTarget = { type, id };
  itemCtxCreateChannel.style.display = type === "category" ? "flex" : "none";
  itemCtxDelete.querySelector("span").textContent = type === "category" ? "Excluir categoria" : "Excluir canal";
  itemContextMenu.style.left = `${x}px`; itemContextMenu.style.top = `${y}px`; itemContextMenu.classList.remove("hidden");
}
itemCtxCreateChannel.addEventListener("click", () => { itemContextMenu.classList.add("hidden"); addChannelBtn.click(); if (itemContextTarget?.type === "category") newChannelCategory.value = itemContextTarget.id; });
itemCtxDelete.addEventListener("click", async () => {
  itemContextMenu.classList.add("hidden");
  if (!itemContextTarget) return;
  try {
    if (itemContextTarget.type === "channel") {
      await api(`/api/channels/${itemContextTarget.id}`, { method: "DELETE" });
      if (activeChannelId === itemContextTarget.id) { activeChannelId = null; leaveCall(); emptyState.classList.remove("hidden"); callView.classList.add("hidden"); }
    } else await api(`/api/servers/${activeServerId}/categories/${itemContextTarget.id}`, { method: "DELETE" });
    await loadServers(); renderChannelList();
  } catch (err) { alert(err.message); }
});

ctxCreateChannel.addEventListener("click", () => { if (contextMenuServerId !== activeServerId) selectServer(contextMenuServerId); closeServerContextMenu(); addChannelBtn.click(); });
ctxCreateCategory.addEventListener("click", () => {
  if (contextMenuServerId !== activeServerId) selectServer(contextMenuServerId);
  closeServerContextMenu(); newCategoryName.value = ""; newCategoryPrivate.checked = false;
  categoryMembersField.classList.add("hidden"); categoryModalStatus.textContent = ""; categoryModal.classList.remove("hidden");
});

newCategoryPrivate.addEventListener("change", async () => {
  if (!newCategoryPrivate.checked) { categoryMembersField.classList.add("hidden"); return; }
  categoryMembersField.classList.remove("hidden"); categoryMembersList.innerHTML = "Carregando...";
  try {
    const members = await api(`/api/servers/${activeServerId}/members`);
    categoryMembersList.innerHTML = "";
    for (const member of members) {
      if (member.id === currentUser.id) continue;
      const row = document.createElement("label"); row.className = "member-check-row";
      row.innerHTML = `<input type="checkbox" value="${member.id}" /><div class="avatar">${avatarHtml(member.username, member.avatarDataUrl)}</div><span>${escapeHtml(member.username)}</span>`;
      categoryMembersList.appendChild(row);
    }
    if (categoryMembersList.children.length === 0) categoryMembersList.innerHTML = '<p class="friends-empty">Ninguém mais nesse servidor ainda.</p>';
  } catch (err) { categoryMembersList.innerHTML = ""; }
});

ctxInvite.addEventListener("click", () => {
  const server = myServers.find((s) => s.id === contextMenuServerId);
  if (server) { navigator.clipboard.writeText(server.inviteCode); ctxInvite.querySelector("span").textContent = "Código copiado!"; setTimeout(() => (ctxInvite.querySelector("span").textContent = "Convidar para o servidor"), 1200); }
});

ctxToggleMuted.addEventListener("click", () => {
  hideMutedChannels = !hideMutedChannels; localStorage.setItem("telalive-hide-muted", hideMutedChannels ? "1" : "0");
  ctxToggleMutedSwitch.classList.toggle("on", hideMutedChannels); renderChannelList();
});

categoryModalCancel.addEventListener("click", () => categoryModal.classList.add("hidden"));

categoryModalConfirm.addEventListener("click", async () => {
  categoryModalStatus.textContent = "";
  const allowedUserIds = newCategoryPrivate.checked ? [...categoryMembersList.querySelectorAll("input:checked")].map((el) => el.value) : [];
  try {
    await api(`/api/servers/${activeServerId}/categories`, { method: "POST", body: JSON.stringify({ name: newCategoryName.value.trim(), private: newCategoryPrivate.checked, allowedUserIds }) });
    await loadServers(); renderChannelList(); categoryModal.classList.add("hidden");
  } catch (err) { categoryModalStatus.textContent = err.message; }
});

function setReplyState(msg) {
  replyingToMessage = { id: msg.id, username: msg.username, text: (msg.text || (msg.imageDataUrl ? "📷 imagem" : msg.fileName ? `📄 ${msg.fileName}` : msg.videoId ? "🎬 vídeo" : msg.audioDataUrl ? "🎤 áudio" : "")).slice(0, 80) };
  replyBannerText.textContent = `Respondendo a ${msg.username}: ${replyingToMessage.text}`;
  replyBanner.classList.remove("hidden"); chatInput.focus();
}
function clearReplyState() { replyingToMessage = null; replyBanner.classList.add("hidden"); }
replyBannerCancel.addEventListener("click", clearReplyState);

function startEditingMessage(el, msg) {
  const wrap = el.querySelector(".chat-msg-text-wrap"); const original = wrap.innerHTML;
  wrap.innerHTML = `<input class="chat-msg-edit-input" value="${msg.text.replace(/"/g, "&quot;")}" />`;
  const input = wrap.querySelector("input"); input.focus(); input.setSelectionRange(input.value.length, input.value.length);
  async function save() {
    const newText = input.value.trim(); if (!newText) return;
    try { await api(`/api/messages/${msg.id}`, { method: "PATCH", body: JSON.stringify({ text: newText }) }); } catch (err) { alert(err.message); wrap.innerHTML = original; }
  }
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") save(); if (e.key === "Escape") wrap.innerHTML = original; });
  input.addEventListener("blur", save);
}

async function deleteMessage(messageId) {
  if (!confirm("Excluir essa mensagem?")) return;
  try { await api(`/api/messages/${messageId}`, { method: "DELETE" }); } catch (err) { alert(err.message); }
}

async function openForwardModal(msg) {
  forwardingMessage = msg; forwardModalStatus.textContent = ""; forwardTargetsList.innerHTML = "Carregando..."; forwardModal.classList.remove("hidden");
  const targets = [];
  for (const server of myServers) for (const channel of server.channels) targets.push({ label: `${server.name} / #${channel.name}`, channelId: channel.id });
  try { const data = await api("/api/friends"); for (const friend of data.friends) targets.push({ label: `DM: ${friend.username}`, friend }); } catch {}
  forwardTargetsList.innerHTML = "";
  if (targets.length === 0) { forwardTargetsList.innerHTML = '<p class="friends-empty">Nenhum destino disponível.</p>'; return; }
  for (const target of targets) { const item = document.createElement("div"); item.className = "forward-target-item"; item.textContent = target.label; item.addEventListener("click", () => forwardMessageTo(target)); forwardTargetsList.appendChild(item); }
}

async function forwardMessageTo(target) {
  forwardModalStatus.textContent = "Encaminhando...";
  try {
    let channelId = target.channelId;
    if (!channelId && target.friend) { const dm = await api(`/api/friends/${target.friend.id}/dm`, { method: "POST" }); channelId = dm.channelId; }
    await api(`/api/channels/${channelId}/forward`, { method: "POST", body: JSON.stringify({ text: forwardingMessage.text, imageDataUrl: forwardingMessage.imageDataUrl, audioDataUrl: forwardingMessage.audioDataUrl, videoId: forwardingMessage.videoId, fileId: forwardingMessage.fileId, fileName: forwardingMessage.fileName }) });
    forwardModalStatus.textContent = "Mensagem encaminhada!"; forwardModalStatus.style.color = "var(--success)";
    setTimeout(() => forwardModal.classList.add("hidden"), 900);
  } catch (err) { forwardModalStatus.style.color = "var(--danger)"; forwardModalStatus.textContent = err.message; }
}
forwardModalCancel.addEventListener("click", () => forwardModal.classList.add("hidden"));

// === VISUALIZADOR DE IMAGEM ESTILO DISCORD ===
const imageViewer = document.getElementById("image-viewer");
const imageViewerImg = document.getElementById("image-viewer-img");
const imageViewerInfo = document.getElementById("image-viewer-info");
let currentImageZoom = 1;
let currentImagePos = { x: 0, y: 0 };
let isDraggingImage = false;
let dragStart = { x: 0, y: 0 };
let currentImageMsg = null;

function openImage(msg) {
  currentImageMsg = msg;
  currentImageZoom = 1;
  currentImagePos = { x: 0, y: 0 };
  imageViewerImg.style.transform = `scale(1) translate(0px, 0px)`;
  imageViewerImg.src = msg.imageDataUrl;
  
  imageViewerInfo.innerHTML = `
    <div class="avatar">${avatarHtml(msg.username, msg.avatarDataUrl)}</div>
    <span>${escapeHtml(msg.username)}</span>
  `;
  
  imageViewer.classList.add("open");
}

function closeImage() {
  imageViewer.classList.remove("open");
  imageViewerImg.removeAttribute("src");
  currentImageMsg = null;
}

document.getElementById("img-close").addEventListener("click", closeImage);
imageViewer.addEventListener("click", (e) => {
  if (e.target === imageViewer || e.target.classList.contains("image-viewer-content")) closeImage();
});

document.getElementById("img-zoom-in").addEventListener("click", () => {
  currentImageZoom = Math.min(currentImageZoom + 0.2, 3);
  imageViewerImg.style.transform = `scale(${currentImageZoom}) translate(${currentImagePos.x}px, ${currentImagePos.y}px)`;
});
document.getElementById("img-zoom-out").addEventListener("click", () => {
  currentImageZoom = Math.max(currentImageZoom - 0.2, 0.5);
  imageViewerImg.style.transform = `scale(${currentImageZoom}) translate(${currentImagePos.x}px, ${currentImagePos.y}px)`;
});

document.getElementById("img-forward").addEventListener("click", () => {
  if (currentImageMsg) openForwardModal(currentImageMsg);
});

imageViewerImg.addEventListener("mousedown", (e) => {
  if (currentImageZoom <= 1) return;
  isDraggingImage = true;
  dragStart = { x: e.clientX - currentImagePos.x, y: e.clientY - currentImagePos.y };
  imageViewerImg.style.cursor = "grabbing";
});

document.addEventListener("mousemove", (e) => {
  if (!isDraggingImage) return;
  currentImagePos = { x: e.clientX - dragStart.x, y: e.clientY - dragStart.y };
  imageViewerImg.style.transform = `scale(${currentImageZoom}) translate(${currentImagePos.x}px, ${currentImagePos.y}px)`;
});

document.addEventListener("mouseup", () => {
  isDraggingImage = false;
  imageViewerImg.style.cursor = "grab";
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && imageViewer.classList.contains("open")) closeImage();
});

// Google Login
updateAuthUI();
tryResumeSession();

const GOOGLE_CLIENT_ID = "174563350206-669sgb3rc9fmombqjeearvf8rao54n8u.apps.googleusercontent.com";

async function handleGoogleCredential(response) {
  authStatus.textContent = "";
  try {
    const data = await api("/api/auth/google", { method: "POST", body: JSON.stringify({ idToken: response.credential }) });
    token = data.token; currentUser = data.user; localStorage.setItem("telalive-token", token); enterApp();
  } catch (err) { authStatus.textContent = err.message; }
}

function initGoogleButton() {
  if (!window.google || !window.google.accounts) { setTimeout(initGoogleButton, 300); return; }
  google.accounts.id.initialize({ client_id: GOOGLE_CLIENT_ID, callback: handleGoogleCredential });
  google.accounts.id.renderButton(document.getElementById("google-signin-btn"), { theme: "filled_black", size: "large", shape: "pill", text: "continue_with" });
}
initGoogleButton();
