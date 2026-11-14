// 로컬 실행용 서버: public/ 정적 파일 + POST /api/judge
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { handleJudge } from "./lib/judge.js";

const ROOT = fileURLToPath(new URL(".", import.meta.url));
const PUBLIC = join(ROOT, "public");
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
};

// IP당 분당 요청 수 제한 (API 비용 보호)
const hits = new Map();
function rateLimited(ip) {
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < 60_000);
  recent.push(now);
  hits.set(ip, recent);
  return recent.length > 20;
}

async function readJson(req) {
  let data = "";
  for await (const chunk of req) {
    data += chunk;
    if (data.length > 20_000) throw new Error("too large");
  }
  return JSON.parse(data || "{}");
}

const send = (res, status, json) => {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(json));
};

const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");

  if (url.pathname === "/api/judge") {
    if (req.method !== "POST") return send(res, 405, { error: "POST만 받아요." });
    if (rateLimited(req.socket.remoteAddress)) {
      return send(res, 429, { error: "너무 빨라요. 잠시 숨을 고르고 다시 외워 주세요." });
    }
    let body;
    try {
      body = await readJson(req);
    } catch {
      return send(res, 400, { error: "요청을 읽을 수 없어요." });
    }
    const { status, json } = await handleJudge(body);
    return send(res, status, json);
  }

  const rel = url.pathname === "/" ? "/index.html" : url.pathname;
  const file = normalize(join(PUBLIC, rel));
  if (!file.startsWith(PUBLIC)) return send(res, 403, { error: "forbidden" });
  try {
    const data = await readFile(file);
    res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" });
    res.end(data);
  } catch {
    send(res, 404, { error: "not found" });
  }
});

const port = Number(process.env.PORT) || 3000;
server.listen(port, () => {
  const mode = process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN
    ? "AI 판정"
    : "연습 모드 (ANTHROPIC_API_KEY 없음)";
  console.log(`말로 하는 마법 대결 → http://localhost:${port}  [${mode}]`);
});
