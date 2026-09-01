const socket = io();

// ---------- DOM ----------
const joinScreen = document.getElementById("joinScreen");
const gameScreen = document.getElementById("gameScreen");
const nameInput = document.getElementById("nameInput");
const roomInput = document.getElementById("roomInput");
roomInput.addEventListener("input", () => {
  roomInput.value = roomInput.value.replace(/\D/g, "");
});
const joinBtn = document.getElementById("joinBtn");
const roomLabel = document.getElementById("roomLabel");
const roundNum = document.getElementById("roundNum");
const totalRounds = document.getElementById("totalRounds");
const timerDisplay = document.getElementById("timerDisplay");
const playerList = document.getElementById("playerList");
const startBtn = document.getElementById("startBtn");
const boardStatus = document.getElementById("boardStatus");
const wordBlank = document.getElementById("wordBlank");
const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");
const chatMessages = document.getElementById("chatMessages");
const guessForm = document.getElementById("guessForm");
const guessInput = document.getElementById("guessInput");
const wordChoiceModal = document.getElementById("wordChoiceModal");
const wordChoicesDiv = document.getElementById("wordChoices");
const clearBtn = document.getElementById("clearBtn");

let myId = null;
let isDrawer = false;
let currentTool = "pen";
let roomId = null;

// ---------- Tool styles ----------
// Not a color picker — each tool is a real stationery item with its own fixed ink,
// same as it would be in your pencil box. No arbitrary color choice, just which item you pick up.
const TOOLS = {
  pen:    { width: 2.5, opacity: 1.0,  jitter: 0,   color: "31,78,140"  }, // ballpoint blue
  marker: { width: 8,   opacity: 1.0,  jitter: 0,   color: "32,28,24"   }, // gel pen black
  pencil: { width: 2,   opacity: 0.55, jitter: 0,   color: "50,45,40"   }, // pencil grey
  sketch: { width: 3,   opacity: 0.85, jitter: 2.2, color: "178,58,46"  }, // teacher's red pen
};

document.querySelectorAll(".tool[data-tool]").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tool[data-tool]").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    currentTool = btn.dataset.tool;
  });
});

// ---------- Canvas setup ----------
// Every stroke of the CURRENT turn lives here (fractional 0-1 form, same as
// what's sent over the socket). Mobile browsers fire "resize" far more often
// than desktop ones (address bar hiding while scrolling, layout shifts,
// keyboard events) — every one of those used to silently wipe the canvas via
// the canvas.width reassignment below, permanently losing anything drawn
// before that moment. That's the actual cause of the mystery partial/blank
// drawings. Now a resize replays this history instead of losing it.
let turnStrokes = [];

function resizeCanvas() {
  const rect = canvas.getBoundingClientRect();
  const ratio = window.devicePixelRatio || 1;
  canvas.width = rect.width * ratio;
  canvas.height = rect.height * ratio;
  ctx.scale(ratio, ratio);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  turnStrokes.forEach((s) => drawSegment(fromFraction(s.from), fromFraction(s.to), s.tool));
}
window.addEventListener("resize", resizeCanvas);

function getPos(e) {
  const rect = canvas.getBoundingClientRect();
  const clientX = e.touches ? e.touches[0].clientX : e.clientX;
  const clientY = e.touches ? e.touches[0].clientY : e.clientY;
  return { x: clientX - rect.left, y: clientY - rect.top };
}

// Convert a raw pixel position into a 0-1 fraction of the CURRENT canvas size,
// so a stroke drawn on a wide laptop canvas can be faithfully redrawn on a
// much narrower phone canvas (and vice versa) instead of falling off the edge.
function toFraction(pos) {
  const rect = canvas.getBoundingClientRect();
  return { x: pos.x / rect.width, y: pos.y / rect.height };
}
function fromFraction(fpos) {
  const rect = canvas.getBoundingClientRect();
  return { x: fpos.x * rect.width, y: fpos.y * rect.height };
}

