const http = require("http");
const fs = require("fs");
const path = require("path");
const { performance } = require("perf_hooks");
const { WebSocketServer } = require("ws");

const PORT = parseInt(process.env.PORT || "3000", 10);
const ROOT = __dirname;
const MIN_PLAYERS_TO_START = 3;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".svg": "image/svg+xml; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".json": "application/json; charset=utf-8",
};

function clamp(v, a, b) {
  return Math.max(a, Math.min(b, v));
}
function lerp(a, b, t) {
  return a + (b - a) * t;
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
  return 0.03 + 0.1 * spam;
}
function staminaRegen(dt) {
  return 0.07 * dt;
}

function id6() {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}
function safeRoomId(x) {
  const s = String(x || "").trim().toUpperCase();
  if (!s) return null;
  if (!/^[A-Z0-9_-]{2,24}$/.test(s)) return null;
  return s;
}
function safeName(x) {
  const s = String(x || "").trim();
  if (!s) return "Guest";
  return s.slice(0, 18);
}
function safeDept(x) {
  const s = String(x || "").trim();
  return s.slice(0, 28);
}

function jsonSend(ws, obj) {
  if (ws.readyState !== ws.OPEN) return;
  ws.send(JSON.stringify(obj));
}

function broadcast(room, obj) {
  const msg = JSON.stringify(obj);
  for (const p of room.players.values()) {
    if (p.ws.readyState === p.ws.OPEN) p.ws.send(msg);
  }
}

function makeRoom(roomId) {
  return {
    id: roomId,
    phase: "lobby", // lobby | running | finished
    players: new Map(), // clientId -> player
    createdAt: Date.now(),
    seed: (Math.random() * 1e9) | 0,
    trackLength: 1300,
    startedAtMs: null,
    lastTickAt: null,
    interval: null,
  };
}

function roomPublicState(room) {
  return {
    room: room.id,
    phase: room.phase,
    minPlayers: MIN_PLAYERS_TO_START,
    players: [...room.players.values()].map((p) => ({
      id: p.id,
      name: p.name,
      dept: p.dept,
      joinedAt: p.joinedAt,
    })),
    trackLength: room.trackLength,
    seed: room.seed,
    startedAtMs: room.startedAtMs,
  };
}

function roomBoatsState(room) {
  const boats = [...room.players.values()]
    .sort((a, b) => a.lane - b.lane)
    .map((p) => ({
      id: p.id,
      name: p.name,
      dept: p.dept,
      lane: p.lane,
      x: p.boat.x,
      speed: p.boat.speed,
      stamina: p.boat.stamina,
      finishTimeMs: p.boat.finishTimeMs,
    }));

  let leaderId = null;
  let best = -1;
  for (const b of boats) {
    if (b.x > best) {
      best = b.x;
      leaderId = b.id;
    }
  }

  return {
    room: room.id,
    phase: room.phase,
    trackLength: room.trackLength,
    seed: room.seed,
    startedAtMs: room.startedAtMs,
    leaderId,
    boats,
    playersCount: boats.length,
    minPlayers: MIN_PLAYERS_TO_START,
  };
}

function startRoom(room, opts) {
  if (room.phase === "running") return;
  if (room.players.size < MIN_PLAYERS_TO_START) return;

  const trackLength = clamp(parseInt(opts?.trackLength || room.trackLength, 10) || 1300, 700, 2600);
  room.trackLength = trackLength;
  room.seed = ((Math.random() * 1e9) | 0) ^ (trackLength << 2) ^ (room.players.size << 7);
  room.phase = "running";
  room.startedAtMs = performance.now();
  room.lastTickAt = performance.now();

  // assign lanes deterministically by join order (stable)
  const players = [...room.players.values()].sort((a, b) => a.joinedAt - b.joinedAt);
  players.forEach((p, idx) => (p.lane = idx));

  for (const p of room.players.values()) {
    p.boat = {
      x: 0,
      speed: 120,
      stamina: 1,
      lastPaddleAt: 0,
      finishTimeMs: null,
    };
  }

  broadcast(room, { type: "room_state", ...roomPublicState(room) });

  if (room.interval) clearInterval(room.interval);
  room.interval = setInterval(() => tickRoom(room), 50);
}

function endRoom(room) {
  if (room.phase !== "running") return;
  room.phase = "finished";
  if (room.interval) {
    clearInterval(room.interval);
    room.interval = null;
  }
  broadcast(room, { type: "room_state", ...roomPublicState(room) });
}

function tickRoom(room) {
  if (room.phase !== "running") return;
  const t = performance.now();
  const dt = clamp((t - room.lastTickAt) / 1000, 0, 0.05);
  room.lastTickAt = t;

  const elapsedMs = t - room.startedAtMs;

  for (const p of room.players.values()) {
    const b = p.boat;
    if (!b || b.finishTimeMs != null) continue;

    b.stamina = clamp(b.stamina + staminaRegen(dt), 0, 1);
    const maxSpeed = computeBoatMaxSpeed(b.stamina);

    b.speed *= Math.pow(0.985, dt * 60);
    b.speed = Math.min(b.speed, maxSpeed);
    b.speed = Math.max(b.speed, 80);

    b.x += b.speed * dt * 0.72;
    if (b.x >= room.trackLength) {
      b.x = room.trackLength;
      b.finishTimeMs = elapsedMs;
    }
  }

  const allFinished = [...room.players.values()].every((p) => p.boat && p.boat.finishTimeMs != null);
  if (allFinished) endRoom(room);

  broadcast(room, { type: "state", ...roomBoatsState(room) });
}

