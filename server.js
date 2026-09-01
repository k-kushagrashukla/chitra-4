// Load environment variables from either .env or .env.local — the latter is a
// common habit from Next.js projects, and Node's dotenv doesn't read it by
// default, so we explicitly cover both instead of relying on people renaming files.
require("dotenv").config();
require("dotenv").config({ path: ".env.local" });
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");
const { getRandomWords } = require("./words");
const { getSpeedSketchRound } = require("./speed-sketch-words");
const { getChallengeWord } = require("./challenge-words");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// ---------- Usage stats (private, for you only) ----------
// Simple in-memory counters — no database needed for this stage. They reset
// when the server restarts (e.g. on a redeploy), which is a known limitation
// worth knowing: this tells you "usage since last restart", not lifetime totals.
const stats = {
  serverStartedAt: Date.now(),
  totalConnectionsEver: 0,
  totalGamesStarted: 0,
  totalSpeedSketchJudged: 0,
  totalChallengesCreated: 0,
  totalChallengeAttempts: 0,
};

app.use(express.static(path.join(__dirname, "public"), {
  // Without this, browsers (mobile Chrome especially) can keep serving an old
  // cached copy of client.js/style.css after a redeploy — meaning a fixed bug
  // can still show up for someone whose browser hasn't re-fetched the file yet.
  // no-cache forces a fresh check on every load without fully disabling caching.
  setHeaders: (res) => res.setHeader("Cache-Control", "no-cache"),
}));
app.use(express.json({ limit: "6mb" })); // canvas snapshots are small PNGs but give headroom

// ---------- Speed Sketch: word for a given round ----------
app.get("/api/speed-sketch/prompt/:difficulty", (req, res) => {
  const { difficulty } = req.params;
  if (!["easy", "medium", "hard"].includes(difficulty)) {
    return res.status(400).json({ error: "difficulty must be easy, medium, or hard" });
  }
  res.json(getSpeedSketchRound(difficulty));
});

// ---------- Speed Sketch: AI judges a finished drawing ----------
app.post("/api/speed-sketch/judge", async (req, res) => {
  const { imageBase64, prompt, seconds } = req.body || {};
  if (!imageBase64 || !prompt) {
    return res.status(400).json({ error: "Missing imageBase64 or prompt" });
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: "ANTHROPIC_API_KEY is not set on the server" });
  }

  try {
    const apiResponse = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-5",
        max_tokens: 200,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image",
                source: { type: "base64", media_type: "image/png", data: imageBase64 },
              },
              {
                type: "text",
                text:
                  `Someone drew this in about ${seconds || "a few"} seconds. The prompt was "${prompt}". ` +
                  `Judge it in two steps, in this order:\n` +
                  `1. Recognizability (this matters most): if you saw this drawing with no context, could you tell it's "${prompt}"? ` +
                  `If it's genuinely not recognizable as "${prompt}" — even if the linework itself is neat or confident — cap the score at 3 or below. ` +
                  `Don't let clean execution alone rescue a drawing that doesn't actually resemble the prompt.\n` +
                  `2. Only if it IS recognizable as "${prompt}": give bonus points for how well it's drawn (proportions, detail, confident linework) on top of the recognizability score.\n` +
                  `Be generous about *speed* (this was drawn in seconds, not an art contest) but strict about whether it actually looks like "${prompt}" — those are different things. ` +
                  `Reply with ONLY raw JSON, no markdown fences, in exactly this shape: ` +
                  `{"score": <integer 0-10>, "verdict": "<one short, funny, encouraging sentence, in a mix of English and Hinglish, never mean, no em-dashes>"}`,
              },
            ],
          },
        ],
      }),
    });

    const data = await apiResponse.json();
    const textBlock = (data.content || []).find((c) => c.type === "text");
    const raw = (textBlock?.text || "").replace(/```json|```/g, "").trim();

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = { score: 5, verdict: "Couldn't quite judge that one, but hey, you drew something!" };
    }
    stats.totalSpeedSketchJudged += 1;
    res.json(parsed);
  } catch (err) {
    console.error("Speed Sketch judging failed:", err);
    res.status(500).json({ error: "Judging failed" });
  }
});

// ---------- Challenge link: "Let's See Your Drawing Mister" ----------
// In-memory is fine for now — challenges are meant to be attempted quickly
// after being sent, not stored forever. They're cleared after ~24h.
const challenges = {}; // id -> { word, hint, seconds, createdAt }
const CHALLENGE_TTL_MS = 24 * 60 * 60 * 1000;
setInterval(() => {
  const now = Date.now();
  for (const id in challenges) {
    if (now - challenges[id].createdAt > CHALLENGE_TTL_MS) delete challenges[id];
  }
}, 60 * 60 * 1000); // sweep hourly

