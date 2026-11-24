const express = require("express");
const http = require("http");
const { WebSocketServer } = require("ws");
const path = require("path");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const { OAuth2Client } = require("google-auth-library");
const {
  loadDB, saveDB, insertMessage, getMessage, getChannelMessages, getChannelMessagesPaginated,
  updateMessage, deleteMessageById, deleteChannelMessages, insertMedia,
  getMediaMeta, getMediaData, addMediaChannel, deleteMediaIfUnused,
} = require("./db");

const GOOGLE_CLIENT_ID = "174563350206-669sgb3rc9fmombqjeearvf8rao54n8u.apps.googleusercontent.com";
const googleClient = new OAuth2Client(GOOGLE_CLIENT_ID);
const HF_TOKEN = process.env.HF_TOKEN || "";

async function startServer(port = 3000) {
  const db = await loadDB();
  db.users = db.users || []; db.servers = db.servers || []; db.channels = db.channels || [];
  db.friendRequests = db.friendRequests || []; db.categories = db.categories || []; db.dmChannels = db.dmChannels || [];

  function persist() { saveDB(db).catch((err) => console.error("Erro ao salvar:", err.message)); }

  const sessions = new Map();
  const app = express();
  app.use(express.json({ limit: "15mb" }));
  app.use(express.static(path.join(__dirname, "public")));

  function requireAuth(req, res, next) {
    const header = req.headers.authorization || "";
    const userId = sessions.get(header.replace("Bearer ", ""));
    if (!userId) return res.status(401).json({ error: "Não autenticado." });
    req.userId = userId;
    next();
  }

  function publicUser(user) {
    return { id: user.id, username: user.username, avatarDataUrl: user.avatarDataUrl || user.googlePicture || null, bannerDataUrl: user.bannerDataUrl || null, bio: user.bio || "", pronouns: user.pronouns || "" };
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
    db.users.push(user); persist();
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
      db.users.push(user); persist();
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
      res.json({ iceServers: data.iceServers || [{ urls: "stun:stun.l.google.com:19302" }] });
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
    db.servers.push(server); db.channels.push({ id: crypto.randomUUID(), serverId: server.id, name: "geral", categoryId: null });
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
    if (idx === -1) user.mutedChannelIds.push(req.params.channelId); else user.mutedChannelIds.splice(idx, 1);
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
    try {
      const limit = parseInt(req.query.limit) || 50;
      const before = req.query.before ? parseInt(req.query.before) : null;
      let query = { channelId: req.params.channelId };
      if (before) query.createdAt = { $lt: before };
      const msgs = await getChannelMessagesPaginated(query, limit);
      res.json(msgs);
    } catch (err) { res.status(500).json({ error: "Erro ao carregar mensagens." }); }
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
    ws.peerId = crypto.randomUUID(); 
    ws.textChannelId = null; // NOVO: canal de texto atual
    ws.voiceChannelId = null; // NOVO: canal de voz atual (persistente)

    ws.on("message", (raw) => {
      let msg; try { msg = JSON.parse(raw); } catch { return; }

      if (msg.type === "enter-channel") {
        if (!channelIfMember(msg.channelId, ws.userId)) return send(ws, { type: "error", message: "Canal não encontrado." });
        
        ws.textChannelId = msg.channelId; // Atualiza o canal de texto
        
        // Verifica se o canal clicado é de voz
        const channel = db.channels.find(c => c.id === msg.channelId);
        const isVoiceChannel = channel && channel.type === "voice";

        // Se ele clicou em um canal de voz OU se ele ainda não está conectado a nenhuma call, define o voiceChannelId
        if (isVoiceChannel || !ws.voiceChannelId) {
          ws.voiceChannelId = msg.channelId;
        }

        // Inscreve no chat de texto
        let subs = chatSubscribers.get(msg.channelId) || new Set();
        subs.add(ws); 
        chatSubscribers.set(msg.channelId, subs);

        // Gerencia a sala de voz
        let room = callRooms.get(ws.voiceChannelId) || new Map();
        const existingPeers = [...room.values()]
          .filter(peer => peer !== ws)
          .map((peer) => ({ id: peer.peerId, username: peer.username, avatarDataUrl: peer.avatarDataUrl }));
        
        room.set(ws.peerId, ws); 
        callRooms.set(ws.voiceChannelId, room);

        send(ws, { 
          type: "entered", 
          channelId: msg.channelId, 
          voiceChannelId: ws.voiceChannelId, // Envia o voiceChannelId para o frontend saber
          selfId: ws.peerId, 
          peers: existingPeers 
        });

        // Avisa os outros da sala de voz
        for (const peer of room.values()) { 
          if (peer !== ws) send(peer, { type: "peer-joined", id: ws.peerId, username: ws.username, avatarDataUrl: ws.avatarDataUrl }); 
        }
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
        const room = callRooms.get(ws.voiceChannelId);
        if (room) { const target = room.get(msg.target); if (target) send(target, { ...msg, from: ws.peerId }); }
      }

      if (msg.type === "screen-share-ended") {
        const room = callRooms.get(ws.voiceChannelId);
        if (room) for (const peer of room.values()) { if (peer !== ws) send(peer, { type: "screen-share-ended", from: ws.peerId }); }
      }
    });

    ws.on("close", () => {
      allConnectedClients.delete(ws);
      
      // Limpeza da digitação
      const channelTyping = typingState.get(ws.textChannelId);
      if (channelTyping && channelTyping.has(ws.userId)) {
        clearTimeout(channelTyping.get(ws.userId)); 
        channelTyping.delete(ws.userId);
        const subs = chatSubscribers.get(ws.textChannelId);
        if (subs) for (const peer of subs) send(peer, { type: "typing-stop", channelId: ws.textChannelId, userId: ws.userId });
      }
      
      // Limpeza da sala de voz
      const room = callRooms.get(ws.voiceChannelId);
      if (room) { 
        room.delete(ws.peerId); 
        for (const peer of room.values()) send(peer, { type: "peer-left", id: ws.peerId }); 
        if (room.size === 0) callRooms.delete(ws.voiceChannelId); 
      }
      
      // Limpeza dos inscritos no chat
      const subs = chatSubscribers.get(ws.textChannelId);
      if (subs) { 
        subs.delete(ws); 
        if (subs.size === 0) chatSubscribers.delete(ws.textChannelId); 
      }
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

// NOVO: Estado persistente da Call
let isInCall = false;
let currentVoiceChannelId = null;

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

// NOVO: Variáveis do Menu de Contexto do Usuário
const userContextMenu = document.getElementById("user-context-menu");
const ctxUserVolumeSlider = document.getElementById("ctx-volume-slider");
const ctxMuteCheckbox = document.getElementById("ctx-mute-checkbox");
const ctxMuteSfxCheckbox = document.getElementById("ctx-mute-sfx-checkbox");
let contextTargetUser = null; // { peerId, username, avatarDataUrl }
const userVolumes = new Map(); // peerId -> volume (0 a 2)
const mutedUsers = new Set(); // peerIds
const mutedSfxUsers = new Set(); // peerIds

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
  // Não sai da call automaticamente se mudar de servidor (opcional, mas vamos manter a call viva)
  if (!isInCall) leaveCall();
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
  // Se NÃO estiver em call, sai da call atual (se houver) para limpar estado
  // Se JÁ estiver em call, NÃO sai, apenas muda o canal de texto!
  if (!isInCall) {
    leaveCall(); 
  }
  
  activeChannelId = channelId;
  renderChannelList();
  emptyState.classList.add("hidden");
  callView.classList.remove("hidden");
  activeChannelName.textContent = channelName;
  
  // Se não estiver em call, reseta a UI de vídeo
  if (!isInCall) {
    waitingState.classList.remove("hidden");
    waitingText.textContent = "Aguardando alguém entrar no canal...";
    videoGrid.innerHTML = "";
    shareBtn.classList.remove("hidden"); stopShareBtn.classList.add("hidden");
  }

  typingUsers.clear();
  updateTypingIndicator();

  const server = myServers.find((s) => s.id === activeServerId);
  const channel = server?.channels.find((c) => c.id === channelId);
  activeChannelType = channel?.type === "voice" ? "voice" : "text";
  
  const callColumn = document.querySelector(".call-column");
  const chatColumn = document.querySelector(".chat-column");
  
  // Se estiver em call, mantém a tela de vídeo visível
  if (isInCall || activeChannelType === "voice") { 
    callColumn.style.display = "flex"; 
    chatColumn.style.display = "flex"; 
    chatColumn.style.width = "320px"; 
  } 
  else { 
    callColumn.style.display = "none"; 
    chatColumn.style.display = "flex"; 
    chatColumn.style.width = "100%"; 
  }

  loadMessageHistory(channelId);
  
  // Se não estiver em call, conecta. Se já estiver, apenas avisa o backend do novo canal de texto
  if (!isInCall) {
    connectToChannel(channelId);
  } else {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "enter-channel", channelId: channelId }));
    }
  }
  
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