function drawSegment(from, to, tool) {
  const style = TOOLS[tool] || TOOLS.pen;
  ctx.strokeStyle = `rgba(${style.color},${style.opacity})`;
  ctx.lineWidth = style.width;

  if (style.jitter > 0) {
    // Sketch tool: draw a couple of jittered offset lines for a rough, hand-drawn feel.
    for (let i = 0; i < 2; i++) {
      const jx = (Math.random() - 0.5) * style.jitter;
      const jy = (Math.random() - 0.5) * style.jitter;
      ctx.beginPath();
      ctx.moveTo(from.x + jx, from.y + jy);
      ctx.lineTo(to.x + jx, to.y + jy);
      ctx.stroke();
    }
  } else {
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
  }
}

let drawing = false;
let lastPos = null;     // updated every move, for smooth local drawing
let lastSentPos = null; // only updated when we actually emit — this is what fixes the gaps

function pointerDown(e) {
  if (!isDrawer) return;
  drawing = true;
  lastPos = getPos(e);
  lastSentPos = lastPos;
}
const MIN_STROKE_DISTANCE = 2.5; // px — below this, accumulate distance rather than sending yet
function pointerMove(e) {
  if (!isDrawer || !drawing) return;
  e.preventDefault();
  const pos = getPos(e);
  drawSegment(lastPos, pos, currentTool); // local drawing is always smooth, every move
  lastPos = pos;

  // Compare against the last SENT point, not the last move — this way, several
  // small slow movements correctly accumulate distance instead of each one
  // resetting the reference point and silently never crossing the threshold.
  const dx = pos.x - lastSentPos.x, dy = pos.y - lastSentPos.y;
  if (Math.sqrt(dx * dx + dy * dy) >= MIN_STROKE_DISTANCE) {
    const stroke = { from: toFraction(lastSentPos), to: toFraction(pos), tool: currentTool };
    turnStrokes.push(stroke);
    socket.emit("stroke", stroke);
    lastSentPos = pos;
  }
}
function pointerUp() {
  drawing = false;
}

canvas.addEventListener("mousedown", pointerDown);
canvas.addEventListener("mousemove", pointerMove);
window.addEventListener("mouseup", pointerUp);
canvas.addEventListener("touchstart", pointerDown, { passive: false });
canvas.addEventListener("touchmove", pointerMove, { passive: false });
window.addEventListener("touchend", pointerUp);

clearBtn.addEventListener("click", () => {
  if (!isDrawer) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  socket.emit("clearCanvas");
});

// Remote strokes from the drawer, and remote clears — the drawer sends
// fractional (0-1) coordinates so this scales correctly to OUR OWN canvas
// size, whatever device we're on.
socket.on("stroke", (stroke) => {
  turnStrokes.push(stroke);
  drawSegment(fromFraction(stroke.from), fromFraction(stroke.to), stroke.tool);
});
socket.on("clearCanvas", () => ctx.clearRect(0, 0, canvas.width, canvas.height));

// ---------- Join flow ----------
joinBtn.addEventListener("click", () => {
  const name = nameInput.value.trim() || "Player";
  // Digits only — no letters means no upper/lowercase mismatch between devices.
  roomId = (roomInput.value || "").replace(/\D/g, "").trim() || String(Math.floor(1000 + Math.random() * 9000));
  socket.emit("joinRoom", { roomId, name });
  joinScreen.classList.add("hidden");
  gameScreen.classList.remove("hidden");
  roomLabel.textContent = roomId;
  requestAnimationFrame(resizeCanvas);
});

startBtn.addEventListener("click", () => socket.emit("startGame"));

// ---------- State rendering ----------
socket.on("connect", () => { myId = socket.id; });

