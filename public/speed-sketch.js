// Speed Sketch — solo, AI-judged drawing mode. Deliberately self-contained
// (no socket.io) since this is single-player: prompt -> timed draw -> AI
// scores the canvas snapshot -> next round -> final results.

(function () {
  const DIFFICULTIES = ["easy", "medium", "hard"]; // round 1, 2, 3

  const ssCanvas = document.getElementById("ssCanvas");
  const ssCtx = ssCanvas.getContext("2d");
  const ssPromptEl = document.getElementById("ssPrompt");
  const ssStatusEl = document.getElementById("ssStatus");
  const ssTimerEl = document.getElementById("ssTimerDisplay");
  const ssRoundNumEl = document.getElementById("ssRoundNum");
  const ssHintEl = document.getElementById("ssHint");
  const ssStartRoundBtn = document.getElementById("ssStartRoundBtn");
  const ssVerdictBox = document.getElementById("ssVerdict");
  const ssScoreText = document.getElementById("ssScoreText");
  const ssVerdictText = document.getElementById("ssVerdictText");
  const ssClearBtn = document.getElementById("ssClearBtn");
  const ssResultsModal = document.getElementById("ssResultsModal");
  const ssResultsList = document.getElementById("ssResultsList");
  const ssTotalScoreEl = document.getElementById("ssTotalScore");
  const ssPlayAgainBtn = document.getElementById("ssPlayAgainBtn");
  const ssBackHomeBtn = document.getElementById("ssBackHomeBtn");

  // Same tool identities as the multiplayer board, for a consistent feel.
  const TOOLS = {
    pen:    { width: 2.5, opacity: 1.0,  jitter: 0,   color: "31,78,140"  },
    marker: { width: 8,   opacity: 1.0,  jitter: 0,   color: "32,28,24"   },
    pencil: { width: 2,   opacity: 0.55, jitter: 0,   color: "50,45,40"   },
    sketch: { width: 3,   opacity: 0.85, jitter: 2.2, color: "178,58,46"  },
  };
  let currentTool = "pen";

  document.querySelectorAll(".tool[data-ss-tool]").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tool[data-ss-tool]").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      currentTool = btn.dataset.ssTool;
    });
  });

  function resizeCanvas() {
    const rect = ssCanvas.getBoundingClientRect();
    const ratio = window.devicePixelRatio || 1;
    ssCanvas.width = rect.width * ratio;
    ssCanvas.height = rect.height * ratio;
    ssCtx.scale(ratio, ratio);
    ssCtx.lineCap = "round";
    ssCtx.lineJoin = "round";
  }

  function getPos(e) {
    const rect = ssCanvas.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    return { x: clientX - rect.left, y: clientY - rect.top };
  }

  function drawSegment(from, to, tool) {
    const style = TOOLS[tool] || TOOLS.pen;
    ssCtx.strokeStyle = `rgba(${style.color},${style.opacity})`;
    ssCtx.lineWidth = style.width;
    if (style.jitter > 0) {
      for (let i = 0; i < 2; i++) {
        const jx = (Math.random() - 0.5) * style.jitter;
        const jy = (Math.random() - 0.5) * style.jitter;
        ssCtx.beginPath();
        ssCtx.moveTo(from.x + jx, from.y + jy);
        ssCtx.lineTo(to.x + jx, to.y + jy);
        ssCtx.stroke();
      }
    } else {
      ssCtx.beginPath();
      ssCtx.moveTo(from.x, from.y);
      ssCtx.lineTo(to.x, to.y);
      ssCtx.stroke();
    }
  }

  let drawingActive = false; // true only while a round's timer is running
  let isPointerDown = false;
  let lastPos = null;

  function pointerDown(e) {
    if (!drawingActive) return;
    isPointerDown = true;
    lastPos = getPos(e);
  }
  function pointerMove(e) {
    if (!drawingActive || !isPointerDown) return;
    e.preventDefault();
    const pos = getPos(e);
    drawSegment(lastPos, pos, currentTool);
    lastPos = pos;
  }
  function pointerUp() { isPointerDown = false; }

  ssCanvas.addEventListener("mousedown", pointerDown);
  ssCanvas.addEventListener("mousemove", pointerMove);
  window.addEventListener("mouseup", pointerUp);
  ssCanvas.addEventListener("touchstart", pointerDown, { passive: false });
  ssCanvas.addEventListener("touchmove", pointerMove, { passive: false });
  window.addEventListener("touchend", pointerUp);

  ssClearBtn.addEventListener("click", () => {
    if (!drawingActive) return;
    ssCtx.clearRect(0, 0, ssCanvas.width, ssCanvas.height);
  });

  // ---------- Round flow ----------
  let roundIndex = 0; // 0,1,2 -> rounds 1,2,3
  let currentPrompt = null;
  let timerInterval = null;
  let results = []; // {prompt, score, verdict}
  let roundButtonMode = "start"; // "start" | "next" — drives the single click handler below

  function clearRoundTimer() {
    if (timerInterval) {
      clearInterval(timerInterval);
      timerInterval = null;
    }
  }

  async function fetchPrompt(difficulty) {
    const res = await fetch(`/api/speed-sketch/prompt/${difficulty}`);
    return res.json();
  }

  function resetRoundUI() {
    clearRoundTimer();
    ssCtx.clearRect(0, 0, ssCanvas.width, ssCanvas.height);
    ssVerdictBox.classList.add("hidden");
    ssStartRoundBtn.classList.remove("hidden");
    ssStartRoundBtn.disabled = false;
    ssStartRoundBtn.textContent = "Start round";
    roundButtonMode = "start";
    ssTimerEl.textContent = "--";
  }

  async function loadRound() {
    ssRoundNumEl.textContent = String(roundIndex + 1);
    ssStatusEl.textContent = "Get ready to draw…";
    currentPrompt = await fetchPrompt(DIFFICULTIES[roundIndex]);
    ssPromptEl.textContent = "?????"; // hidden until round starts, keeps a little suspense
    ssHintEl.textContent = `Hint (Hinglish): ${currentPrompt.hint} (revealed once you start)`;
    resetRoundUI();
  }

  function startRound() {
    clearRoundTimer(); // belt-and-braces: never let a stray timer survive into a new round
    ssStartRoundBtn.classList.add("hidden");
    ssPromptEl.textContent = currentPrompt.word;
    ssHintEl.textContent = `Hint: ${currentPrompt.hint}`;
    ssStatusEl.textContent = "Draw it!";
    drawingActive = true;

    let timeLeft = currentPrompt.seconds;
    ssTimerEl.textContent = `${timeLeft}s`;
    timerInterval = setInterval(() => {
      timeLeft -= 1;
      ssTimerEl.textContent = `${Math.max(timeLeft, 0)}s`;
      if (timeLeft <= 0) {
        clearRoundTimer();
        endRound();
      }
    }, 1000);
  }

  async function endRound() {
    clearRoundTimer();
    drawingActive = false;
    ssStatusEl.textContent = "Time's up! AI is judging your masterpiece…";
    const imageBase64 = ssCanvas.toDataURL("image/png").split(",")[1];

    let verdict;
    let judgingFailed = false;
    try {
      const res = await fetch("/api/speed-sketch/judge", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          imageBase64,
          prompt: currentPrompt.word,
          seconds: currentPrompt.seconds,
        }),
      });
      verdict = await res.json();
      if (verdict.error) throw new Error(verdict.error);
    } catch (err) {
      judgingFailed = true;
      verdict = { score: null, verdict: "AI judging isn't set up on this server yet (missing ANTHROPIC_API_KEY). Your drawing wasn't actually scored." };
    }

    results.push({ prompt: currentPrompt.word, score: verdict.score, verdict: verdict.verdict, judgingFailed });
    ssScoreText.textContent = judgingFailed ? "Not judged" : `${verdict.score} / 10`;
    ssVerdictText.textContent = verdict.verdict;
    ssVerdictBox.classList.toggle("judging-failed", judgingFailed);
    ssVerdictBox.classList.remove("hidden");
    ssStatusEl.textContent = "Round done! Every round counts toward your total. No pass or fail here, just try to score as high as you can.";

    ssStartRoundBtn.classList.remove("hidden");
    ssStartRoundBtn.disabled = false;
    if (roundIndex < DIFFICULTIES.length - 1) {
      ssStartRoundBtn.textContent = "Next round";
      roundButtonMode = "next";
    } else {
      ssStartRoundBtn.textContent = "See results";
      roundButtonMode = "results";
    }
  }

  // ONE handler for the whole button, driven by state — this is what fixes the
  // "clicking Next round secretly double-fires" bug from mixing addEventListener + onclick.
  ssStartRoundBtn.addEventListener("click", async () => {
    if (roundButtonMode === "start") {
      startRound();
    } else if (roundButtonMode === "next") {
      ssStartRoundBtn.disabled = true; // guard against a double-click firing this twice
      roundIndex += 1;
      await loadRound();
    } else if (roundButtonMode === "results") {
      showResults();
    }
  });

  function showResults() {
    ssResultsList.innerHTML = "";
    let total = 0;
    let judgedCount = 0;
    results.forEach((r, i) => {
      const li = document.createElement("li");
      if (r.judgingFailed) {
        li.innerHTML = `<strong>Round ${i + 1} (${r.prompt}):</strong> not judged. <em>${r.verdict}</em>`;
      } else {
        total += r.score;
        judgedCount += 1;
        li.innerHTML = `<strong>Round ${i + 1} (${r.prompt}):</strong> ${r.score}/10. <em>${r.verdict}</em>`;
      }
      ssResultsList.appendChild(li);
    });
    ssTotalScoreEl.textContent = judgedCount > 0
      ? `Total: ${total} / ${judgedCount * 10}`
      : "No rounds were judged. Set up ANTHROPIC_API_KEY on the server to see scores.";
    ssResultsModal.classList.remove("hidden");
  }

  ssPlayAgainBtn.addEventListener("click", () => {
    ssResultsModal.classList.add("hidden");
    window.initSpeedSketch(true);
  });
  ssBackHomeBtn.addEventListener("click", () => {
    ssResultsModal.classList.add("hidden");
  });

  // Called by index.html's router the first time the Speed Sketch card is clicked,
  // and again on "Play again".
  window.initSpeedSketch = async function () {
    roundIndex = 0;
    results = [];
    clearRoundTimer();
    drawingActive = false;
    // Screen visibility can lag a frame behind the class toggle in some browsers —
    // wait a frame before measuring, so the canvas buffer always matches its real
    // on-screen size (this was the source of the cursor/stroke position mismatch).
    requestAnimationFrame(() => requestAnimationFrame(async () => {
      resizeCanvas();
      await loadRound();
    }));
  };

  // Keep the canvas backing store in sync with its on-screen size at all times —
  // covers window resizes AND any layout shift from the sidebar/content around it,
  // which a one-off resize on load can miss.
  new ResizeObserver(() => {
    if (!document.getElementById("speedSketchScreen").classList.contains("hidden")) {
      resizeCanvas();
    }
  }).observe(ssCanvas);
})();
