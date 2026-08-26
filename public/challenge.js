// "Let's See Your Drawing Mister" — challenge-link mode.
// Two flows in one file: (1) creating a challenge link to send, and
// (2) attempting a challenge someone sent you. Self-contained, no socket.io.

(function () {
  // ---------- Flow 1: create a challenge link ----------
  const createBtn = document.getElementById("challengeCreateBtn");
  const linkBox = document.getElementById("challengeLinkBox");
  const linkInput = document.getElementById("challengeLinkInput");
  const copyBtn = document.getElementById("challengeCopyBtn");

  createBtn.addEventListener("click", async () => {
    createBtn.disabled = true;
    createBtn.textContent = "Creating…";
    try {
      const res = await fetch("/api/challenge/create", { method: "POST" });
      const data = await res.json();
      const url = `${window.location.origin}/challenge/${data.id}`;
      linkInput.value = url;
      linkBox.classList.remove("hidden");
      createBtn.classList.add("hidden");
    } catch (err) {
      createBtn.textContent = "Something went wrong. Try again";
      createBtn.disabled = false;
    }
  });

  copyBtn.addEventListener("click", async () => {
    linkInput.select();
    try {
      await navigator.clipboard.writeText(linkInput.value);
      copyBtn.textContent = "Copied!";
      setTimeout(() => (copyBtn.textContent = "Copy link"), 1500);
    } catch {
      // Clipboard API can fail on non-https/local setups — the text is still
      // selected, so a manual Ctrl+C works as a fallback.
    }
  });

  // ---------- Flow 2: attempt a received challenge ----------
  const introText = document.getElementById("challengeIntroText");
  const nameCard = document.getElementById("challengeNameCard");
  const nameInput = document.getElementById("challengeNameInput");
  const startBtn = document.getElementById("challengeStartBtn");
  const boardFrame = document.getElementById("challengeBoardFrame");
  const statusEl = document.getElementById("challengeStatus");
  const promptEl = document.getElementById("challengePrompt");
  const timerEl = document.getElementById("challengeTimerDisplay");
  const canvas = document.getElementById("challengeCanvas");
  const ctx = canvas.getContext("2d");
  const resultCard = document.getElementById("challengeResultCard");
  const resultHeading = document.getElementById("challengeResultHeading");
  const resultVerdict = document.getElementById("challengeResultVerdict");
  const certCanvas = document.getElementById("certificateCanvas");
  const certCtx = certCanvas.getContext("2d");
  const downloadBtn = document.getElementById("certificateDownloadBtn");
  const tryAgainBtn = document.getElementById("challengeTryAgainBtn");

  const TOOLS = {
    pen:    { width: 2.5, opacity: 1.0,  jitter: 0,   color: "31,78,140"  },
    marker: { width: 8,   opacity: 1.0,  jitter: 0,   color: "32,28,24"   },
    pencil: { width: 2,   opacity: 0.55, jitter: 0,   color: "50,45,40"   },
    sketch: { width: 3,   opacity: 0.85, jitter: 2.2, color: "178,58,46"  },
  };
  let currentTool = "pen";
  document.querySelectorAll(".tool[data-ch-tool]").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tool[data-ch-tool]").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      currentTool = btn.dataset.chTool;
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
  new ResizeObserver(() => {
    if (!boardFrame.classList.contains("hidden")) resizeCanvas();
  }).observe(canvas);

  function getPos(e) {
    const rect = canvas.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    return { x: clientX - rect.left, y: clientY - rect.top };
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
  let drawingActive = false, isDown = false, lastPos = null;
  function down(e) { if (!drawingActive) return; isDown = true; lastPos = getPos(e); }
  function move(e) {
    if (!drawingActive || !isDown) return;
    e.preventDefault();
    const pos = getPos(e);
    drawSegment(lastPos, pos, currentTool);
    lastPos = pos;
  }
  function up() { isDown = false; }
  canvas.addEventListener("mousedown", down);
  canvas.addEventListener("mousemove", move);
  window.addEventListener("mouseup", up);
  canvas.addEventListener("touchstart", down, { passive: false });
  canvas.addEventListener("touchmove", move, { passive: false });
  window.addEventListener("touchend", up);

  let challenge = null;
  let challengeId = null;
  let timerInterval = null;

  window.initChallengeAttempt = async function (id) {
    challengeId = id;
    try {
      const res = await fetch(`/api/challenge/${id}`);
      challenge = await res.json();
      if (challenge.error) throw new Error(challenge.error);
      introText.textContent = `You'll get ${challenge.seconds} seconds. No do-overs mid-round, so make it count.`;
    } catch (err) {
      introText.textContent = "This challenge link has expired or doesn't exist anymore.";
      startBtn.disabled = true;
    }
  };

  startBtn.addEventListener("click", () => {
    if (!nameInput.value.trim()) {
      nameInput.focus();
      return;
    }
    nameCard.classList.add("hidden");
    boardFrame.classList.remove("hidden");
    timerEl.classList.remove("hidden");
    requestAnimationFrame(() => requestAnimationFrame(() => {
      resizeCanvas();
      startAttempt();
    }));
  });

  function startAttempt() {
    promptEl.textContent = challenge.word;
    statusEl.textContent = "Draw it, go!";
    drawingActive = true;
    let timeLeft = challenge.seconds;
    timerEl.textContent = `${timeLeft}s`;
    timerInterval = setInterval(() => {
      timeLeft -= 1;
      timerEl.textContent = `${Math.max(timeLeft, 0)}s`;
      if (timeLeft <= 0) {
        clearInterval(timerInterval);
        timerInterval = null;
        finishAttempt();
      }
    }, 1000);
  }

  async function finishAttempt() {
    drawingActive = false;
    statusEl.textContent = "Time's up! Judging…";
    const imageBase64 = canvas.toDataURL("image/png").split(",")[1];
    const name = nameInput.value.trim();

    let verdict;
    try {
      const res = await fetch(`/api/challenge/${challengeId}/judge`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ imageBase64, name }),
      });
      verdict = await res.json();
      if (verdict.error) throw new Error(verdict.error);
    } catch (err) {
      verdict = { passed: false, verdict: "Judging isn't set up on this server yet (missing ANTHROPIC_API_KEY)." };
    }

    boardFrame.classList.add("hidden");
    timerEl.classList.add("hidden");
    showResult(verdict, name);
  }

  function showResult(verdict, name) {
    resultHeading.textContent = verdict.passed ? "You are a real art master!" : "Better luck next time!";
    resultVerdict.textContent = verdict.verdict;
    drawCertificate(verdict.passed, name);
    resultCard.classList.remove("hidden");
  }

  function drawCertificate(passed, name) {
    const w = certCanvas.width, h = certCanvas.height;
    certCtx.clearRect(0, 0, w, h);
    // Cream paper background with a torn-ish border feel via a simple inset rect
    certCtx.fillStyle = "#f7f1df";
    certCtx.fillRect(0, 0, w, h);
    certCtx.strokeStyle = passed ? "#2b7a4a" : "#b23a2e";
    certCtx.lineWidth = 8;
    certCtx.strokeRect(14, 14, w - 28, h - 28);

    certCtx.textAlign = "center";
    certCtx.fillStyle = "#2a2118";
    certCtx.font = "italic 20px Georgia, serif";
    certCtx.fillText("Chitra Challenge", w / 2, 55);

    certCtx.font = "bold 30px Georgia, serif";
    certCtx.fillText(passed ? "Certificate of Artistic Mastery" : "Certificate of Valiant Effort", w / 2, 110);

    certCtx.font = "bold 26px Georgia, serif";
    certCtx.fillStyle = passed ? "#2b7a4a" : "#b23a2e";
    certCtx.fillText(
      passed ? `You are a real art master, ${name}!` : `Nice try, ${name}, the pen wasn't ready`,
      w / 2,
      190
    );

    certCtx.font = "18px Georgia, serif";
    certCtx.fillStyle = "#2a2118";
    wrapText(`Prompt: "${challenge.word}" · Drawn in ${challenge.seconds} seconds`, w / 2, 230, w - 80, 24);

    certCtx.font = "italic 16px Georgia, serif";
    certCtx.fillStyle = "#5a4c3c";
    wrapText(resultVerdict.textContent, w / 2, 290, w - 100, 22);

    certCtx.font = "14px Georgia, serif";
    certCtx.fillStyle = "#8a7a63";
    certCtx.fillText("chitra: ek dikhaye, sab guess karein", w / 2, h - 25);
  }

  function wrapText(text, x, y, maxWidth, lineHeight) {
    const words = text.split(" ");
    let line = "";
    let cursorY = y;
    for (const word of words) {
      const test = line + word + " ";
      if (certCtx.measureText(test).width > maxWidth && line) {
        certCtx.fillText(line.trim(), x, cursorY);
        line = word + " ";
        cursorY += lineHeight;
      } else {
        line = test;
      }
    }
    certCtx.fillText(line.trim(), x, cursorY);
  }

  downloadBtn.addEventListener("click", () => {
    const link = document.createElement("a");
    link.download = "chitra-certificate.png";
    link.href = certCanvas.toDataURL("image/png");
    link.click();
  });

  tryAgainBtn.addEventListener("click", () => {
    resultCard.classList.add("hidden");
    nameCard.classList.remove("hidden");
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  });
})();
