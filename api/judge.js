// Vercel 서버리스 함수: POST /api/judge
import { handleJudge } from "../lib/judge.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "POST만 받아요." });
    return;
  }
  const { status, json } = await handleJudge(req.body);
  res.status(status).json(json);
}