// ---------- WebSocket + WebRTC ----------
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
        isInCall = true;
        currentVoiceChannelId = msg.voiceChannelId || msg.channelId;
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
      // statusText.textContent = "Transmitindo ao vivo"; // Removido para não sobrescrever
    } else if (conn.connectionState === "failed" || conn.connectionState === "disconnected") {
      console.warn(`Conexão com ${peerId} falhou. Tentando reconectar...`);
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
  
  // Adicionando botão direito no próprio avatar (caso queira)
  meCircle.querySelector('[data-user-id="me"]').addEventListener("contextmenu", (e) => {
    e.preventDefault();
    openUserContextMenu("me", currentUser.username, currentUser.avatarDataUrl, e.clientX, e.clientY);
  });
  
  participantsCircleRow.appendChild(meCircle);

  for (const [peerId, peer] of knownPeers) {
    const circle = document.createElement("div");
    circle.className = "participant-circle";
    circle.dataset.key = peerId;
    circle.innerHTML = `<div class="avatar-lg" data-peer-id="${peerId}" style="cursor:pointer;">${avatarHtml(peer.username, peer.avatarDataUrl)}</div><div class="participant-name">${escapeHtml(peer.username)}</div>`;
    
    // Clique esquerdo (Abre perfil)
    circle.querySelector('[data-peer-id]').addEventListener("click", async () => {
      try {
        const friends = await api("/api/friends");
        const friend = friends.friends.find((f) => f.username === peer.username);
        if (friend) openUserCard(friend);
        else openUserCard({ username: peer.username, avatarDataUrl: peer.avatarDataUrl });
      } catch { openUserCard({ username: peer.username, avatarDataUrl: peer.avatarDataUrl }); }
    });
    
    // Clique direito (Abre o Menu)
    circle.querySelector('[data-peer-id]').addEventListener("contextmenu", (e) => {
      e.preventDefault();
      openUserContextMenu(peerId, peer.username, peer.avatarDataUrl, e.clientX, e.clientY);
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
    
    avatar.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      openUserContextMenu(peerId, peer.username, peer.avatarDataUrl, e.clientX, e.clientY);
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
  
  // Aplica o volume e mute personalizados se existirem
  audioEl.volume = mutedUsers.has(peerId) ? 0 : (userVolumes.get(peerId) ?? 1) * (deafened ? 0 : 1);
  
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
    
    // ADICIONADO: Botão direito na transmissão
    tile.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      openUserContextMenu(peerId, username, knownPeers.get(peerId)?.avatarDataUrl, e.clientX, e.clientY);
    });
    
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
  localScreenStream = null;
  stopShareBtn.classList.add("hidden"); shareBtn.classList.remove("hidden");
  if (ws) ws.send(JSON.stringify({ type: "screen-share-ended" }));
}

leaveChannelBtn.addEventListener("click", () => {
  isInCall = false;
  currentVoiceChannelId = null;
  leaveCall(); 
  activeChannelId = null; 
  renderChannelList();
  emptyState.classList.remove("hidden"); 
  callView.classList.add("hidden");
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
  
  // Reseta estado de call
  isInCall = false; 
  currentVoiceChannelId = null;
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

// === MENU DE CONTEXTO DE USUÁRIO (BOTÃO DIREITO) ===
function openUserContextMenu(peerId, username, avatarDataUrl, x, y) {
  // Se for "me", não permitimos algumas ações (mas mantemos o menu para consistência)
  if (!peerId) return;
  
  contextTargetUser = { peerId, username, avatarDataUrl };
  
  // Ajusta posição para não vazar a tela
  userContextMenu.classList.remove("hidden");
  const menuWidth = 240;
  const menuHeight = 380; // Aproximado com base no conteúdo
  let left = x;
  let top = y;
  if (left + menuWidth > window.innerWidth) left = window.innerWidth - menuWidth - 10;
  if (top + menuHeight > window.innerHeight) top = window.innerHeight - menuHeight - 10;
  userContextMenu.style.left = `${left}px`;
  userContextMenu.style.top = `${top}px`;
  
  // Atualiza estado dos controles
  ctxUserVolumeSlider.value = (userVolumes.get(peerId) ?? 1) * 100;
  ctxMuteCheckbox.checked = mutedUsers.has(peerId);
  ctxMuteSfxCheckbox.checked = mutedSfxUsers.has(peerId);
  
  // Desabilita botões se for o próprio usuário
  const isMe = peerId === "me";
  document.getElementById("ctx-user-call").style.display = isMe ? "none" : "flex";
  document.getElementById("ctx-user-add-friend").style.display = isMe ? "none" : "flex";
}

// Fecha o menu ao clicar fora
document.addEventListener("click", (e) => {
  if (!userContextMenu.contains(e.target) && !e.target.closest(".participant-circle") && !e.target.closest(".video-tile") && !e.target.closest(".topbar-participants")) {
    userContextMenu.classList.add("hidden");
  }
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") userContextMenu.classList.add("hidden");
});

// Ações do Menu
document.getElementById("ctx-user-profile").addEventListener("click", () => {
  if (contextTargetUser) openUserCard({ username: contextTargetUser.username, avatarDataUrl: contextTargetUser.avatarDataUrl });
  userContextMenu.classList.add("hidden");
});

document.getElementById("ctx-user-message").addEventListener("click", async () => {
  if (contextTargetUser) {
    try {
      const friends = await api("/api/friends");
      const friend = friends.friends.find(f => f.username === contextTargetUser.username);
      if (friend) openDirectMessage(friend);
      else alert("Você só pode mandar mensagem para amigos.");
    } catch (err) { alert(err.message); }
  }
  userContextMenu.classList.add("hidden");
});

document.getElementById("ctx-user-call").addEventListener("click", () => {
  alert(`Iniciando chamada privada com ${contextTargetUser?.username}... (Funcionalidade futura)`);
  userContextMenu.classList.add("hidden");
});

document.getElementById("ctx-user-note").addEventListener("click", () => {
  const note = prompt(`Nota privada sobre ${contextTargetUser?.username}:`);
  if (note) {
    localStorage.setItem(`note-${contextTargetUser.username}`, note);
    alert("Nota salva com sucesso!");
  }
  userContextMenu.classList.add("hidden");
});

ctxUserVolumeSlider.addEventListener("input", () => {
  if (!contextTargetUser) return;
  const vol = parseInt(ctxUserVolumeSlider.value) / 100;
  userVolumes.set(contextTargetUser.peerId, vol);
  const audioEl = document.getElementById(`audio-${contextTargetUser.peerId}`);
  if (audioEl && !mutedUsers.has(contextTargetUser.peerId)) {
    audioEl.volume = vol * (deafened ? 0 : 1);
  }
});

ctxMuteCheckbox.addEventListener("change", () => {
  if (!contextTargetUser) return;
  const isMuted = ctxMuteCheckbox.checked;
  if (isMuted) mutedUsers.add(contextTargetUser.peerId);
  else mutedUsers.delete(contextTargetUser.peerId);
  
  const audioEl = document.getElementById(`audio-${contextTargetUser.peerId}`);
  if (audioEl) {
    audioEl.volume = isMuted ? 0 : (userVolumes.get(contextTargetUser.peerId) ?? 1) * (deafened ? 0 : 1);
  }
});

ctxMuteSfxCheckbox.addEventListener("change", () => {
  if (!contextTargetUser) return;
  if (ctxMuteSfxCheckbox.checked) mutedSfxUsers.add(contextTargetUser.peerId);
  else mutedSfxUsers.delete(contextTargetUser.peerId);
});

document.getElementById("ctx-user-verify").addEventListener("click", () => {
  alert("Código de verificação: " + Math.random().toString(36).substring(2, 10).toUpperCase());
  userContextMenu.classList.add("hidden");
});

document.getElementById("ctx-user-apps").addEventListener("click", () => {
  alert("Apps: Em breve.");
  userContextMenu.classList.add("hidden");
});

document.getElementById("ctx-user-invite").addEventListener("click", () => {
  const server = myServers.find(s => s.id === activeServerId);
  if (server) {
    navigator.clipboard.writeText(server.inviteCode);
    alert(`Convite copiado: ${server.inviteCode}\nEnvie para ${contextTargetUser?.username}!`);
  }
  userContextMenu.classList.add("hidden");
});

document.getElementById("ctx-user-add-friend").addEventListener("click", async () => {
  if (contextTargetUser) {
    try {
      await api("/api/friends/request", { method: "POST", body: JSON.stringify({ username: contextTargetUser.username }) });
      alert(`Pedido de amizade enviado para ${contextTargetUser.username}!`);
    } catch (err) { alert(err.message); }
  }
  userContextMenu.classList.add("hidden");
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
// === CONTROLE DO PAINEL DE CONEXÃO PERSISTENTE ===
const connectionPanel = document.getElementById("connection-panel");
const connectionChannelName = document.getElementById("connection-channel-name");
const connectionShareBtn = document.getElementById("connection-share-btn");
const connectionDisconnectBtn = document.getElementById("connection-disconnect-btn");

function updateConnectionPanel() {
  if (isInCall && currentVoiceChannelId) {
    connectionPanel.classList.add("visible");
    // Encontra o nome do canal de voz atual
    const server = myServers.find(s => s.channels.some(c => c.id === currentVoiceChannelId));
    const channel = server?.channels.find(c => c.id === currentVoiceChannelId);
    connectionChannelName.textContent = channel ? channel.name : "Canal de voz";
  } else {
    connectionPanel.classList.remove("visible");
  }
}

// Botão de compartilhar tela no painel flutuante
connectionShareBtn.addEventListener("click", () => {
  if (shareBtn.classList.contains("hidden")) {
    stopSharing(); // Se já está compartilhando, para
  } else {
    shareBtn.click(); // Se não, inicia
  }
});

// Botão de desconectar no painel flutuante
connectionDisconnectBtn.addEventListener("click", () => {
  leaveChannelBtn.click(); // Aciona a mesma função de sair do canal
});
