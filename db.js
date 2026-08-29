// Banco de dados bem simples guardado num arquivo JSON. Pra um app
// pequeno como esse, isso evita ter que instalar um banco de dados de
// verdade (Postgres, MySQL etc) - o que seria complicado demais por
// enquanto. Quando o app crescer, isso pode ser trocado por um banco
// real sem mudar muita coisa no resto do codigo.

const fs = require("fs");
const path = require("path");

const DB_PATH = path.join(__dirname, "data", "db.json");

function loadDB() {
  try {
    const raw = fs.readFileSync(DB_PATH, "utf-8");
    const data = JSON.parse(raw);
    if (!data.messages) data.messages = [];
    return data;
  } catch {
    return { users: [], servers: [], channels: [], messages: [] };
  }
}

function saveDB(db) {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
}

module.exports = { loadDB, saveDB };
