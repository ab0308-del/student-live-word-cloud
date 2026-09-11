import http from "node:http";
import worker from "../worker/index.js";

const records = [];
let setting = { question: "用一個詞說說，你想到『空氣』時會想到什麼？", isOpen: 1, updatedAt: new Date().toISOString() };

function statement(sql) {
  let values = [];
  return {
    bind(...next) { values = next; return this; },
    async first() {
      if (sql.includes("COUNT(*)")) return { count: records.length };
      if (sql.includes("FROM settings")) return setting;
      return null;
    },
    async all() {
      if (sql.includes("GROUP BY answer")) {
        const counts = new Map();
        for (const row of records) counts.set(row.answer, (counts.get(row.answer) || 0) + 1);
        return { results: [...counts].map(([answer, count]) => ({ answer, count })).sort((a, b) => b.count - a.count) };
      }
      return { results: records.map((row, index) => ({ id: index + 1, studentName: row.name, answer: row.answer, createdAt: row.createdAt })) };
    },
    async run() {
      if (sql.startsWith("INSERT INTO responses")) records.push({ answer: values[0], name: values[1], createdAt: new Date().toISOString() });
      if (sql.startsWith("DELETE FROM responses")) records.length = 0;
      if (sql.startsWith("INSERT INTO settings")) {
        if (sql.includes("question = excluded.question")) setting = { question: values[0], isOpen: 1, updatedAt: new Date().toISOString() };
        else setting.isOpen = values[1];
      }
      return { success: true };
    },
  };
}

const env = { ADMIN_PIN: "2468", DB: { prepare: statement, async batch(items) { for (const item of items) await item.run(); } } };
const port = Number(process.env.PORT || 4173);
const server = http.createServer(async (req, res) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = Buffer.concat(chunks);
  const request = new Request(`http://127.0.0.1:${port}${req.url}`, { method: req.method, headers: req.headers, body: ["GET", "HEAD"].includes(req.method) ? undefined : body });
  const response = await worker.fetch(request, env);
  res.writeHead(response.status, Object.fromEntries(response.headers));
  res.end(Buffer.from(await response.arrayBuffer()));
});
server.listen(port, "127.0.0.1", () => console.log(`Local: http://127.0.0.1:${port}`));