function makeChallengeId() {
  return Math.random().toString(36).slice(2, 8); // short, WhatsApp-link-friendly
}

app.post("/api/challenge/create", (req, res) => {
  const id = makeChallengeId();
  const prompt = getChallengeWord();
  challenges[id] = { ...prompt, createdAt: Date.now() };
  stats.totalChallengesCreated += 1;
  res.json({ id, ...prompt });
});

app.get("/api/challenge/:id", (req, res) => {
  const challenge = challenges[req.params.id];
  if (!challenge || Date.now() - challenge.createdAt > CHALLENGE_TTL_MS) {
    return res.status(404).json({ error: "This challenge link has expired or doesn't exist." });
  }
  res.json(challenge);
});

// Binary pass/fail judging — deliberately stricter and simpler than Speed
// Sketch's 0-10 score, since a challenge is meant to feel like a clear win or
// a clear (funny) loss, not a graded score.
app.post("/api/challenge/:id/judge", async (req, res) => {
  const challenge = challenges[req.params.id];
  if (!challenge) return res.status(404).json({ error: "Challenge not found." });

  const { imageBase64, name } = req.body || {};
  if (!imageBase64 || !name) {
    return res.status(400).json({ error: "Missing imageBase64 or name" });
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: "ANTHROPIC_API_KEY is not set on the server" });
  }

  try {
    const apiResponse = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-5",
        max_tokens: 150,
        messages: [
          {
            role: "user",
            content: [
              { type: "image", source: { type: "base64", media_type: "image/png", data: imageBase64 } },
              {
                type: "text",
                text:
                  `This was drawn in ${challenge.seconds} seconds for a drawing challenge. The prompt was "${challenge.word}". ` +
                  `Decide PASS or FAIL: PASS only if you'd genuinely recognize this as "${challenge.word}" without being told. ` +
                  `Be strict — this is meant to be a hard challenge, not a participation trophy. ` +
                  `Reply with ONLY raw JSON, no markdown fences: {"passed": <true or false>, "verdict": "<one short, funny sentence, mix of English/Hinglish, never mean, celebrating a pass or gently roasting a fail, no em-dashes>"}`,
              },
            ],
          },
        ],
      }),
    });
    const data = await apiResponse.json();
    const textBlock = (data.content || []).find((c) => c.type === "text");
    const raw = (textBlock?.text || "").replace(/```json|```/g, "").trim();
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = { passed: false, verdict: "Couldn't judge that one, give it another go!" };
    }
    stats.totalChallengeAttempts += 1;
    res.json(parsed);
  } catch (err) {
    console.error("Challenge judging failed:", err);
    res.status(500).json({ error: "Judging failed" });
  }
});