const rooms = new Map();

function getOrCreateRoom(roomId) {
  let room = rooms.get(roomId);
  if (!room) {
    room = makeRoom(roomId);
    rooms.set(roomId, room);
  }
  return room;
}

function removePlayerFromRoom(room, clientId) {
  room.players.delete(clientId);
  if (room.players.size === 0) {
    if (room.interval) clearInterval(room.interval);
    rooms.delete(room.id);
    return;
  }

  // compact lanes (keeps rendering nice)
  const players = [...room.players.values()].sort((a, b) => a.joinedAt - b.joinedAt);
  players.forEach((p, idx) => (p.lane = idx));

  // if running and player count falls below min, end race
  if (room.phase === "running" && room.players.size < MIN_PLAYERS_TO_START) {
    endRoom(room);
    room.phase = "lobby";
    room.startedAtMs = null;
    room.lastTickAt = null;
  }

  broadcast(room, { type: "room_state", ...roomPublicState(room) });
  broadcast(room, { type: "state", ...roomBoatsState(room) });
}

function handleHttp(req, res) {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  if (url.pathname === "/healthz") {
    res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
    res.end("ok");
    return;
  }

  let filePath = url.pathname === "/" ? "/index.html" : url.pathname;
  filePath = decodeURIComponent(filePath);

  // prevent path traversal
  const fsPath = path.join(ROOT, filePath);
  const rel = path.relative(ROOT, fsPath);
  if (rel.startsWith("..") || path.isAbsolute(rel) && !rel) {
    res.writeHead(400, { "content-type": "text/plain; charset=utf-8" });
    res.end("bad request");
    return;
  }

  fs.stat(fsPath, (err, st) => {
    if (err || !st.isFile()) {
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      res.end("not found");
      return;
    }

    const ext = path.extname(fsPath).toLowerCase();
    res.writeHead(200, {
      "content-type": MIME[ext] || "application/octet-stream",
      "cache-control": ext === ".html" ? "no-store" : "public, max-age=300",
    });
    fs.createReadStream(fsPath).pipe(res);
  });
}

const server = http.createServer(handleHttp);

const wss = new WebSocketServer({ noServer: true });

server.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  if (url.pathname !== "/ws") {
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit("connection", ws, req);
  });
});

wss.on("connection", (ws, req) => {
  const clientId = `c_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

  let room = null;

  ws.on("message", (data) => {
    let msg;
    try {
      msg = JSON.parse(String(data));
    } catch {
      return;
    }

    if (msg?.type === "join") {
      const roomId = safeRoomId(msg.room) || id6();
      const name = safeName(msg.name);
      const dept = safeDept(msg.dept);

      room = getOrCreateRoom(roomId);
      if (room.players.has(clientId)) return;

      const joinedAt = Date.now();
      room.players.set(clientId, {
        id: clientId,
        ws,
        name,
        dept,
        joinedAt,
        lane: room.players.size,
        boat: {
          x: 0,
          speed: 120,
          stamina: 1,
          lastPaddleAt: 0,
          finishTimeMs: null,
        },
      });

      jsonSend(ws, { type: "joined", id: clientId, room: roomId, minPlayers: MIN_PLAYERS_TO_START });
      broadcast(room, { type: "room_state", ...roomPublicState(room) });
      broadcast(room, { type: "state", ...roomBoatsState(room) });
      return;
    }

    if (!room) return;
    const player = room.players.get(clientId);
    if (!player) return;

    if (msg?.type === "update_profile") {
      player.name = safeName(msg.name);
      player.dept = safeDept(msg.dept);
      broadcast(room, { type: "room_state", ...roomPublicState(room) });
      broadcast(room, { type: "state", ...roomBoatsState(room) });
      return;
    }

    if (msg?.type === "start") {
      startRoom(room, { trackLength: msg.trackLength });
      broadcast(room, { type: "state", ...roomBoatsState(room) });
      return;
    }

    if (msg?.type === "paddle") {
      if (room.phase !== "running") return;
      const b = player.boat;
      if (!b || b.finishTimeMs != null) return;
      const t = performance.now();
      const since = b.lastPaddleAt ? t - b.lastPaddleAt : 999;
      b.lastPaddleAt = t;
      b.speed += paddleImpulse(b.stamina, since);
      b.stamina = clamp(b.stamina - staminaDrain(since), 0, 1);
      return;
    }

    if (msg?.type === "reset") {
      room.phase = "lobby";
      room.startedAtMs = null;
      room.lastTickAt = null;
      if (room.interval) {
        clearInterval(room.interval);
        room.interval = null;
      }
      for (const p of room.players.values()) {
        p.boat = {
          x: 0,
          speed: 120,
          stamina: 1,
          lastPaddleAt: 0,
          finishTimeMs: null,
        };
      }
      broadcast(room, { type: "room_state", ...roomPublicState(room) });
      broadcast(room, { type: "state", ...roomBoatsState(room) });
    }
  });

  ws.on("close", () => {
    if (!room) return;
    removePlayerFromRoom(room, clientId);
  });

  ws.on("error", () => {
    // ignore
  });
});

server.listen(PORT, () => {
  console.log(`Lopota Boat Race server running on :${PORT}`);
});
