const express = require("express");
const http = require("http");
const { WebSocketServer } = require("ws");
const path = require("path");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const { OAuth2Client } = require("google-auth-library");
const { loadDB, saveDB } = require("./db");

const GOOGLE_CLIENT_ID = "174563350206-669sgb3rc9fmombqjeearvf8rao54n8u.apps.googleusercontent.com";
const googleClient = new OAuth2Client(GOOGLE_CLIENT_ID);

async function startServer(port = 3000) {
  const db = await loadDB();

  function persist() {
    saveDB(db).catch((err) => console.error("Erro ao salvar no banco:", err.message));
  }

  // token -> userId (fica só na memória; ao reiniciar o servidor, todo
  // mundo precisa logar de novo - da pra evoluir isso depois)
  const sessions = new Map();

  const app = express();
  app.use(express.json({ limit: "2mb" }));
  app.use(express.static(path.join(__dirname, "public")));

  // ---------- Autenticação ----------

  function requireAuth(req, res, next) {
    const header = req.headers.authorization || "";
    const token = header.replace("Bearer ", "");
    const userId = sessions.get(token);
    if (!userId) return res.status(401).json({ error: "Não autenticado." });
    req.userId = userId;
    next();
  }

  function publicUser(user) {
    return { id: user.id, username: user.username, avatarDataUrl: user.avatarDataUrl || user.googlePicture || null };
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
    if (!username || username.trim().length < 3) {
      return res.status(400).json({ error: "Nome de usuário precisa ter pelo menos 3 letras." });
    }
    if (!password || password.length < 4) {
      return res.status(400).json({ error: "Senha precisa ter pelo menos 4 caracteres." });
    }
    const clean = username.trim();
    if (db.users.some((u) => u.username.toLowerCase() === clean.toLowerCase())) {
      return res.status(400).json({ error: "Esse nome de usuário já existe." });
    }
    const user = {
      id: crypto.randomUUID(),
      username: clean,
      passwordHash: await bcrypt.hash(password, 10),
    };
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
    } catch {
      return res.status(401).json({ error: "Não foi possível verificar sua conta do Google." });
    }

    let user = db.users.find((u) => u.googleId === payload.sub);
    if (!user) {
      user = {
        id: crypto.randomUUID(),
        username: uniqueUsernameFrom(payload.name || payload.email.split("@")[0]),
        googleId: payload.sub,
        googlePicture: payload.picture || null,
        passwordHash: null,
      };
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
    const { avatarDataUrl } = req.body || {};
    if (typeof avatarDataUrl === "string") {
      if (!avatarDataUrl.startsWith("data:image/")) {
        return res.status(400).json({ error: "Imagem inválida." });
      }
      user.avatarDataUrl = avatarDataUrl;
      persist();
    }
    res.json(publicUser(user));
  });

  // ---------- Servidores e canais ----------

  function serverWithChannels(server) {
    return {
      ...server,
      channels: db.channels.filter((c) => c.serverId === server.id),
    };
  }

  app.get("/api/servers", requireAuth, (req, res) => {
    const mine = db.servers.filter((s) => s.members.includes(req.userId));
    res.json(mine.map(serverWithChannels));
  });

  app.post("/api/servers", requireAuth, (req, res) => {
    const { name } = req.body || {};
    if (!name || !name.trim()) return res.status(400).json({ error: "Dê um nome ao servidor." });

    const server = {
      id: crypto.randomUUID(),
      name: name.trim(),
      ownerId: req.userId,
      inviteCode: crypto.randomBytes(4).toString("hex"),
      members: [req.userId],
    };
    db.servers.push(server);

    const generalChannel = { id: crypto.randomUUID(), serverId: server.id, name: "geral" };
    db.channels.push(generalChannel);

    persist();
    res.json(serverWithChannels(server));
  });

  app.post("/api/servers/join", requireAuth, (req, res) => {
    const { inviteCode } = req.body || {};
    const server = db.servers.find((s) => s.inviteCode === (inviteCode || "").trim());
    if (!server) return res.status(404).json({ error: "Código de convite inválido." });

    if (!server.members.includes(req.userId)) {
      server.members.push(req.userId);
      persist();
    }
    res.json(serverWithChannels(server));
  });

  app.patch("/api/servers/:serverId", requireAuth, (req, res) => {
    const server = db.servers.find((s) => s.id === req.params.serverId);
    if (!server || !server.members.includes(req.userId)) {
      return res.status(403).json({ error: "Você não faz parte desse servidor." });
    }
    if (server.ownerId !== req.userId) {
      return res.status(403).json({ error: "Só o dono do servidor pode mudar o ícone." });
    }
    const { iconDataUrl } = req.body || {};
    if (typeof iconDataUrl === "string") {
      if (!iconDataUrl.startsWith("data:image/")) {
        return res.status(400).json({ error: "Imagem inválida." });
      }
      server.iconDataUrl = iconDataUrl;
      persist();
    }
    res.json(serverWithChannels(server));
  });

  app.post("/api/servers/:serverId/channels", requireAuth, (req, res) => {
    const server = db.servers.find((s) => s.id === req.params.serverId);
    if (!server || !server.members.includes(req.userId)) {
      return res.status(403).json({ error: "Você não faz parte desse servidor." });
    }
    const { name } = req.body || {};
    if (!name || !name.trim()) return res.status(400).json({ error: "Dê um nome ao canal." });

    const channel = { id: crypto.randomUUID(), serverId: server.id, name: name.trim() };
    db.channels.push(channel);
    persist();
    res.json(channel);
  });

  // ---------- Amigos ----------

  app.get("/api/friends", requireAuth, (req, res) => {
    const myId = req.userId;
    const accepted = db.friendRequests.filter(
      (r) => r.status === "accepted" && (r.fromUserId === myId || r.toUserId === myId)
    );
    const friends = accepted.map((r) => {
      const otherId = r.fromUserId === myId ? r.toUserId : r.fromUserId;
      const otherUser = db.users.find((u) => u.id === otherId);
      return otherUser ? publicUser(otherUser) : null;
    }).filter(Boolean);

    const incoming = db.friendRequests
      .filter((r) => r.status === "pending" && r.toUserId === myId)
      .map((r) => {
        const fromUser = db.users.find((u) => u.id === r.fromUserId);
        return { requestId: r.id, user: fromUser ? publicUser(fromUser) : null };
      })
      .filter((r) => r.user);

    const outgoing = db.friendRequests
      .filter((r) => r.status === "pending" && r.fromUserId === myId)
      .map((r) => {
        const toUser = db.users.find((u) => u.id === r.toUserId);
        return { requestId: r.id, user: toUser ? publicUser(toUser) : null };
      })
      .filter((r) => r.user);

    res.json({ friends, incoming, outgoing });
  });

  app.post("/api/friends/request", requireAuth, (req, res) => {
    const { username } = req.body || {};
    const target = db.users.find(
      (u) => u.username.toLowerCase() === (username || "").trim().toLowerCase()
    );
    if (!target) return res.status(404).json({ error: "Usuário não encontrado." });
    if (target.id === req.userId) return res.status(400).json({ error: "Você não pode adicionar você mesmo." });

    const existing = db.friendRequests.find(
      (r) =>
        ((r.fromUserId === req.userId && r.toUserId === target.id) ||
          (r.fromUserId === target.id && r.toUserId === req.userId)) &&
        r.status !== "declined"
    );
    if (existing) {
      if (existing.status === "accepted") return res.status(400).json({ error: "Vocês já são amigos." });
      if (existing.fromUserId === target.id) {
        // a outra pessoa já tinha te chamado - aceita automaticamente
        existing.status = "accepted";
        persist();
        return res.json({ ok: true, autoAccepted: true });
      }
      return res.status(400).json({ error: "Pedido já enviado, aguardando resposta." });
    }

    db.friendRequests.push({
      id: crypto.randomUUID(),
      fromUserId: req.userId,
      toUserId: target.id,
      status: "pending",
      createdAt: Date.now(),
    });
    persist();
    res.json({ ok: true });
  });

  app.post("/api/friends/:requestId/accept", requireAuth, (req, res) => {
    const request = db.friendRequests.find((r) => r.id === req.params.requestId);
    if (!request || request.toUserId !== req.userId || request.status !== "pending") {
      return res.status(404).json({ error: "Pedido não encontrado." });
    }
    request.status = "accepted";
    persist();
    res.json({ ok: true });
  });

  app.post("/api/friends/:requestId/decline", requireAuth, (req, res) => {
    const request = db.friendRequests.find((r) => r.id === req.params.requestId);
    if (!request || (request.toUserId !== req.userId && request.fromUserId !== req.userId)) {
      return res.status(404).json({ error: "Pedido não encontrado." });
    }
    db.friendRequests = db.friendRequests.filter((r) => r.id !== req.params.requestId);
    persist();
    res.json({ ok: true });
  });



  function channelIfMember(channelId, userId) {
    const channel = db.channels.find((c) => c.id === channelId);
    if (!channel) return null;
    const server = db.servers.find((s) => s.id === channel.serverId);
    if (!server || !server.members.includes(userId)) return null;
    return channel;
  }

  app.get("/api/channels/:channelId/messages", requireAuth, (req, res) => {
    if (!channelIfMember(req.params.channelId, req.userId)) {
      return res.status(403).json({ error: "Você não tem acesso a esse canal." });
    }
    const msgs = db.messages
      .filter((m) => m.channelId === req.params.channelId)
      .slice(-100); // só as últimas 100, pra não ficar pesado
    res.json(msgs);
  });

  // ---------- WebSocket: chat em tempo real + sinalização WebRTC ----------
  // "callRooms" cuida da chamada de vídeo/tela - agora suporta várias
  // pessoas ao mesmo tempo: cada pessoa se conecta diretamente com
  // todas as outras (por isso funciona bem até uns 4-5 participantes).
  // "chatSubscribers" cuida do chat de texto (qualquer número de gente).
  // O vídeo em si NUNCA passa por este servidor - só ajuda a conectar.

  const server = http.createServer(app);
  const wss = new WebSocketServer({ server });

  const callRooms = new Map(); // channelId -> Map<peerId, ws>
  const chatSubscribers = new Map(); // channelId -> Set de conexoes

  function send(ws, msg) {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
  }

  wss.on("connection", (ws, req) => {
    const url = new URL(req.url, "http://localhost");
    const token = url.searchParams.get("token");
    const userId = sessions.get(token);
    if (!userId) {
      ws.close();
      return;
    }
    const author = db.users.find((u) => u.id === userId);
    ws.userId = userId;
    ws.username = author ? author.username : "?";
    ws.peerId = crypto.randomUUID();
    ws.channelId = null;

    ws.on("message", (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw);
      } catch {
        return;
      }

      if (msg.type === "enter-channel") {
        const channel = db.channels.find((c) => c.id === msg.channelId);
        if (!channel) return send(ws, { type: "error", message: "Canal não encontrado." });

        ws.channelId = msg.channelId;

        // inscreve pro chat (sem limite de pessoas)
        let subs = chatSubscribers.get(msg.channelId);
        if (!subs) {
          subs = new Set();
          chatSubscribers.set(msg.channelId, subs);
        }
        subs.add(ws);

        // entra na sala de chamada (sem limite de pessoas agora)
        let room = callRooms.get(msg.channelId);
        if (!room) {
          room = new Map();
          callRooms.set(msg.channelId, room);
        }

        const existingPeers = [...room.values()].map((peer) => ({
          id: peer.peerId,
          username: peer.username,
        }));

        room.set(ws.peerId, ws);

        send(ws, {
          type: "entered",
          channelId: msg.channelId,
          selfId: ws.peerId,
          peers: existingPeers,
        });

        for (const peer of room.values()) {
          if (peer !== ws) {
            send(peer, { type: "peer-joined", id: ws.peerId, username: ws.username });
          }
        }
        return;
      }

      if (msg.type === "chat-message") {
        if (!channelIfMember(msg.channelId, ws.userId)) return;
        const text = (msg.text || "").trim().slice(0, 2000);
        if (!text) return;

        const author = db.users.find((u) => u.id === ws.userId);
        const message = {
          id: crypto.randomUUID(),
          channelId: msg.channelId,
          userId: ws.userId,
          username: author ? author.username : "?",
          avatarDataUrl: author ? author.avatarDataUrl || null : null,
          text,
          createdAt: Date.now(),
        };
        db.messages.push(message);
        persist();

        const subs = chatSubscribers.get(msg.channelId);
        if (subs) {
          for (const peer of subs) send(peer, { type: "chat-message", message });
        }
        return;
      }

      if (["offer", "answer", "ice-candidate"].includes(msg.type)) {
        const room = callRooms.get(ws.channelId);
        if (!room) return;
        const target = room.get(msg.target);
        if (target) send(target, { ...msg, from: ws.peerId });
      }
    });

    ws.on("close", () => {
      const room = callRooms.get(ws.channelId);
      if (room) {
        room.delete(ws.peerId);
        for (const peer of room.values()) send(peer, { type: "peer-left", id: ws.peerId });
        if (room.size === 0) callRooms.delete(ws.channelId);
      }
      const subs = chatSubscribers.get(ws.channelId);
      if (subs) {
        subs.delete(ws);
        if (subs.size === 0) chatSubscribers.delete(ws.channelId);
      }
    });
  });

  return new Promise((resolve) => {
    server.listen(port, () => {
      console.log(`Servidor rodando em http://localhost:${port}`);
      resolve(server);
    });
  });
}

module.exports = { startServer };

if (require.main === module) {
  startServer(process.env.PORT || 3000);
}
