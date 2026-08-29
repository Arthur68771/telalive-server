const express = require("express");
const http = require("http");
const { WebSocketServer } = require("ws");
const path = require("path");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const { loadDB, saveDB } = require("./db");

function startServer(port = 3000) {
  const db = loadDB();

  // token -> userId (fica só na memória; ao reiniciar o servidor, todo
  // mundo precisa logar de novo - da pra evoluir isso depois)
  const sessions = new Map();

  const app = express();
  app.use(express.json());
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
    return { id: user.id, username: user.username };
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
    saveDB(db);

    const token = crypto.randomBytes(24).toString("hex");
    sessions.set(token, user.id);
    res.json({ token, user: publicUser(user) });
  });

  app.post("/api/login", async (req, res) => {
    const { username, password } = req.body || {};
    const user = db.users.find((u) => u.username.toLowerCase() === (username || "").trim().toLowerCase());
    if (!user || !(await bcrypt.compare(password || "", user.passwordHash))) {
      return res.status(401).json({ error: "Usuário ou senha incorretos." });
    }
    const token = crypto.randomBytes(24).toString("hex");
    sessions.set(token, user.id);
    res.json({ token, user: publicUser(user) });
  });

  app.get("/api/me", requireAuth, (req, res) => {
    const user = db.users.find((u) => u.id === req.userId);
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

    saveDB(db);
    res.json(serverWithChannels(server));
  });

  app.post("/api/servers/join", requireAuth, (req, res) => {
    const { inviteCode } = req.body || {};
    const server = db.servers.find((s) => s.inviteCode === (inviteCode || "").trim());
    if (!server) return res.status(404).json({ error: "Código de convite inválido." });

    if (!server.members.includes(req.userId)) {
      server.members.push(req.userId);
      saveDB(db);
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
    saveDB(db);
    res.json(channel);
  });

  // ---------- Mensagens de texto ----------

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
  // "callRooms" cuida só da chamada de vídeo/tela (máx. 2 pessoas).
  // "chatSubscribers" cuida do chat de texto (qualquer número de pessoas
  // que estiverem com aquele canal aberto recebem as mensagens na hora).
  // O vídeo em si NUNCA passa por este servidor - só ajuda a conectar.

  const server = http.createServer(app);
  const wss = new WebSocketServer({ server });

  const callRooms = new Map(); // channelId -> Set de conexoes (máx 2)
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
    ws.userId = userId;
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

        // tenta entrar na sala de chamada (limite de 2 pessoas)
        let room = callRooms.get(msg.channelId);
        if (!room) {
          room = new Set();
          callRooms.set(msg.channelId, room);
        }
        if (room.size >= 2) {
          send(ws, { type: "entered", channelId: msg.channelId });
          send(ws, { type: "room-full" });
          return;
        }
        room.add(ws);
        send(ws, { type: "entered", channelId: msg.channelId });
        for (const peer of room) {
          if (peer !== ws) {
            send(peer, { type: "peer-joined" });
            send(ws, { type: "peer-joined" });
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
          text,
          createdAt: Date.now(),
        };
        db.messages.push(message);
        saveDB(db);

        const subs = chatSubscribers.get(msg.channelId);
        if (subs) {
          for (const peer of subs) send(peer, { type: "chat-message", message });
        }
        return;
      }

      if (["offer", "answer", "ice-candidate"].includes(msg.type)) {
        const room = callRooms.get(ws.channelId);
        if (!room) return;
        for (const peer of room) {
          if (peer !== ws) send(peer, msg);
        }
      }
    });

    ws.on("close", () => {
      const room = callRooms.get(ws.channelId);
      if (room) {
        room.delete(ws);
        for (const peer of room) send(peer, { type: "peer-left" });
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
