const { MongoClient } = require("mongodb");

const uri = process.env.MONGODB_URI;
let client = null;
let dbPromise = null;

function getDb() {
  if (!uri) {
    throw new Error("MONGODB_URI não configurada. Adicione essa variável de ambiente no Render.");
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

async function stateCollection() { return (await getDb()).collection("state"); }
async function messagesCollection() { return (await getDb()).collection("messages"); }
async function mediaCollection() { return (await getDb()).collection("media"); }

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

  if (Array.isArray(data.messages) && data.messages.length > 0) {
    const messages = await messagesCollection();
    try {
      await messages.insertMany(data.messages.map((m) => ({ _id: m.id, ...m })), { ordered: false });
    } catch (err) {}
    await state.updateOne({ _id: "singleton" }, { $unset: { messages: "" } });
  }
  delete data.messages;
  return data;
}

async function saveDB(db) {
  const state = await stateCollection();
  const { messages, ...rest } = db;
  await state.replaceOne({ _id: "singleton" }, { _id: "singleton", ...rest }, { upsert: true });
}

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

async function getChannelMessagesPaginated(query, limit = 50) {
  const col = await messagesCollection();
  const docs = await col.find(query).sort({ createdAt: -1 }).limit(limit).toArray();
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
  const videoIds = (await col.distinct("videoId", { channelId })).filter(Boolean);
  await col.deleteMany({ channelId });
  return videoIds;
}

async function insertMedia({ id, ownerId, channelId, contentType, size, dataB64 }) {
  const col = await mediaCollection();
  await col.insertOne({ _id: id, ownerId, channelIds: [channelId], contentType, size, dataB64, createdAt: Date.now() });
}

async function getMediaMeta(id) {
  const col = await mediaCollection();
  return stripId(await col.findOne({ _id: id }, { projection: { dataB64: 0 } }));
}

async function getMediaData(id) {
  const col = await mediaCollection();
  const doc = await col.findOne({ _id: id });
  if (!doc) return null;
  const { dataB64, ...meta } = stripId(doc);
  return { ...meta, buffer: Buffer.from(dataB64, "base64") };
}

async function addMediaChannel(id, channelId) {
  const col = await mediaCollection();
  await col.updateOne({ _id: id }, { $addToSet: { channelIds: channelId } });
}

async function deleteMediaIfUnused(id) {
  const messages = await messagesCollection();
  if ((await messages.countDocuments({ videoId: id })) === 0 && (await messages.countDocuments({ fileId: id })) === 0) {
    const col = await mediaCollection();
    await col.deleteOne({ _id: id });
  }
}

module.exports = {
  loadDB, saveDB, insertMessage, getMessage, getChannelMessages, getChannelMessagesPaginated,
  updateMessage, deleteMessageById, deleteChannelMessages, insertMedia, getMediaMeta, getMediaData,
  addMediaChannel, deleteMediaIfUnused,
};
