// Banco de dados permanente usando MongoDB Atlas. Guardamos tudo (usuarios,
// servidores, canais, mensagens) como UM documento so dentro de uma
// colecao - assim o resto do codigo do servidor continua tratando os
// dados como um objeto simples (db.users, db.servers etc), igual antes,
// só que agora isso sobrevive a reinicios e atualizacoes.

const { MongoClient } = require("mongodb");

const uri = process.env.MONGODB_URI;
let client = null;
let collectionPromise = null;

function getCollection() {
  if (!uri) {
    throw new Error(
      "MONGODB_URI não configurada. Adicione essa variável de ambiente no Render (aba Environment) com a string de conexão do MongoDB Atlas."
    );
  }
  if (!collectionPromise) {
    client = new MongoClient(uri);
    collectionPromise = client.connect().then(() => client.db("telalive").collection("state"));
  }
  return collectionPromise;
}

async function loadDB() {
  const collection = await getCollection();
  const doc = await collection.findOne({ _id: "singleton" });
  if (doc) {
    delete doc._id;
    if (!doc.users) doc.users = [];
    if (!doc.servers) doc.servers = [];
    if (!doc.channels) doc.channels = [];
    if (!doc.messages) doc.messages = [];
    if (!doc.friendRequests) doc.friendRequests = [];
    if (!doc.categories) doc.categories = [];
    return doc;
  }
  return { users: [], servers: [], channels: [], messages: [], friendRequests: [], categories: [] };
}

async function saveDB(db) {
  const collection = await getCollection();
  await collection.replaceOne({ _id: "singleton" }, { _id: "singleton", ...db }, { upsert: true });
}

module.exports = { loadDB, saveDB };
