/* Lopota Boat Race — simple canvas mini game */

const STORAGE_KEY_LOGO = "lopotaBoatRace.logoDataUrl.v1";

const DEPARTMENTS = [
  { name: "Front Office", color: "#37d39c" },
  { name: "Housekeeping", color: "#4aa3ff" },
  { name: "F&B Service", color: "#ffcf5a" },
  { name: "Kitchen", color: "#ff6b6b" },
  { name: "SPA", color: "#c77dff" },
  { name: "Engineering", color: "#9aa4b2" },
  { name: "Sales & Marketing", color: "#ff8fab" },
  { name: "HR", color: "#7bf1a8" },
  { name: "Finance", color: "#7dd3fc" },
  { name: "Security", color: "#f59e0b" },
];

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const now = () => performance.now();

function mulberry32(seed) {
  let t = seed >>> 0;
  return function () {
    t += 0x6d2b79f5;
    let x = Math.imul(t ^ (t >>> 15), 1 | t);
    x ^= x + Math.imul(x ^ (x >>> 7), 61 | x);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

function svgToDataUrl(svgText) {
  const encoded = encodeURIComponent(svgText)
    .replace(/'/g, "%27")
    .replace(/\"/g, "%22");
  return `data:image/svg+xml;charset=utf-8,${encoded}`;
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

async function getDefaultLogoDataUrl() {
  try {
    const res = await fetch("assets/lopota-logo.svg", { cache: "no-store" });
    if (!res.ok) throw new Error("logo fetch failed");
    const svg = await res.text();
    return svgToDataUrl(svg);
  } catch {
    const fallbackSvg = `
      <svg xmlns="http://www.w3.org/2000/svg" width="512" height="192" viewBox="0 0 512 192">
        <defs>
          <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stop-color="#0b3d2e"/>
            <stop offset="1" stop-color="#1f7a5a"/>
          </linearGradient>
        </defs>
        <rect width="512" height="192" rx="28" fill="url(#g)"/>
        <text x="256" y="92" text-anchor="middle" font-family="Georgia, 'Times New Roman', serif" font-size="56" fill="#e9fff6" letter-spacing="2">LOPOTA</text>
        <text x="256" y="126" text-anchor="middle" font-family="system-ui, -apple-system, Segoe UI, Arial, sans-serif" font-size="18" fill="#c8f7e6">Lake Resort &amp; Spa</text>
      </svg>
    `;
    return svgToDataUrl(fallbackSvg);
  }
}

function formatPct(x) {
  return `${Math.round(clamp(x, 0, 1) * 100)}%`;
}

function pickCompetitors(playerDeptName, rng, lanes) {
  const pool = DEPARTMENTS.map((d) => d.name).filter((n) => n !== playerDeptName);
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return [playerDeptName, ...pool.slice(0, Math.max(0, lanes - 1))];
}

function createBoat({ dept, lane, lanes, isPlayer, rng }) {
  return {
    dept,
    isPlayer,
    lane,
    x: 0,
    speed: 0,
    stamina: 1,
    lastPaddleAt: 0,
    wobbleSeed: rng(),
    finishTimeMs: null,
  };
}

function getDept(name) {
  return DEPARTMENTS.find((d) => d.name === name) ?? DEPARTMENTS[0];
}

function computeBoatMaxSpeed(stamina) {
  return lerp(320, 520, clamp(stamina, 0, 1));
}

function paddleImpulse(stamina, timeSinceLastMs) {
  const cadence = clamp(timeSinceLastMs / 260, 0, 1);
  const base = lerp(68, 92, cadence);
  return base * lerp(0.75, 1.08, stamina);
}

function staminaDrain(timeSinceLastMs) {
  const spam = 1 - clamp(timeSinceLastMs / 240, 0, 1);
  return 0.03 + 0.10 * spam;
}

function staminaRegen(dt) {
  return 0.07 * dt;
}

function difficultyParams(level) {
  if (level === 1) return { aiSkill: 0.82, aiAggro: 0.55 };
  if (level === 2) return { aiSkill: 0.92, aiAggro: 0.7 };
  return { aiSkill: 1.04, aiAggro: 0.82 };
}

function byProgressDesc(a, b) {
  const pa = a.x;
  const pb = b.x;
  if (pb !== pa) return pb - pa;
  return (a.finishTimeMs ?? 1e18) - (b.finishTimeMs ?? 1e18);
}

function createBars(container, names) {
  container.innerHTML = "";
  const items = [];
  for (const n of names) {
    const el = document.createElement("div");
    el.className = "bar";
    el.innerHTML = `
      <div class="name"></div>
      <div class="meter"><i></i></div>
      <div class="pct">0%</div>
    `;
    const nameEl = el.querySelector(".name");
    const meterI = el.querySelector(".meter > i");
    const pctEl = el.querySelector(".pct");
    nameEl.textContent = n;
    const dept = getDept(n);
    meterI.style.background = `linear-gradient(90deg, ${dept.color} 0%, rgba(255,255,255,.92) 160%)`;
    container.appendChild(el);
    items.push({ n, el, meterI, pctEl, nameEl });
  }
  return items;
}

function setStatus(dot, textEl, kind, text) {
  dot.classList.remove("warn", "bad");
  if (kind === "warn") dot.classList.add("warn");
  if (kind === "bad") dot.classList.add("bad");
  textEl.textContent = text;
}

async function main() {
  const canvas = document.querySelector("#game");
  const ctx = canvas.getContext("2d");

  const logoImgEl = document.querySelector("#logoPreview");
  const fileInput = document.querySelector("#logoFile");
  const btnClearLogo = document.querySelector("#clearLogo");

  const deptSelect = document.querySelector("#dept");
  const difficultySelect = document.querySelector("#difficulty");
  const lanesSelect = document.querySelector("#lanes");
  const lengthInput = document.querySelector("#length");

  const btnStart = document.querySelector("#start");
  const btnPaddle = document.querySelector("#paddle");

  const statusDot = document.querySelector("#statusDot");
  const statusText = document.querySelector("#statusText");
  const barsWrap = document.querySelector("#bars");

  for (const d of DEPARTMENTS) {
    const opt = document.createElement("option");
    opt.value = d.name;
    opt.textContent = d.name;
    deptSelect.appendChild(opt);
  }

  deptSelect.value = localStorage.getItem("lopotaBoatRace.dept") || DEPARTMENTS[0].name;
  difficultySelect.value = localStorage.getItem("lopotaBoatRace.diff") || "2";
  lanesSelect.value = localStorage.getItem("lopotaBoatRace.lanes") || "6";
  lengthInput.value = localStorage.getItem("lopotaBoatRace.len") || "1300";

  let logoDataUrl = localStorage.getItem(STORAGE_KEY_LOGO) || (await getDefaultLogoDataUrl());
  let logoImg = await loadImage(logoDataUrl);
  logoImgEl.src = logoDataUrl;

  fileInput.addEventListener("change", async () => {
    const f = fileInput.files?.[0];
    if (!f) return;
    const dataUrl = await new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.onerror = () => reject(new Error("read error"));
      r.readAsDataURL(f);
    });
    logoDataUrl = dataUrl;
    localStorage.setItem(STORAGE_KEY_LOGO, logoDataUrl);
    logoImgEl.src = logoDataUrl;
    logoImg = await loadImage(logoDataUrl);
  });

  btnClearLogo.addEventListener("click", async () => {
    localStorage.removeItem(STORAGE_KEY_LOGO);
    logoDataUrl = await getDefaultLogoDataUrl();
    logoImgEl.src = logoDataUrl;
    logoImg = await loadImage(logoDataUrl);
    fileInput.value = "";
  });

  let bars = [];

  let running = false;
  let finished = false;
  let startAt = 0;
  let lastT = now();

  let trackLength = 1300;
  let lanes = 6;
  let boats = [];
  let rng = mulberry32((Math.random() * 1e9) | 0);
  let params = difficultyParams(2);

  function resizeCanvas() {
    const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.floor(rect.width * dpr);
    canvas.height = Math.floor(rect.height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  window.addEventListener("resize", resizeCanvas);
  resizeCanvas();

  function resetRace() {
    finished = false;
    running = false;
    startAt = 0;
    lastT = now();

    localStorage.setItem("lopotaBoatRace.dept", deptSelect.value);
    localStorage.setItem("lopotaBoatRace.diff", difficultySelect.value);
    localStorage.setItem("lopotaBoatRace.lanes", lanesSelect.value);
    localStorage.setItem("lopotaBoatRace.len", lengthInput.value);

    trackLength = clamp(parseInt(lengthInput.value || "1300", 10) || 1300, 700, 2600);
    lanes = clamp(parseInt(lanesSelect.value || "6", 10) || 6, 3, 10);
    params = difficultyParams(parseInt(difficultySelect.value || "2", 10) || 2);

    rng = mulberry32(((Math.random() * 1e9) | 0) ^ (trackLength << 1) ^ (lanes << 5));

    const names = pickCompetitors(deptSelect.value, rng, lanes);
    boats = names.map((name, i) =>
      createBoat({
        dept: getDept(name),
        lane: i,
        lanes,
        isPlayer: i === 0,
        rng,
      })
    );

    for (const b of boats) {
      b.speed = 120 + rng() * 25;
      b.stamina = 1;
      b.lastPaddleAt = 0;
      b.finishTimeMs = null;
      b.x = 0;
    }

    bars = createBars(barsWrap, names);
    setStatus(statusDot, statusText, "warn", "Ready — press Start");
    btnPaddle.disabled = true;
    btnStart.disabled = false;
  }

  function startRace() {
    running = true;
    finished = false;
    startAt = now();
    for (const b of boats) b.finishTimeMs = null;
    setStatus(statusDot, statusText, "good", "Race on! Space / Paddle");
    btnPaddle.disabled = false;
    btnStart.disabled = true;
  }

  function endRace() {
    running = false;
    finished = true;
    btnPaddle.disabled = true;
    btnStart.disabled = false;

    const sorted = [...boats].sort((a, b) => (a.finishTimeMs ?? 1e18) - (b.finishTimeMs ?? 1e18));
    const winner = sorted[0];
    const isPlayerWinner = !!winner?.isPlayer;

    setStatus(
      statusDot,
      statusText,
      isPlayerWinner ? "good" : "warn",
      isPlayerWinner ? "You win!" : `Winner: ${winner.dept.name}`
    );
  }

  function paddle(playerOnly = true) {
    if (!running) return;
    const t = now();
    for (const b of boats) {
      if (playerOnly && !b.isPlayer) continue;
      if (b.finishTimeMs != null) continue;
      const since = b.lastPaddleAt ? t - b.lastPaddleAt : 999;
      b.lastPaddleAt = t;
      b.speed += paddleImpulse(b.stamina, since);
      b.stamina = clamp(b.stamina - staminaDrain(since), 0, 1);
    }
  }

  btnPaddle.addEventListener("click", () => paddle(true));
  btnStart.addEventListener("click", () => (running ? resetRace() : startRace()));

  window.addEventListener("keydown", (e) => {
    if (e.code === "Space") {
      e.preventDefault();
      if (!running && !finished) startRace();
      else paddle(true);
    }
    if (e.code === "KeyR") {
      resetRace();
    }
  });

  resetRace();

  function update(dt) {
    if (!running) return;
    const t = now();
    const elapsed = t - startAt;

    for (const b of boats) {
      if (b.isPlayer) continue;
      if (b.finishTimeMs != null) continue;
      const progress = b.x / trackLength;
      const wants = params.aiAggro * (0.45 + 0.7 * (1 - progress));
      const jitter = (rng() - 0.5) * 0.22;
      const cadenceMs = lerp(420, 250, clamp(wants + jitter, 0, 1));
      const since = b.lastPaddleAt ? t - b.lastPaddleAt : 999;
      const will = since > cadenceMs && rng() < 0.9;
      if (will) {
        b.lastPaddleAt = t;
        b.speed += paddleImpulse(b.stamina, since) * params.aiSkill;
        b.stamina = clamp(
          b.stamina - staminaDrain(since) * lerp(1.08, 0.92, params.aiSkill - 0.8),
          0,
          1
        );
      }
    }

    for (const b of boats) {
      if (b.finishTimeMs != null) continue;

      b.stamina = clamp(b.stamina + staminaRegen(dt), 0, 1);

      const maxSpeed = computeBoatMaxSpeed(b.stamina);
      b.speed *= Math.pow(0.985, dt * 60);
      b.speed = Math.min(b.speed, maxSpeed);
      b.speed = Math.max(b.speed, 80);

      b.x += b.speed * dt * 0.72;
      if (b.x >= trackLength) {
        b.x = trackLength;
        b.finishTimeMs = elapsed;
      }
    }

    if (boats.every((b) => b.finishTimeMs != null)) {
      endRace();
    }
  }

  function drawBackground(w, h) {
    const sky = ctx.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, "#0a2b22");
    sky.addColorStop(0.42, "#0b3d2e");
    sky.addColorStop(1, "#042018");
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, h);

    ctx.globalAlpha = 0.35;
    ctx.fillStyle = "#061b14";
    ctx.beginPath();
    ctx.moveTo(0, h * 0.34);
    ctx.bezierCurveTo(w * 0.15, h * 0.28, w * 0.33, h * 0.4, w * 0.52, h * 0.33);
    ctx.bezierCurveTo(w * 0.7, h * 0.26, w * 0.84, h * 0.38, w, h * 0.31);
    ctx.lineTo(w, 0);
    ctx.lineTo(0, 0);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 1;

    const waterY = h * 0.3;
    const water = ctx.createLinearGradient(0, waterY, 0, h);
    water.addColorStop(0, "rgba(55,211,156,.18)");
    water.addColorStop(0.15, "rgba(17,140,100,.18)");
    water.addColorStop(1, "rgba(0,0,0,.40)");
    ctx.fillStyle = water;
    ctx.fillRect(0, waterY, w, h - waterY);

    ctx.globalAlpha = 0.18;
    ctx.strokeStyle = "rgba(233,255,246,.55)";
    for (let i = 0; i < 18; i++) {
      const y = waterY + (h - waterY) * (i / 18);
      ctx.lineWidth = i % 3 === 0 ? 1.4 : 1;
      ctx.beginPath();
      for (let x = 0; x <= w; x += 24) {
        const a = (x * 0.012 + i * 0.7) % (Math.PI * 2);
        const dy = Math.sin(a) * (i % 3 === 0 ? 2.6 : 1.6);
        ctx.lineTo(x, y + dy);
      }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  function drawFinishLine(w, h, waterY, margin) {
    const x = w - margin - 90;
    ctx.save();
    ctx.globalAlpha = 0.85;
    ctx.fillStyle = "rgba(0,0,0,.25)";
    ctx.fillRect(x - 10, waterY + 10, 110, h - waterY - 20);
    ctx.globalAlpha = 1;

    const cell = 14;
    for (let y = waterY + 18; y < h - 18; y += cell) {
      for (let cx = 0; cx < 2; cx++) {
        ctx.fillStyle = (Math.floor((y - waterY) / cell) + cx) % 2 === 0 ? "rgba(255,255,255,.85)" : "rgba(0,0,0,.85)";
        ctx.fillRect(x + cx * cell, y, cell, cell);
      }
    }
    ctx.restore();
    return x;
  }

  function roundRectPath(x, y, w, h, r) {
    const rr = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
  }

  function drawBoat({ b, w, h, waterY, margin, finishX }) {
    const laneH = (h - waterY - margin * 1.2) / lanes;
    const laneY = waterY + margin * 0.6 + laneH * (b.lane + 0.5);
    const progress = b.x / trackLength;
    const x = lerp(margin + 80, finishX - 120, clamp(progress, 0, 1));

    const wob = Math.sin((now() * 0.0022 + b.wobbleSeed * 9) * 2) * 2.6;
    const pitch = Math.sin((now() * 0.0016 + b.wobbleSeed * 7) * 2) * 0.025;

    ctx.save();
    ctx.translate(x, laneY + wob);
    ctx.rotate(pitch);

    ctx.globalAlpha = 0.22;
    ctx.fillStyle = "rgba(233,255,246,.7)";
    ctx.beginPath();
    ctx.ellipse(-58, 10, 42, 10, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;

    const hullColor = b.dept.color;
    ctx.fillStyle = "rgba(0,0,0,.35)";
    roundRectPath(-54, -10, 120, 34, 16);
    ctx.fill();
    ctx.fillStyle = hullColor;
    roundRectPath(-56, -14, 118, 34, 16);
    ctx.fill();

    const decalW = 38;
    const decalH = 16;
    ctx.globalAlpha = 0.92;
    ctx.drawImage(logoImg, -20, -8, decalW, decalH);
    ctx.globalAlpha = 1;

    ctx.strokeStyle = "rgba(233,255,246,.8)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(10, -18);
    ctx.lineTo(10, -56);
    ctx.stroke();

    ctx.fillStyle = "rgba(0,0,0,.28)";
    roundRectPath(10, -62, 54, 28, 8);
    ctx.fill();
    ctx.globalAlpha = 0.95;
    ctx.drawImage(logoImg, 14, -58, 46, 20);
    ctx.globalAlpha = 1;

    const shirtColor = "rgba(0,0,0,.22)";
    ctx.fillStyle = "rgba(233,255,246,.92)";
    ctx.beginPath();
    ctx.arc(-14, -22, 7.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = shirtColor;
    roundRectPath(-22, -16, 18, 14, 6);
    ctx.fill();
    ctx.globalAlpha = 0.92;
    ctx.drawImage(logoImg, -20, -15, 14, 10);
    ctx.globalAlpha = 1;

    ctx.font = "600 12px ui-sans-serif, system-ui, -apple-system, Segoe UI, Arial";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "rgba(233,255,246,.95)";
    ctx.shadowColor = "rgba(0,0,0,.35)";
    ctx.shadowBlur = 10;
    ctx.fillText(b.dept.name, -56, -34);
    ctx.shadowBlur = 0;

    ctx.globalAlpha = 0.9;
    ctx.fillStyle = "rgba(0,0,0,.35)";
    ctx.fillRect(-56, -48, 70, 6);
    ctx.fillStyle = b.stamina > 0.4 ? "rgba(55,211,156,.95)" : b.stamina > 0.2 ? "rgba(255,207,90,.95)" : "rgba(255,107,107,.95)";
    ctx.fillRect(-56, -48, 70 * clamp(b.stamina, 0, 1), 6);
    ctx.globalAlpha = 1;

    ctx.restore();
  }

  function drawOverlay(w, h) {
    const pad = 14;
    ctx.save();
    ctx.globalAlpha = 0.65;
    ctx.fillStyle = "rgba(0,0,0,.26)";
    ctx.fillRect(pad, pad, 320, 62);
    ctx.globalAlpha = 1;
    ctx.fillStyle = "rgba(233,255,246,.92)";
    ctx.font = "700 14px ui-sans-serif, system-ui, -apple-system, Segoe UI, Arial";
    ctx.fillText("Lopota Lake Boat Race", pad + 12, pad + 22);
    ctx.font = "600 12px ui-sans-serif, system-ui, -apple-system, Segoe UI, Arial";
    ctx.fillStyle = "rgba(188,235,220,.92)";
    const len = `${trackLength}m · ${lanes} depts · ${running ? "running" : finished ? "finished" : "ready"}`;
    ctx.fillText(len, pad + 12, pad + 44);
    ctx.restore();
  }

  function render() {
    const rect = canvas.getBoundingClientRect();
    const w = rect.width;
    const h = rect.height;

    ctx.clearRect(0, 0, w, h);
    drawBackground(w, h);

    const waterY = h * 0.3;
    const margin = 18;
    const finishX = drawFinishLine(w, h, waterY, margin);

    ctx.globalAlpha = 0.22;
    ctx.strokeStyle = "rgba(233,255,246,.65)";
    for (let i = 0; i <= lanes; i++) {
      const y = waterY + margin * 0.6 + ((h - waterY - margin * 1.2) / lanes) * i;
      ctx.lineWidth = i === 0 || i === lanes ? 2 : 1;
      ctx.beginPath();
      ctx.moveTo(margin, y);
      ctx.lineTo(w - margin, y);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    for (const b of boats) drawBoat({ b, w, h, waterY, margin, finishX });

    for (const item of bars) {
      const boat = boats.find((bb) => bb.dept.name === item.n);
      if (!boat) continue;
      const p = clamp(boat.x / trackLength, 0, 1);
      item.meterI.style.width = `${p * 100}%`;
      item.pctEl.textContent = formatPct(p);
      item.nameEl.style.fontWeight = boat.isPlayer ? "800" : "600";
      item.nameEl.style.color = boat.isPlayer ? "rgba(233,255,246,.98)" : "rgba(233,255,246,.90)";
    }

    const player = boats.find((b) => b.isPlayer);
    if (player && running) {
      if (player.stamina > 0.35) setStatus(statusDot, statusText, "good", "Race on! Space / Paddle");
      else if (player.stamina > 0.18) setStatus(statusDot, statusText, "warn", "Careful — you’re tiring (pace it)");
      else setStatus(statusDot, statusText, "bad", "Exhausted — slow down spamming");
    }

    if (running) {
      const lead = [...boats].sort(byProgressDesc)[0];
      if (lead) {
        ctx.save();
        ctx.globalAlpha = 0.82;
        ctx.fillStyle = "rgba(0,0,0,.26)";
        ctx.fillRect(w - 260, 14, 246, 62);
        ctx.globalAlpha = 1;
        ctx.fillStyle = "rgba(233,255,246,.94)";
        ctx.font = "800 13px ui-sans-serif, system-ui, -apple-system, Segoe UI, Arial";
        ctx.fillText("Leader", w - 248, 36);
        ctx.font = "700 12px ui-sans-serif, system-ui, -apple-system, Segoe UI, Arial";
        ctx.fillStyle = "rgba(188,235,220,.92)";
        ctx.fillText(lead.dept.name, w - 248, 56);
        ctx.restore();
      }
    }

    drawOverlay(w, h);
  }

  function loop() {
    const t = now();
    const dt = clamp((t - lastT) / 1000, 0, 0.05);
    lastT = t;
    update(dt);
    render();
    requestAnimationFrame(loop);
  }

  requestAnimationFrame(loop);
}

main().catch((err) => {
  console.error(err);
  alert("Game failed to load. Check console for details.");
});
