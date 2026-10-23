// Banco de dados permanente usando MongoDB Atlas.
//
// - Contas, servidores, canais, categorias, amigos etc. ficam num documento
//   só ("state"), como antes (são poucos dados).
// - As MENSAGENS (que podem ter foto e áudio, ou seja, pesam muito) ficam
//   numa coleção separada, uma mensagem por registro. Assim não existe mais
//   o limite de 16 MB do documento único, e salvar uma mensagem nova não
//   precisa reescrever o banco inteiro.

const { MongoClient } = require("mongodb");

const uri = process.env.MONGODB_URI;
let client = null;
let dbPromise = null;

function getDb() {
  if (!uri) {
    throw new Error(
      "MONGODB_URI não configurada. Adicione essa variável de ambiente no Render (aba Environment) com a string de conexão do MongoDB Atlas."
    );
  }
  if (!dbPromise) {
    client = new MongoClient(uri);
    dbPromise = client.connect().then(async () => {
      const database = client.db("telalive");
      await database.collection("messages").createIndex({ channelId: 1, createdAt: 1 });
      return database;
    });
  }
  return dbPromise;
}

async function stateCollection() {
  return (await getDb()).collection("state");
}

async function messagesCollection() {
  return (await getDb()).collection("messages");
}

function stripId(doc) {
  if (!doc) return null;
  const { _id, ...rest } = doc;
  return rest;
}

async function loadDB() {
  const state = await stateCollection();
  const doc = await state.findOne({ _id: "singleton" });
  const data = doc || {};
  delete data._id;

  data.users = data.users || [];
  data.servers = data.servers || [];
  data.channels = data.channels || [];
  data.friendRequests = data.friendRequests || [];
  data.categories = data.categories || [];
  data.dmChannels = data.dmChannels || [];

  // Migração: se ainda existirem mensagens guardadas do jeito antigo (dentro
  // do documento único), move todas pra coleção nova antes de continuar.
  if (Array.isArray(data.messages) && data.messages.length > 0) {
    const messages = await messagesCollection();
    try {
      await messages.insertMany(
        data.messages.map((m) => ({ _id: m.id, ...m })),
        { ordered: false }
      );
    } catch (err) {
      const onlyDuplicates =
        err.code === 11000 ||
        (Array.isArray(err.writeErrors) && err.writeErrors.every((e) => e.code === 11000));
      if (!onlyDuplicates) throw err; // não segue em frente se a migração falhou (pra não perder mensagem)
    }
    await state.updateOne({ _id: "singleton" }, { $unset: { messages: "" } });
    console.log(`Migradas ${data.messages.length} mensagens antigas pra coleção nova.`);
  }
  delete data.messages;

  return data;
}

async function saveDB(db) {
  const state = await stateCollection();
  const { messages, ...rest } = db; // mensagens NÃO vão mais nesse documento
  await state.replaceOne({ _id: "singleton" }, { _id: "singleton", ...rest }, { upsert: true });
}

// ---------- Mensagens ----------

async function insertMessage(message) {
  const col = await messagesCollection();
  await col.insertOne({ _id: message.id, ...message });
}

async function getMessage(id) {
  const col = await messagesCollection();
  return stripId(await col.findOne({ _id: id }));
}

async function getChannelMessages(channelId, limit = 100) {
  const col = await messagesCollection();
  const docs = await col.find({ channelId }).sort({ createdAt: -1 }).limit(limit).toArray();
  return docs.reverse().map(stripId);
}

async function updateMessage(id, fields) {
  const col = await messagesCollection();
  await col.updateOne({ _id: id }, { $set: fields });
}

async function deleteMessageById(id) {
  const col = await messagesCollection();
  await col.deleteOne({ _id: id });
}

async function deleteChannelMessages(channelId) {
  const col = await messagesCollection();
  await col.deleteMany({ channelId });
}

module.exports = {
  loadDB,
  saveDB,
  insertMessage,
  getMessage,
  getChannelMessages,
  updateMessage,
  deleteMessageById,
  deleteChannelMessages,
};