socket.on("state", (state) => {
  roundNum.textContent = state.round;
  totalRounds.textContent = state.totalRounds;
  if (state.phase === "choosing") {
    timerDisplay.textContent = state.timeLeft > 0 ? `Pick: ${state.timeLeft}s` : "--";
  } else if (state.phase === "drawing") {
    timerDisplay.textContent = state.timeLeft > 0 ? `${state.timeLeft}s` : "--";
  } else {
    timerDisplay.textContent = "--";
  }

  playerList.innerHTML = "";
  state.players.forEach((p) => {
    const li = document.createElement("li");
    if (p.isDrawing) li.classList.add("drawing");
    const hostTag = p.id === state.hostId ? ' <span class="host-tag">host</span>' : "";
    li.innerHTML = `<span class="name">${escapeHtml(p.name)}${hostTag}</span><span class="score">${p.score}</span>`;
    playerList.appendChild(li);
  });

  isDrawer = state.players.find((p) => p.id === myId)?.isDrawing || false;
  canvas.style.cursor = isDrawer ? "crosshair" : "not-allowed";
  const isHost = state.hostId === myId;

  // The drawer already knows the word, so they can't draw AND guess — only guessers guess.
  guessInput.disabled = isDrawer;
  guessInput.placeholder = isDrawer ? "You're drawing, sit back and watch guesses roll in" : "Type your guess…";
  document.querySelectorAll(".tool").forEach((b) => (b.disabled = !isDrawer));

  if (state.phase === "lobby") {
    boardStatus.textContent = state.players.length < 2
      ? "Waiting for at least 2 players…"
      : (isHost ? "Ready! Start when you like." : "Ready! Waiting for host to start…");
    startBtn.classList.toggle("hidden", state.players.length < 2 || !isHost);
    wordBlank.textContent = "";
  } else if (state.phase === "choosing") {
    boardStatus.textContent = isDrawer ? "Pick a word…" : "Opponent is picking a word…";
    wordBlank.textContent = "";
    startBtn.classList.add("hidden");
  } else if (state.phase === "drawing") {
    boardStatus.textContent = isDrawer ? "Draw it!" : "Guess the drawing!";
    if (isDrawer) wordBlank.textContent = ""; // drawer's own word is set separately via the "yourWord" event
    // Guessers get no letter-count hint at all now — just the prompt above.
  } else if (state.phase === "roundEnd") {
    startBtn.classList.add("hidden");
  } else if (state.phase === "gameEnd") {
    boardStatus.textContent = "Game over! 🎉";
  }
});

socket.on("wordChoices", (choices) => {
  wordChoicesDiv.innerHTML = "";
  choices.forEach((c) => {
    const btn = document.createElement("button");
    btn.textContent = `${c.word} (${c.hint})`;
    btn.addEventListener("click", () => {
      socket.emit("chooseWord", c);
      wordChoiceModal.classList.add("hidden");
    });
    wordChoicesDiv.appendChild(btn);
  });
  wordChoiceModal.classList.remove("hidden");
});

socket.on("yourWord", (wordObj) => {
  wordBlank.textContent = `${wordObj.word} (${wordObj.hint})`;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  turnStrokes = [];
});

socket.on("roundStarted", () => {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  turnStrokes = [];
});

socket.on("turnEnded", ({ reason, word }) => {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  boardStatus.textContent = `${reason} The word was "${word}".`;
  addChatMessage({ name: "Game", text: `The word was "${word}"`, system: true });
});

socket.on("gameOver", ({ players }) => {
  const gameOverModal = document.getElementById("gameOverModal");
  const winnerHeadline = document.getElementById("winnerHeadline");
  const finalRankings = document.getElementById("finalRankings");

  const top = players[0];
  const tiedWinners = players.filter((p) => p.score === top.score);
  winnerHeadline.textContent = tiedWinners.length > 1
    ? `🏆 It's a tie: ${tiedWinners.map((p) => p.name).join(" & ")}!`
    : `🏆 ${top.name} wins!`;

  finalRankings.innerHTML = "";
  players.forEach((p, i) => {
    const li = document.createElement("li");
    li.innerHTML = `<span>#${i + 1} ${escapeHtml(p.name)}</span><span>${p.score} pts</span>`;
    finalRankings.appendChild(li);
  });
  gameOverModal.classList.remove("hidden");
});

document.getElementById("playAgainBtn").addEventListener("click", () => location.reload());

socket.on("chatMessage", (msg) => addChatMessage(msg));
socket.on("correctGuess", ({ name, points }) => {
  addChatMessage({ name, text: `guessed it! +${points} pts`, system: false, correct: true });
});

guessForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const text = guessInput.value.trim();
  if (!text) return;
  socket.emit("guess", text);
  guessInput.value = "";
});

function addChatMessage({ name, text, system, correct }) {
  const div = document.createElement("div");
  div.className = "msg" + (system ? " system" : "") + (correct ? " correct" : "");
  div.innerHTML = `<span class="name">${escapeHtml(name)}:</span> ${escapeHtml(text)}`;
  chatMessages.appendChild(div);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}
