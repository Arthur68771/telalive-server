const express = require("express");
const http = require("http");
const { WebSocketServer } = require("ws");
const path = require("path");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const { OAuth2Client } = require("google-auth-library");
const {
  loadDB, saveDB, insertMessage, getMessage, getChannelMessages,
  updateMessage, deleteMessageById, deleteChannelMessages, insertMedia,
  getMediaMeta, getMediaData, addMediaChannel, deleteMediaIfUnused,
} = require("./db");

const GOOGLE_CLIENT_ID = "174563350206-669sgb3rc9fmombqjeearvf8rao54n8u.apps.googleusercontent.com";
const googleClient = new OAuth2Client(GOOGLE_CLIENT_ID);

const HF_TOKEN = process.env.HF_TOKEN || "";

async function startServer(port = 3000) {
  const db = await loadDB();
  db.users = db.users || [];
  db.servers = db.servers || [];
  db.channels = db.channels || [];
  db.friendRequests = db.friendRequests || [];
  db.categories = db.categories || [];
  db.dmChannels = db.dmChannels || [];

  function persist() {
    saveDB(db).catch((err) => console.error("Erro ao salvar no banco:", err.message));
  }

  const sessions = new Map();
  const app = express();
  app.use(express.json({ limit: "15mb" }));
  app.use(express.static(path.join(__dirname, "public")));

  function requireAuth(req, res, next) {
    const header = req.headers.authorization || "";
    const token = header.replace("Bearer ", "");
    const userId = sessions.get(token);
    if (!userId) return res.status(401).json({ error: "Não autenticado." });
    req.userId = userId;
    next();
  }

  function publicUser(user) {
    return {
      id: user.id, username: user.username,
      avatarDataUrl: user.avatarDataUrl || user.googlePicture || null,
      bannerDataUrl: user.bannerDataUrl || null,
      bio: user.bio || "", pronouns: user.pronouns || "",
    };
  }

  function uniqueUsernameFrom(base) {
    let candidate = base.trim().slice(0, 24) || "usuario";
    let suffix = 0;
    while (db.users.some((u) => u.username.toLowerCase() === candidate.toLowerCase())) {
      suffix += 1;
      candidate = `${base.slice(0, 20)}${suffix}`;
    }
    return candidate;
  }

  app.post("/api/register", async (req, res) => {
    const { username, password } = req.body || {};
    if (!username || username.trim().length < 3) return res.status(400).json({ error: "Nome precisa ter pelo menos 3 letras." });
    if (!password || password.length < 4) return res.status(400).json({ error: "Senha precisa ter pelo menos 4 caracteres." });
    const clean = username.trim();
    if (db.users.some((u) => u.username.toLowerCase() === clean.toLowerCase())) return res.status(400).json({ error: "Esse nome já existe." });
    
    const user = { id: crypto.randomUUID(), username: clean, passwordHash: await bcrypt.hash(password, 10) };
    db.users.push(user);
    persist();
    const token = crypto.randomBytes(24).toString("hex");
    sessions.set(token, user.id);
    res.json({ token, user: publicUser(user) });
  });

  app.post("/api/login", async (req, res) => {
    const { username, password } = req.body || {};
    const user = db.users.find((u) => u.username.toLowerCase() === (username || "").trim().toLowerCase());
    if (!user || !user.passwordHash || !(await bcrypt.compare(password || "", user.passwordHash))) {
      return res.status(401).json({ error: "Usuário ou senha incorretos." });
    }
    const token = crypto.randomBytes(24).toString("hex");
    sessions.set(token, user.id);
    res.json({ token, user: publicUser(user) });
  });

  app.post("/api/auth/google", async (req, res) => {
    const { idToken } = req.body || {};
    if (!idToken) return res.status(400).json({ error: "Token do Google ausente." });
    let payload;
    try {
      const ticket = await googleClient.verifyIdToken({ idToken, audience: GOOGLE_CLIENT_ID });
      payload = ticket.getPayload();
    } catch { return res.status(401).json({ error: "Erro ao verificar conta do Google." }); }
    
    let user = db.users.find((u) => u.googleId === payload.sub);
    if (!user) {
      user = { id: crypto.randomUUID(), username: uniqueUsernameFrom(payload.name || payload.email.split("@")[0]), googleId: payload.sub, googlePicture: payload.picture || null, passwordHash: null };
      db.users.push(user);
      persist();
    }
    const token = crypto.randomBytes(24).toString("hex");
    sessions.set(token, user.id);
    res.json({ token, user: publicUser(user) });
  });

  app.get("/api/me", requireAuth, (req, res) => {
    const user = db.users.find((u) => u.id === req.userId);
    res.json(publicUser(user));
  });

  app.patch("/api/me", requireAuth, (req, res) => {
    const user = db.users.find((u) => u.id === req.userId);
    const { avatarDataUrl, username, bannerDataUrl, bio, pronouns } = req.body || {};
    let changed = false;

    if (typeof username === "string" && username.trim() !== user.username) {
      const clean = username.trim();
      if (clean.length < 3) return res.status(400).json({ error: "Nome precisa ter pelo menos 3 letras." });
      if (db.users.some((u) => u.id !== user.id && u.username.toLowerCase() === clean.toLowerCase())) return res.status(400).json({ error: "Esse nome já existe." });
      user.username = clean; changed = true;
    }
    if (typeof avatarDataUrl === "string" && avatarDataUrl.startsWith("data:image/")) { user.avatarDataUrl = avatarDataUrl; changed = true; }
    if (typeof bannerDataUrl === "string" && bannerDataUrl.startsWith("data:image/")) { user.bannerDataUrl = bannerDataUrl; changed = true; }
    if (typeof bio === "string") { user.bio = bio.trim().slice(0, 190); changed = true; }
    if (typeof pronouns === "string") { user.pronouns = pronouns.trim().slice(0, 40); changed = true; }

    if (changed) {
      persist();
      const userData = publicUser(user);
      for (const client of allConnectedClients) send(client, { type: "user-updated", user: userData });
    }
    res.json(publicUser(user));
  });

  app.get("/api/turn-credentials", async (req, res) => {
    if (!HF_TOKEN) return res.json({ iceServers: [{ urls: "stun:stun.l.google.com:19302" }] });
    try {
      const response = await fetch("https://huggingface.co/api/cloudflare/turn-credentials", {
        method: "POST",
        headers: { "Authorization": `Bearer ${HF_TOKEN}`, "Content-Type": "application/json" },
        body: JSON.stringify({ ttl: 86400 })
      });
      const data = await response.json();
      if (data.iceServers) res.json({ iceServers: data.iceServers });
      else res.json({ iceServers: [{ urls: "stun:stun.l.google.com:19302" }] });
    } catch (err) { res.json({ iceServers: [{ urls: "stun:stun.l.google.com:19302" }] }); }
  });

  function serverWithChannels(server, userId) {
    const muted = new Set((db.users.find((u) => u.id === userId)?.mutedChannelIds) || []);
    const isOwner = server.ownerId === userId;
    const categories = db.categories.filter((c) => c.serverId === server.id && (!c.private || isOwner || (c.allowedUserIds || []).includes(userId)));
    const visibleCategoryIds = new Set(categories.map((c) => c.id));
    return {
      ...server, categories,
      channels: db.channels.filter((c) => c.serverId === server.id && (!c.categoryId || visibleCategoryIds.has(c.categoryId))).map((c) => ({ ...c, muted: muted.has(c.id) })),
    };
  }

  app.get("/api/servers", requireAuth, (req, res) => res.json(db.servers.filter((s) => s.members.includes(req.userId)).map((s) => serverWithChannels(s, req.userId))));
  
  app.post("/api/servers", requireAuth, (req, res) => {
    const { name } = req.body || {};
    if (!name || !name.trim()) return res.status(400).json({ error: "Dê um nome ao servidor." });
    const server = { id: crypto.randomUUID(), name: name.trim(), ownerId: req.userId, inviteCode: crypto.randomBytes(4).toString("hex"), members: [req.userId] };
    db.servers.push(server);
    db.channels.push({ id: crypto.randomUUID(), serverId: server.id, name: "geral", categoryId: null });
    persist(); res.json(serverWithChannels(server, req.userId));
  });

  app.post("/api/servers/join", requireAuth, (req, res) => {
    const { inviteCode } = req.body || {};
    const server = db.servers.find((s) => s.inviteCode === (inviteCode || "").trim());
    if (!server) return res.status(404).json({ error: "Código inválido." });
    if (!server.members.includes(req.userId)) { server.members.push(req.userId); persist(); }
    res.json(serverWithChannels(server, req.userId));
  });

  app.patch("/api/servers/:serverId", requireAuth, (req, res) => {
    const server = db.servers.find((s) => s.id === req.params.serverId);
    if (!server || !server.members.includes(req.userId)) return res.status(403).json({ error: "Sem acesso." });
    if (server.ownerId !== req.userId) return res.status(403).json({ error: "Só o dono pode mudar." });
    const { iconDataUrl } = req.body || {};
    if (typeof iconDataUrl === "string" && iconDataUrl.startsWith("data:image/")) { server.iconDataUrl = iconDataUrl; persist(); }
    res.json(serverWithChannels(server, req.userId));
  });

  app.get("/api/servers/:serverId/members", requireAuth, (req, res) => {
    const server = db.servers.find((s) => s.id === req.params.serverId);
    if (!server || !server.members.includes(req.userId)) return res.status(403).json({ error: "Sem acesso." });
    res.json(server.members.map((id) => db.users.find((u) => u.id === id)).filter(Boolean).map(publicUser));
  });

  app.post("/api/servers/:serverId/channels", requireAuth, (req, res) => {
    const server = db.servers.find((s) => s.id === req.params.serverId);
    if (!server || !server.members.includes(req.userId)) return res.status(403).json({ error: "Sem acesso." });
    const { name, categoryId, type } = req.body || {};
    if (!name || !name.trim()) return res.status(400).json({ error: "Dê um nome ao canal." });
    const channel = { id: crypto.randomUUID(), serverId: server.id, name: name.trim(), categoryId: categoryId || null, type: type === "voice" ? "voice" : "text" };
    db.channels.push(channel); persist(); res.json(channel);
  });

  app.post("/api/servers/:serverId/categories", requireAuth, (req, res) => {
    const server = db.servers.find((s) => s.id === req.params.serverId);
    if (!server || !server.members.includes(req.userId)) return res.status(403).json({ error: "Sem acesso." });
    const { name, private: isPrivate, allowedUserIds } = req.body || {};
    if (!name || !name.trim()) return res.status(400).json({ error: "Dê um nome à categoria." });
    db.categories.push({ id: crypto.randomUUID(), serverId: server.id, name: name.trim(), private: !!isPrivate, allowedUserIds: isPrivate && Array.isArray(allowedUserIds) ? allowedUserIds : [] });
    persist(); res.json({ ok: true });
  });

  app.post("/api/channels/:channelId/mute", requireAuth, (req, res) => {
    const channel = db.channels.find((c) => c.id === req.params.channelId);
    if (!channel) return res.status(404).json({ error: "Canal não encontrado." });
    const user = db.users.find((u) => u.id === req.userId);
    if (!user.mutedChannelIds) user.mutedChannelIds = [];
    const idx = user.mutedChannelIds.indexOf(req.params.channelId);
    if (idx === -1) user.mutedChannelIds.push(req.params.channelId);
    else user.mutedChannelIds.splice(idx, 1);
    persist(); res.json({ muted: idx === -1 });
  });

  app.delete("/api/channels/:channelId", requireAuth, (req, res) => {
    const channel = db.channels.find((c) => c.id === req.params.channelId);
    if (!channel) return res.status(404).json({ error: "Canal não encontrado." });
    const server = db.servers.find((s) => s.id === channel.serverId);
    if (!server || server.ownerId !== req.userId) return res.status(403).json({ error: "Só o dono pode excluir." });
    db.channels = db.channels.filter((c) => c.id !== req.params.channelId);
    deleteChannelMessages(req.params.channelId).then(async (videoIds) => { for (const id of videoIds) await deleteMediaIfUnused(id); }).catch((err) => console.error(err.message));
    persist(); res.json({ ok: true });
  });

  app.delete("/api/servers/:serverId/categories/:categoryId", requireAuth, (req, res) => {
    const server = db.servers.find((s) => s.id === req.params.serverId);
    if (!server || server.ownerId !== req.userId) return res.status(403).json({ error: "Só o dono pode excluir." });
    db.categories = db.categories.filter((c) => c.id !== req.params.categoryId);
    for (const channel of db.channels) { if (channel.categoryId === req.params.categoryId) channel.categoryId = null; }
    persist(); res.json({ ok: true });
  });

  app.get("/api/friends", requireAuth, (req, res) => {
    const myId = req.userId;
    const accepted = db.friendRequests.filter((r) => r.status === "accepted" && (r.fromUserId === myId || r.toUserId === myId));
    const friends = accepted.map((r) => {
      const otherId = r.fromUserId === myId ? r.toUserId : r.fromUserId;
      return db.users.find((u) => u.id === otherId);
    }).filter(Boolean).map(publicUser);
    const incoming = db.friendRequests.filter((r) => r.status === "pending" && r.toUserId === myId).map((r) => ({ requestId: r.id, user: db.users.find((u) => u.id === r.fromUserId) })).filter((r) => r.user).map(r => ({ ...r, user: publicUser(r.user) }));
    const outgoing = db.friendRequests.filter((r) => r.status === "pending" && r.fromUserId === myId).map((r) => ({ requestId: r.id, user: db.users.find((u) => u.id === r.toUserId) })).filter((r) => r.user).map(r => ({ ...r, user: publicUser(r.user) }));
    res.json({ friends, incoming, outgoing });
  });

  app.post("/api/friends/request", requireAuth, (req, res) => {
    const { username } = req.body || {};
    const target = db.users.find((u) => u.username.toLowerCase() === (username || "").trim().toLowerCase());
    if (!target) return res.status(404).json({ error: "Usuário não encontrado." });
    if (target.id === req.userId) return res.status(400).json({ error: "Você não pode adicionar você mesmo." });
    const existing = db.friendRequests.find((r) => ((r.fromUserId === req.userId && r.toUserId === target.id) || (r.fromUserId === target.id && r.toUserId === req.userId)) && r.status !== "declined");
    if (existing) {
      if (existing.status === "accepted") return res.status(400).json({ error: "Vocês já são amigos." });
      if (existing.fromUserId === target.id) { existing.status = "accepted"; persist(); return res.json({ ok: true, autoAccepted: true }); }
      return res.status(400).json({ error: "Pedido já enviado." });
    }
    db.friendRequests.push({ id: crypto.randomUUID(), fromUserId: req.userId, toUserId: target.id, status: "pending", createdAt: Date.now() });
    persist(); res.json({ ok: true });
  });

  app.post("/api/friends/:requestId/accept", requireAuth, (req, res) => {
    const request = db.friendRequests.find((r) => r.id === req.params.requestId);
    if (!request || request.toUserId !== req.userId || request.status !== "pending") return res.status(404).json({ error: "Pedido não encontrado." });
    request.status = "accepted"; persist(); res.json({ ok: true });
  });

  app.post("/api/friends/:requestId/decline", requireAuth, (req, res) => {
    const request = db.friendRequests.find((r) => r.id === req.params.requestId);
    if (!request || (request.toUserId !== req.userId && request.fromUserId !== req.userId)) return res.status(404).json({ error: "Pedido não encontrado." });
    db.friendRequests = db.friendRequests.filter((r) => r.id !== req.params.requestId);
    persist(); res.json({ ok: true });
  });

  function channelIfMember(channelId, userId) {
    const channel = db.channels.find((c) => c.id === channelId);
    if (channel) {
      const server = db.servers.find((s) => s.id === channel.serverId);
      return (server && server.members.includes(userId)) ? channel : null;
    }
    const dm = db.dmChannels.find((d) => d.id === channelId);
    return (dm && dm.userIds.includes(userId)) ? dm : null;
  }

  app.post("/api/friends/:friendUserId/dm", requireAuth, (req, res) => {
    const friendId = req.params.friendUserId;
    const areFriends = db.friendRequests.some((r) => r.status === "accepted" && ((r.fromUserId === req.userId && r.toUserId === friendId) || (r.fromUserId === friendId && r.toUserId === req.userId)));
    if (!areFriends) return res.status(403).json({ error: "Vocês não são amigos." });
    let dm = db.dmChannels.find((d) => d.userIds.includes(req.userId) && d.userIds.includes(friendId));
    if (!dm) { dm = { id: crypto.randomUUID(), userIds: [req.userId, friendId] }; db.dmChannels.push(dm); persist(); }
    res.json({ channelId: dm.id, friend: publicUser(db.users.find((u) => u.id === friendId)) });
  });

  app.get("/api/channels/:channelId/messages", requireAuth, async (req, res) => {
    if (!channelIfMember(req.params.channelId, req.userId)) return res.status(403).json({ error: "Sem acesso." });
    try { const msgs = await getChannelMessages(req.params.channelId, 100); res.json(msgs); }
    catch (err) { res.status(500).json({ error: "Erro ao carregar mensagens." }); }
  });

  app.patch("/api/messages/:messageId", requireAuth, async (req, res) => {
    try {
      const message = await getMessage(req.params.messageId);
      if (!message || message.userId !== req.userId) return res.status(403).json({ error: "Sem permissão." });
      const { text } = req.body || {};
      if (typeof text !== "string" || !text.trim()) return res.status(400).json({ error: "Vazio." });
      const fields = { text: text.trim().slice(0, 2000), editedAt: Date.now() };
      await updateMessage(message.id, fields); Object.assign(message, fields);
      const subs = chatSubscribers.get(message.channelId);
      if (subs) for (const peer of subs) send(peer, { type: "message-edited", message });
      res.json(message);
    } catch (err) { res.status(500).json({ error: "Erro." }); }
  });

  app.delete("/api/messages/:messageId", requireAuth, async (req, res) => {
    try {
      const message = await getMessage(req.params.messageId);
      if (!message || message.userId !== req.userId) return res.status(403).json({ error: "Sem permissão." });
      await deleteMessageById(message.id);
      if (message.videoId) deleteMediaIfUnused(message.videoId).catch(() => {});
      if (message.fileId) deleteMediaIfUnused(message.fileId).catch(() => {});
      const subs = chatSubscribers.get(message.channelId);
      if (subs) for (const peer of subs) send(peer, { type: "message-deleted", messageId: message.id, channelId: message.channelId });
      res.json({ ok: true });
    } catch (err) { res.status(500).json({ error: "Erro." }); }
  });

  app.post("/api/channels/:channelId/forward", requireAuth, async (req, res) => {
    if (!channelIfMember(req.params.channelId, req.userId)) return res.status(403).json({ error: "Sem acesso." });
    const { text, imageDataUrl, audioDataUrl, videoId, fileId, fileName, mentions } = req.body || {};
    const message = await createChatMessage(req.params.channelId, req.userId, { text, imageDataUrl, audioDataUrl, videoId, fileId, fileName, mentions });
    if (!message) return res.status(400).json({ error: "Nada para encaminhar." });
    res.json(message);
  });

  const MAX_FILE_BYTES = 15 * 1024 * 1024; 
  
  app.post("/api/channels/:channelId/media", requireAuth, express.raw({ type: () => true, limit: MAX_FILE_BYTES }), async (req, res) => {
    if (!channelIfMember(req.params.channelId, req.userId)) return res.status(403).json({ error: "Sem acesso." });
    const contentType = (req.headers["content-type"] || "").split(";")[0].trim().toLowerCase();
    const body = req.body;
    if (!Buffer.isBuffer(body) || body.length === 0) return res.status(400).json({ error: "Arquivo vazio." });
    if (body.length > MAX_FILE_BYTES) return res.status(413).json({ error: "Arquivo grande demais (limite: 15 MB)." });
    try {
      const id = crypto.randomUUID();
      await insertMedia({ id, ownerId: req.userId, channelId: req.params.channelId, contentType, size: body.length, dataB64: body.toString("base64") });
      res.json({ mediaId: id, size: body.length });
    } catch (err) { res.status(500).json({ error: "Erro ao salvar arquivo." }); }
  });

  function parseRange(header, size) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(header || "");
    if (!m || (m[1] === "" && m[2] === "")) return null;
    let start, end;
    if (m[1] === "") { start = Math.max(size - parseInt(m[2], 10), 0); end = size - 1; } 
    else { start = parseInt(m[1], 10); end = m[2] === "" ? size - 1 : Math.min(parseInt(m[2], 10), size - 1); }
    if (start > end || start >= size) return "invalid";
    return { start, end };
  }

  app.get("/api/media/:mediaId", async (req, res) => {
    const token = (req.headers.authorization || "").replace("Bearer ", "") || (req.query && req.query.token) || "";
    const userId = sessions.get(token);
    if (!userId) return res.status(401).json({ error: "Não autenticado." });
    try {
      const media = await getMediaData(req.params.mediaId);
      if (!media) return res.status(404).json({ error: "Arquivo não encontrado." });
      if (!media.channelIds.some((cid) => channelIfMember(cid, userId))) return res.status(403).json({ error: "Sem acesso." });
      const size = media.buffer.length;
      res.setHeader("Content-Type", media.contentType);
      res.setHeader("Accept-Ranges", "bytes");
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Cache-Control", "private, max-age=3600");
      const range = parseRange(req.headers.range, size);
      if (range === "invalid") { res.setHeader("Content-Range", `bytes */${size}`); return res.status(416).end(); }
      if (range) {
        res.setHeader("Content-Range", `bytes ${range.start}-${range.end}/${size}`);
        res.setHeader("Content-Length", String(range.end - range.start + 1));
        return res.status(206).end(media.buffer.subarray(range.start, range.end + 1));
      }
      res.setHeader("Content-Length", String(size));
      res.status(200).end(media.buffer);
    } catch (err) { res.status(500).json({ error: "Erro." }); }
  });

  app.use((err, req, res, next) => { console.error("Erro não tratado:", err); res.status(err.status || 500).json({ error: "Algo deu errado no servidor." }); });

  const server = http.createServer(app);
  const wss = new WebSocketServer({ server });
  const callRooms = new Map();
  const chatSubscribers = new Map();
  const allConnectedClients = new Set();
  const typingState = new Map();

  function send(ws, msg) { if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg)); }
  let lastMessageTime = 0;
  function nextMessageTime() { lastMessageTime = Math.max(Date.now(), lastMessageTime + 1); return lastMessageTime; }

  async function createChatMessage(channelId, userId, { text, imageDataUrl, audioDataUrl, videoId, fileId, fileName, replyToId, mentions }) {
    try {
      const cleanText = (text || "").trim().slice(0, 2000);
      let cleanImage = null;
      if (typeof imageDataUrl === "string" && imageDataUrl.startsWith("data:image/")) cleanImage = imageDataUrl;
      let cleanAudio = null;
      if (typeof audioDataUrl === "string" && audioDataUrl.startsWith("data:audio/")) cleanAudio = audioDataUrl;

      let cleanVideoId = null;
      if (typeof videoId === "string" && videoId) {
        const meta = await getMediaMeta(videoId);
        if (meta && meta.channelIds.some((cid) => channelIfMember(cid, userId))) cleanVideoId = videoId;
      }
      
      let cleanFileId = null;
      if (typeof fileId === "string" && fileId) {
        const meta = await getMediaMeta(fileId);
        if (meta && meta.channelIds.some((cid) => channelIfMember(cid, userId))) cleanFileId = fileId;
      }

      if (!cleanText && !cleanImage && !cleanAudio && !cleanVideoId && !cleanFileId) return null;

      let replyTo = null;
      if (replyToId) {
        const original = await getMessage(replyToId);
        if (original) replyTo = { id: original.id, username: original.username, text: (original.text || "").slice(0, 120) };
      }

      const cleanMentions = Array.isArray(mentions) ? mentions : [];

      const author = db.users.find((u) => u.id === userId);
      const message = {
        id: crypto.randomUUID(), channelId, userId,
        username: author ? author.username : "?",
        avatarDataUrl: author ? author.avatarDataUrl || author.googlePicture || null : null,
        text: cleanText, imageDataUrl: cleanImage, audioDataUrl: cleanAudio,
        videoId: cleanVideoId, fileId: cleanFileId, fileName: fileName || null,
        replyTo, mentions: cleanMentions,
        createdAt: nextMessageTime(),
      };

      if (cleanVideoId) await addMediaChannel(cleanVideoId, channelId);
      if (cleanFileId) await addMediaChannel(cleanFileId, channelId);
      await insertMessage(message);

      const channelTyping = typingState.get(channelId);
      if (channelTyping && channelTyping.has(userId)) {
        clearTimeout(channelTyping.get(userId));
        channelTyping.delete(userId);
        const subs = chatSubscribers.get(channelId);
        if (subs) for (const peer of subs) send(peer, { type: "typing-stop", channelId, userId });
      }

      const subs = chatSubscribers.get(channelId);
      if (subs) for (const peer of subs) send(peer, { type: "chat-message", message });
      return message;
    } catch (err) { return null; }
  }

  wss.on("connection", (ws, req) => {
    const url = new URL(req.url, "http://localhost");
    const token = url.searchParams.get("token");
    const userId = sessions.get(token);
    if (!userId) { ws.close(); return; }
    
    allConnectedClients.add(ws);
    ws.isAlive = true;
    ws.on("pong", () => { ws.isAlive = true; });

    const author = db.users.find((u) => u.id === userId);
    ws.userId = userId; ws.username = author ? author.username : "?";
    ws.avatarDataUrl = author ? author.avatarDataUrl || author.googlePicture || null : null;
    ws.peerId = crypto.randomUUID(); ws.channelId = null;

    ws.on("message", (raw) => {
      let msg; try { msg = JSON.parse(raw); } catch { return; }

      if (msg.type === "enter-channel") {
        if (!channelIfMember(msg.channelId, ws.userId)) return send(ws, { type: "error", message: "Canal não encontrado." });
        ws.channelId = msg.channelId;
        let subs = chatSubscribers.get(msg.channelId) || new Set();
        subs.add(ws); chatSubscribers.set(msg.channelId, subs);
        
        let room = callRooms.get(msg.channelId) || new Map();
        const existingPeers = [...room.values()].map((peer) => ({ id: peer.peerId, username: peer.username, avatarDataUrl: peer.avatarDataUrl }));
        room.set(ws.peerId, ws); callRooms.set(msg.channelId, room);
        
        send(ws, { type: "entered", channelId: msg.channelId, selfId: ws.peerId, peers: existingPeers });
        for (const peer of room.values()) { if (peer !== ws) send(peer, { type: "peer-joined", id: ws.peerId, username: ws.username, avatarDataUrl: ws.avatarDataUrl }); }
        return;
      }

      if (msg.type === "typing-start") {
        if (!channelIfMember(msg.channelId, ws.userId)) return;
        if (!typingState.has(msg.channelId)) typingState.set(msg.channelId, new Map());
        const channelTyping = typingState.get(msg.channelId);
        if (channelTyping.has(ws.userId)) clearTimeout(channelTyping.get(ws.userId));
        const timeout = setTimeout(() => {
          channelTyping.delete(ws.userId);
          const subs = chatSubscribers.get(msg.channelId);
          if (subs) for (const peer of subs) send(peer, { type: "typing-stop", channelId: msg.channelId, userId: ws.userId });
        }, 3000);
        channelTyping.set(ws.userId, timeout);
        const subs = chatSubscribers.get(msg.channelId);
        if (subs) for (const peer of subs) { if (peer !== ws) send(peer, { type: "typing-start", channelId: msg.channelId, userId: ws.userId, username: ws.username }); }
        return;
      }

      if (msg.type === "typing-stop") {
        if (!channelIfMember(msg.channelId, ws.userId)) return;
        const channelTyping = typingState.get(msg.channelId);
        if (channelTyping && channelTyping.has(ws.userId)) {
          clearTimeout(channelTyping.get(ws.userId));
          channelTyping.delete(ws.userId);
          const subs = chatSubscribers.get(msg.channelId);
          if (subs) for (const peer of subs) send(peer, { type: "typing-stop", channelId: msg.channelId, userId: ws.userId });
        }
        return;
      }

      if (msg.type === "chat-message") {
        if (!channelIfMember(msg.channelId, ws.userId)) return;
        createChatMessage(msg.channelId, ws.userId, msg);
        return;
      }

      if (["offer", "answer", "ice-candidate"].includes(msg.type)) {
        const room = callRooms.get(ws.channelId);
        if (room) { const target = room.get(msg.target); if (target) send(target, { ...msg, from: ws.peerId }); }
      }

      if (msg.type === "screen-share-ended") {
        const room = callRooms.get(ws.channelId);
        if (room) for (const peer of room.values()) { if (peer !== ws) send(peer, { type: "screen-share-ended", from: ws.peerId }); }
      }
    });

    ws.on("close", () => {
      allConnectedClients.delete(ws);
      const channelTyping = typingState.get(ws.channelId);
      if (channelTyping && channelTyping.has(ws.userId)) {
        clearTimeout(channelTyping.get(ws.userId)); channelTyping.delete(ws.userId);
        const subs = chatSubscribers.get(ws.channelId);
        if (subs) for (const peer of subs) send(peer, { type: "typing-stop", channelId: ws.channelId, userId: ws.userId });
      }
      const room = callRooms.get(ws.channelId);
      if (room) { room.delete(ws.peerId); for (const peer of room.values()) send(peer, { type: "peer-left", id: ws.peerId }); if (room.size === 0) callRooms.delete(ws.channelId); }
      const subs = chatSubscribers.get(ws.channelId);
      if (subs) { subs.delete(ws); if (subs.size === 0) chatSubscribers.delete(ws.channelId); }
    });
  });

  const interval = setInterval(() => {
    wss.clients.forEach((ws) => {
      if (ws.isAlive === false) return ws.terminate();
      ws.isAlive = false; ws.ping();
    });
  }, 30000);

  wss.on("close", () => clearInterval(interval));

  return new Promise((resolve) => { server.listen(port, () => resolve(server)); });
}

module.exports = { startServer };
if (require.main === module) { startServer(process.env.PORT || 3000); }