// A challenge link like /challenge/abc123 should load the app itself — the
// client reads the id out of the URL and shows the attempt screen directly.
app.get("/challenge/:id", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// ---------- Private admin dashboard (you only) ----------
// Protected by a password in the URL, not indexed/linked anywhere on the
// public site. Set ADMIN_KEY in your .env — without it, this route refuses
// to work at all, so it's never accidentally left wide open.
function checkAdminKey(req, res) {
  if (!process.env.ADMIN_KEY) {
    res.status(500).send("Set ADMIN_KEY in your .env to use the admin dashboard.");
    return false;
  }
  if (req.query.key !== process.env.ADMIN_KEY) {
    res.status(403).send("Wrong or missing key. Add ?key=YOUR_ADMIN_KEY to the URL.");
    return false;
  }
  return true;
}

app.get("/admin/stats", (req, res) => {
  if (!checkAdminKey(req, res)) return;
  res.json({
    liveUsersRightNow: io.engine.clientsCount,
    liveRoomsRightNow: Object.keys(rooms).length,
    totalConnectionsSinceRestart: stats.totalConnectionsEver,
    totalGamesStartedSinceRestart: stats.totalGamesStarted,
    totalSpeedSketchJudgedSinceRestart: stats.totalSpeedSketchJudged,
    totalChallengesCreatedSinceRestart: stats.totalChallengesCreated,
    totalChallengeAttemptsSinceRestart: stats.totalChallengeAttempts,
    serverUptimeMinutes: Math.round((Date.now() - stats.serverStartedAt) / 60000),
  });
});

app.get("/admin", (req, res) => {
  if (!checkAdminKey(req, res)) return;
  const key = encodeURIComponent(req.query.key);
  res.send(`<!DOCTYPE html>
<html><head><title>Chitra Admin</title>
<style>
  body { font-family: monospace; background: #1a1410; color: #f7f1df; padding: 30px; }
  h1 { color: #b23a2e; }
  .stat { font-size: 1.3rem; margin: 10px 0; }
  .stat b { color: #f7f1df; }
  .label { opacity: 0.6; font-size: 0.85rem; }
</style></head>
<body>
  <h1>Chitra — Live Stats</h1>
  <div id="stats">Loading…</div>
  <p class="label">Auto-refreshes every 5s. Counts reset if the server restarts (e.g. on redeploy).</p>
  <script>
    async function refresh() {
      const res = await fetch('/admin/stats?key=${key}');
      const s = await res.json();
      document.getElementById('stats').innerHTML = \`
        <div class="stat">🟢 Live users right now: <b>\${s.liveUsersRightNow}</b></div>
        <div class="stat">🏠 Live rooms right now: <b>\${s.liveRoomsRightNow}</b></div>
        <div class="stat">👥 Total connections since restart: <b>\${s.totalConnectionsSinceRestart}</b></div>
        <div class="stat">🎮 Games started since restart: <b>\${s.totalGamesStartedSinceRestart}</b></div>
        <div class="stat">🎨 Speed Sketch drawings judged: <b>\${s.totalSpeedSketchJudgedSinceRestart}</b></div>
        <div class="stat">🔗 Challenge links created: <b>\${s.totalChallengesCreatedSinceRestart}</b></div>
        <div class="stat">✅ Challenge attempts judged: <b>\${s.totalChallengeAttemptsSinceRestart}</b></div>
        <div class="stat">⏱️ Server uptime: <b>\${s.serverUptimeMinutes} min</b></div>
      \`;
    }
    refresh();
    setInterval(refresh, 5000);
  </script>
</body></html>`);
});

const TURN_SECONDS = 70;
const WORD_CHOICE_SECONDS = 10;
const ROUNDS = 3;

// In-memory room store. Fine for MVP; swap for Redis if you need multi-instance scaling later.
const rooms = {}; // roomId -> room state

function createRoom(roomId) {
  rooms[roomId] = {
    id: roomId,
    players: [], // {id, name, score, hasGuessed}
    hostId: null,
    currentDrawerIndex: -1,
    currentWord: null,
    round: 1,
    phase: "lobby", // lobby | choosing | drawing | roundEnd | gameEnd
    timer: null,
    timeLeft: 0,
  };
  return rooms[roomId];
}

function getRoom(roomId) {
  return rooms[roomId] || createRoom(roomId);
}

function publicPlayers(room) {
  return room.players.map((p) => ({
    id: p.id,
    name: p.name,
    score: p.score,
    isDrawing: room.players[room.currentDrawerIndex]?.id === p.id,
  }));
}

function broadcastState(room) {
  io.to(room.id).emit("state", {
    players: publicPlayers(room),
    phase: room.phase,
    round: room.round,
    totalRounds: ROUNDS,
    timeLeft: room.timeLeft,
    blank: room.currentWord ? room.currentWord.word.replace(/[a-zA-Z]/g, "_") : null,
    hostId: room.hostId,
  });
}

function clearTimer(room) {
  if (room.timer) {
    clearInterval(room.timer);
    room.timer = null;
  }
}

function startTimer(room, seconds, onEnd) {
  clearTimer(room);
  room.timeLeft = seconds;
  room.timer = setInterval(() => {
    room.timeLeft -= 1;
    broadcastState(room);
    if (room.timeLeft <= 0) {
      clearTimer(room);
      onEnd();
    }
  }, 1000);
}

function startChoosingPhase(room) {
  if (room.players.length < 2) {
    room.phase = "lobby";
    broadcastState(room);
    return;
  }

  // turnCount is the single source of truth for whose turn it is and which round
  // we're on — avoids the old bug where round incremented the moment index hit 0.
  room.turnCount = (room.turnCount ?? -1) + 1;
  room.round = Math.floor(room.turnCount / room.players.length) + 1;
  room.currentDrawerIndex = room.turnCount % room.players.length;

  if (room.round > ROUNDS) {
    clearTimer(room);
    room.phase = "gameEnd";
    const ranked = [...room.players].sort((a, b) => b.score - a.score);
    io.to(room.id).emit("gameOver", {
      players: ranked.map((p) => ({ name: p.name, score: p.score })),
    });
    broadcastState(room);
    return;
  }

  room.phase = "choosing";
  room.players.forEach((p) => (p.hasGuessed = false));
  room.currentWord = null;

  const choices = getRandomWords(3);
  const drawer = room.players[room.currentDrawerIndex];
  io.to(drawer.id).emit("wordChoices", choices);
  broadcastState(room);

  startTimer(room, WORD_CHOICE_SECONDS, () => {
    // Auto-pick first option if the drawer doesn't choose in time
    pickWord(room, choices[0]);
  });
}

function pickWord(room, wordObj) {
  clearTimer(room);
  room.currentWord = wordObj;
  room.phase = "drawing";

  const drawer = room.players[room.currentDrawerIndex];
  io.to(drawer.id).emit("yourWord", wordObj); // drawer sees English + hint
  io.to(room.id).except(drawer.id).emit("roundStarted"); // guessers just get notified

  broadcastState(room);

  startTimer(room, TURN_SECONDS, () => endTurn(room, "Time's up!"));
}

function endTurn(room, reason) {
  clearTimer(room);
  room.phase = "roundEnd";
  io.to(room.id).emit("turnEnded", {
    reason,
    word: room.currentWord ? room.currentWord.word : null,
    players: publicPlayers(room),
  });
  broadcastState(room);

  setTimeout(() => startChoosingPhase(room), 4000);
}

function allGuessed(room) {
  const guessers = room.players.filter((_, i) => i !== room.currentDrawerIndex);
  return guessers.length > 0 && guessers.every((p) => p.hasGuessed);
}

io.on("connection", (socket) => {
  stats.totalConnectionsEver += 1;
  socket.on("joinRoom", ({ roomId, name }) => {
    const room = getRoom(roomId);
    socket.join(roomId);
    room.players.push({ id: socket.id, name: name || "Player", score: 0, hasGuessed: false });
    if (!room.hostId) room.hostId = socket.id; // first player in an empty room is the host
    socket.data.roomId = roomId;
    broadcastState(room);
  });

  socket.on("startGame", () => {
    const room = rooms[socket.data.roomId];
    if (!room || room.phase !== "lobby") return;
    if (socket.id !== room.hostId) return; // only the host can start
    stats.totalGamesStarted += 1;
    room.round = 1;
    room.turnCount = -1;
    room.players.forEach((p) => (p.score = 0));
    startChoosingPhase(room);
  });

  socket.on("chooseWord", (wordObj) => {
    const room = rooms[socket.data.roomId];
    if (!room || room.phase !== "choosing") return;
    const drawer = room.players[room.currentDrawerIndex];
    if (drawer.id !== socket.id) return;
    pickWord(room, wordObj);
  });

  // Drawing strokes: broadcast as-is to everyone else in the room. Server doesn't
  // need to understand strokes, just relay them fast.
  socket.on("stroke", (strokeData) => {
    const room = rooms[socket.data.roomId];
    if (!room || room.phase !== "drawing") return;
    const drawer = room.players[room.currentDrawerIndex];
    if (!drawer || drawer.id !== socket.id) return;
    socket.to(room.id).emit("stroke", strokeData);
  });

  socket.on("clearCanvas", () => {
    const room = rooms[socket.data.roomId];
    if (!room) return;
    const drawer = room.players[room.currentDrawerIndex];
    if (!drawer || drawer.id !== socket.id) return;
    socket.to(room.id).emit("clearCanvas");
  });

  socket.on("guess", (text) => {
    const room = rooms[socket.data.roomId];
    if (!room || room.phase !== "drawing" || !room.currentWord) return;
    const player = room.players.find((p) => p.id === socket.id);
    if (!player || player.hasGuessed) return;
    const drawer = room.players[room.currentDrawerIndex];
    if (drawer.id === socket.id) return;

    const correct = text.trim().toLowerCase() === room.currentWord.word.toLowerCase();

    if (correct && !player.hasGuessed) {
      player.hasGuessed = true;
      const points = Math.max(10, Math.round((room.timeLeft / TURN_SECONDS) * 100));
      player.score += points;
      drawer.score += 20;
      io.to(room.id).emit("chatMessage", { name: player.name, text: "guessed the word!", system: true });
      io.to(room.id).emit("correctGuess", { name: player.name, points });
      broadcastState(room);

      if (allGuessed(room)) {
        endTurn(room, "Everyone guessed it!");
      }
    } else {
      io.to(room.id).emit("chatMessage", { name: player.name, text, system: false });
    }
  });

  socket.on("disconnect", () => {
    const roomId = socket.data.roomId;
    const room = rooms[roomId];
    if (!room) return;
    const idx = room.players.findIndex((p) => p.id === socket.id);
    if (idx === -1) return;

    const wasDrawing = idx === room.currentDrawerIndex;
    const wasHost = room.players[idx].id === room.hostId;
    room.players.splice(idx, 1);
    if (room.currentDrawerIndex > idx) room.currentDrawerIndex -= 1;

    if (room.players.length === 0) {
      clearTimer(room);
      delete rooms[roomId];
      return;
    }

    if (wasHost) room.hostId = room.players[0].id; // pass the crown to the next player

    if (wasDrawing) {
      endTurn(room, "Drawer left the game.");
    } else {
      broadcastState(room);
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Chitra running on http://localhost:${PORT}`));
