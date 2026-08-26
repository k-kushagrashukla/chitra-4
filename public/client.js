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
const debugCounter = document.getElementById("debugCounter");

let myId = null;
let isDrawer = false;
let currentTool = "pen";
let roomId = null;

const TOOLS = {
  pen:    { width: 2.5, opacity: 1.0,  jitter: 0,   color: "31,78,140"  },
  marker: { width: 8,   opacity: 1.0,  jitter: 0,   color: "32,28,24"   },
  pencil: { width: 2,   opacity: 0.55, jitter: 0,   color: "50,45,40"   },
  sketch: { width: 3,   opacity: 0.85, jitter: 2.2, color: "178,58,46"  },
};

document.querySelectorAll(".tool[data-tool]").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tool[data-tool]").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    currentTool = btn.dataset.tool;
  });
});

function resizeCanvas() {
  const rect = canvas.getBoundingClientRect();
  const ratio = window.devicePixelRatio || 1;
  canvas.width = rect.width * ratio;
  canvas.height = rect.height * ratio;
  ctx.scale(ratio, ratio);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
}
window.addEventListener("resize", () => {
  resizeCanvas();
});

function getPos(e) {
  const rect = canvas.getBoundingClientRect();
  const clientX = e.touches ? e.touches[0].clientX : e.clientX;
  const clientY = e.touches ? e.touches[0].clientY : e.clientY;
  return { x: clientX - rect.left, y: clientY - rect.top };
}

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
let lastPos = null;
let strokesSent = 0;

function pointerDown(e) {
  if (!isDrawer) return;
  drawing = true;
  lastPos = getPos(e);
}
function pointerMove(e) {
  if (!isDrawer || !drawing) return;
  e.preventDefault();
  const pos = getPos(e);
  drawSegment(lastPos, pos, currentTool);
  socket.emit("stroke", { from: toFraction(lastPos), to: toFraction(pos), tool: currentTool });
  strokesSent += 1;
  debugCounter.textContent = `strokes sent: ${strokesSent}`;
  lastPos = pos;
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

let strokesReceived = 0;
socket.on("stroke", ({ from, to, tool }) => {
  strokesReceived += 1;
  debugCounter.textContent = `strokes received: ${strokesReceived}`;
  drawSegment(fromFraction(from), fromFraction(to), tool);
});
socket.on("clearCanvas", () => ctx.clearRect(0, 0, canvas.width, canvas.height));

// ---------- Join flow ----------
joinBtn.addEventListener("click", () => {
  const name = nameInput.value.trim() || "Player";
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
    if (isDrawer) wordBlank.textContent = "";
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
});

socket.on("roundStarted", () => {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  strokesReceived = 0;
  debugCounter.textContent = "strokes received: 0";
  const rect = canvas.getBoundingClientRect();
  console.log(`[Chitra debug] new turn started. Canvas rect: ${rect.width}x${rect.height}, buffer: ${canvas.width}x${canvas.height}`);
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