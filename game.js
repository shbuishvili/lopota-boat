/* Lopota Boat Race — Multiplayer (Render) + Canvas */

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

function getDept(name) {
  return DEPARTMENTS.find((d) => d.name === name) ?? DEPARTMENTS[0];
}

function formatPct(x) {
  return `${Math.round(clamp(x, 0, 1) * 100)}%`;
}

function createBars(container, players) {
  container.innerHTML = "";
  const items = [];
  for (const p of players) {
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

    const dept = getDept(p.dept);
    nameEl.textContent = `${p.name} — ${p.dept}`;
    meterI.style.background = `linear-gradient(90deg, ${dept.color} 0%, rgba(255,255,255,.92) 160%)`;

    container.appendChild(el);
    items.push({ id: p.id, nameEl, meterI, pctEl });
  }
  return items;
}

function setStatus(dot, textEl, kind, text) {
  dot.classList.remove("warn", "bad");
  if (kind === "warn") dot.classList.add("warn");
  if (kind === "bad") dot.classList.add("bad");
  textEl.textContent = text;
}

function id6() {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

function getRoomId() {
  const url = new URL(location.href);
  const room = url.searchParams.get("room");
  if (room && /^[A-Z0-9_-]{2,24}$/i.test(room)) return room.toUpperCase();
  const newRoom = id6();
  url.searchParams.set("room", newRoom);
  history.replaceState({}, "", url.toString());
  return newRoom;
}

function wsUrl() {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${location.host}/ws`;
}

async function main() {
  const canvas = document.querySelector("#game");
  const ctx = canvas.getContext("2d");

  const logoImgEl = document.querySelector("#logoPreview");
  const fileInput = document.querySelector("#logoFile");

  const nameInput = document.querySelector("#playerName");
  const deptSelect = document.querySelector("#dept");
  const lengthInput = document.querySelector("#length");

  const shareLink = document.querySelector("#shareLink");
  const copyLink = document.querySelector("#copyLink");
  const connHint = document.querySelector("#connHint");

  const btnStart = document.querySelector("#start");
  const btnPaddle = document.querySelector("#paddle");
  const btnReset = document.querySelector("#reset");

  const statusDot = document.querySelector("#statusDot");
  const statusText = document.querySelector("#statusText");
  const barsWrap = document.querySelector("#bars");

  const roomIdEl = document.querySelector("#roomId");
  const playerCountEl = document.querySelector("#playerCount");

  for (const d of DEPARTMENTS) {
    const opt = document.createElement("option");
    opt.value = d.name;
    opt.textContent = d.name;
    deptSelect.appendChild(opt);
  }

  nameInput.value = localStorage.getItem("lopotaBoatRace.name") || "";
  deptSelect.value = localStorage.getItem("lopotaBoatRace.dept") || DEPARTMENTS[0].name;
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

  const roomId = getRoomId();
  roomIdEl.textContent = roomId;
  shareLink.value = location.href;

  copyLink.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(shareLink.value);
      connHint.textContent = "Link copied";
      setTimeout(() => (connHint.textContent = ""), 1200);
    } catch {
      shareLink.select();
      document.execCommand("copy");
      connHint.textContent = "Link copied";
      setTimeout(() => (connHint.textContent = ""), 1200);
    }
  });

  let ws = null;
  let myId = null;
  let minPlayers = 3;

  let roomPhase = "lobby";
  let trackLength = 1300;
  let players = []; // {id,name,dept}
  let boats = []; // {id,name,dept,lane,x,speed,stamina,finishTimeMs}

  let bars = [];

  function resizeCanvas() {
    const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.floor(rect.width * dpr);
    canvas.height = Math.floor(rect.height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  window.addEventListener("resize", resizeCanvas);
  resizeCanvas();

  function updateButtons() {
    const canStart = roomPhase !== "running" && players.length >= minPlayers;
    btnStart.disabled = !canStart;
    btnPaddle.disabled = roomPhase !== "running";
  }

  function applyRoomState(state) {
    roomPhase = state.phase;
    minPlayers = state.minPlayers || 3;
    players = state.players || players;
    playerCountEl.textContent = String(players.length);
    bars = createBars(barsWrap, players);

    if (roomPhase === "lobby") {
      setStatus(statusDot, statusText, "warn", players.length >= minPlayers ? "Ready — press Start" : `Waiting… need ${minPlayers}+ players`);
    } else if (roomPhase === "running") {
      setStatus(statusDot, statusText, "good", "Race on! Space / Paddle");
    } else {
      setStatus(statusDot, statusText, "warn", "Finished — press Start to race again");
    }

    updateButtons();
  }

  function applyState(state) {
    trackLength = state.trackLength || trackLength;
    boats = (state.boats || []).slice().sort((a, b) => (a.lane ?? 0) - (b.lane ?? 0));

    const me = boats.find((b) => b.id === myId);
    if (roomPhase === "running" && me) {
      if (me.stamina > 0.35) setStatus(statusDot, statusText, "good", "Race on! Space / Paddle");
      else if (me.stamina > 0.18) setStatus(statusDot, statusText, "warn", "Careful — you’re tiring (pace it)");
      else setStatus(statusDot, statusText, "bad", "Exhausted — slow down spamming");
    }

    // update bars meters
    for (const item of bars) {
      const boat = boats.find((bb) => bb.id === item.id);
      if (!boat) continue;
      const p = clamp((boat.x || 0) / trackLength, 0, 1);
      item.meterI.style.width = `${p * 100}%`;
      item.pctEl.textContent = formatPct(p);
      item.nameEl.style.fontWeight = boat.id === myId ? "800" : "600";
      item.nameEl.style.color = boat.id === myId ? "rgba(233,255,246,.98)" : "rgba(233,255,246,.90)";
    }
  }

  function connect() {
    connHint.textContent = "Connecting…";
    const url = wsUrl();
    ws = new WebSocket(url);

    ws.addEventListener("open", () => {
      connHint.textContent = "Connected";
      ws.send(
        JSON.stringify({
          type: "join",
          room: roomId,
          name: nameInput.value || "Guest",
          dept: deptSelect.value,
        })
      );
    });

    ws.addEventListener("message", (ev) => {
      let msg;
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return;
      }

      if (msg.type === "joined") {
        myId = msg.id;
        minPlayers = msg.minPlayers || 3;
        updateButtons();
        return;
      }

      if (msg.type === "room_state") {
        applyRoomState(msg);
        return;
      }

      if (msg.type === "state") {
        roomPhase = msg.phase || roomPhase;
        applyState(msg);
        updateButtons();
      }
    });

    ws.addEventListener("close", () => {
      connHint.textContent = "Disconnected — refresh to reconnect";
      btnStart.disabled = true;
      btnPaddle.disabled = true;
    });

    ws.addEventListener("error", () => {
      connHint.textContent = "Connection error";
    });
  }

  function sendProfile() {
    localStorage.setItem("lopotaBoatRace.name", nameInput.value);
    localStorage.setItem("lopotaBoatRace.dept", deptSelect.value);
    if (ws && ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify({ type: "update_profile", name: nameInput.value || "Guest", dept: deptSelect.value }));
    }
  }

  nameInput.addEventListener("change", sendProfile);
  deptSelect.addEventListener("change", sendProfile);

  btnStart.addEventListener("click", () => {
    localStorage.setItem("lopotaBoatRace.len", lengthInput.value);
    if (!ws || ws.readyState !== ws.OPEN) return;
    ws.send(
      JSON.stringify({
        type: "start",
        trackLength: clamp(parseInt(lengthInput.value || "1300", 10) || 1300, 700, 2600),
      })
    );
  });

  btnReset.addEventListener("click", () => {
    if (!ws || ws.readyState !== ws.OPEN) return;
    ws.send(JSON.stringify({ type: "reset" }));
  });

  function paddle() {
    if (!ws || ws.readyState !== ws.OPEN) return;
    if (roomPhase !== "running") return;
    ws.send(JSON.stringify({ type: "paddle" }));
  }

  btnPaddle.addEventListener("click", paddle);

  window.addEventListener("keydown", (e) => {
    if (e.code === "Space") {
      e.preventDefault();
      if (roomPhase === "running") paddle();
      else if (!btnStart.disabled) btnStart.click();
    }
    if (e.code === "KeyR") {
      btnReset.click();
    }
  });

  connect();

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

  function drawBoat({ boat, w, h, waterY, margin, finishX, lanes }) {
    const laneH = (h - waterY - margin * 1.2) / Math.max(1, lanes);
    const laneY = waterY + margin * 0.6 + laneH * ((boat.lane ?? 0) + 0.5);
    const progress = (boat.x || 0) / trackLength;
    const x = lerp(margin + 80, finishX - 120, clamp(progress, 0, 1));

    const wobSeed = (boat.id || "").length * 0.1 + (boat.lane ?? 0) * 0.7;
    const wob = Math.sin((now() * 0.0022 + wobSeed) * 2) * 2.6;
    const pitch = Math.sin((now() * 0.0016 + wobSeed) * 2) * 0.025;

    const dept = getDept(boat.dept);

    ctx.save();
    ctx.translate(x, laneY + wob);
    ctx.rotate(pitch);

    ctx.globalAlpha = 0.22;
    ctx.fillStyle = "rgba(233,255,246,.7)";
    ctx.beginPath();
    ctx.ellipse(-58, 10, 42, 10, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;

    ctx.fillStyle = "rgba(0,0,0,.35)";
    roundRectPath(-54, -10, 120, 34, 16);
    ctx.fill();
    ctx.fillStyle = dept.color;
    roundRectPath(-56, -14, 118, 34, 16);
    ctx.fill();

    ctx.globalAlpha = 0.92;
    ctx.drawImage(logoImg, -20, -8, 38, 16);
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

    const shirtColor = boat.id === myId ? "rgba(55,211,156,.22)" : "rgba(0,0,0,.22)";
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
    ctx.fillText(`${boat.name} (${boat.dept})`, -56, -34);
    ctx.shadowBlur = 0;

    const stamina = clamp(boat.stamina ?? 1, 0, 1);
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = "rgba(0,0,0,.35)";
    ctx.fillRect(-56, -48, 70, 6);
    ctx.fillStyle = stamina > 0.4 ? "rgba(55,211,156,.95)" : stamina > 0.2 ? "rgba(255,207,90,.95)" : "rgba(255,107,107,.95)";
    ctx.fillRect(-56, -48, 70 * stamina, 6);
    ctx.globalAlpha = 1;

    ctx.restore();
  }

  function drawOverlay(w, h, lanes) {
    const pad = 14;
    ctx.save();
    ctx.globalAlpha = 0.65;
    ctx.fillStyle = "rgba(0,0,0,.26)";
    ctx.fillRect(pad, pad, 360, 62);
    ctx.globalAlpha = 1;
    ctx.fillStyle = "rgba(233,255,246,.92)";
    ctx.font = "700 14px ui-sans-serif, system-ui, -apple-system, Segoe UI, Arial";
    ctx.fillText("Lopota Lake Boat Race", pad + 12, pad + 22);
    ctx.font = "600 12px ui-sans-serif, system-ui, -apple-system, Segoe UI, Arial";
    ctx.fillStyle = "rgba(188,235,220,.92)";
    const len = `${trackLength}m · ${lanes} players · ${roomPhase}`;
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

    const lanes = Math.max(1, boats.length);

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

    for (const boat of boats) {
      drawBoat({ boat, w, h, waterY, margin, finishX, lanes });
    }

    drawOverlay(w, h, lanes);
  }

  function loop() {
    render();
    requestAnimationFrame(loop);
  }

  requestAnimationFrame(loop);
}

main().catch((err) => {
  console.error(err);
  alert("Game failed to load. Check console for details.");
});
