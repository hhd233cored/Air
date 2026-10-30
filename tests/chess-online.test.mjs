import assert from "node:assert/strict";
import test from "node:test";
import { ChessApiError, OnlineChessClient, parseRoomInput } from "../app/lib/chess/online.ts";

const base = "http://127.0.0.1:8091";
const room = "test-room-1234567";
const token = "test-player-token-" + "x".repeat(32);
const snapshot = (version, extra = {}) => ({
  id: room, version, phase: "playing", history: [], turn: "w", ...extra,
});
const response = (state, status = 200) => new Response(JSON.stringify(state), {
  status, headers: { "Content-Type": "application/json" },
});

class FakeStream extends EventTarget {
  readyState = 1;
  onopen = null;
  onerror = null;
  closed = false;
  close() { this.closed = true; this.readyState = 2; }
  state(state) { this.dispatchEvent(new MessageEvent("state", { data: JSON.stringify(state) })); }
}

function harness(t, handle, entries = [[`airchess:${base}:${room}`, JSON.stringify({ humanToken: token })]]) {
  const storage = new Map(entries);
  const states = [];
  const connections = [];
  const streams = [];
  const requests = [];
  const client = new OnlineChessClient({
    baseUrl: base,
    storage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) },
    onState: (state, initial) => states.push({ state, initial }),
    onConnection: value => connections.push(value),
    fetch: async (url, options) => {
      const request = { url, method: options.method, headers: options.headers,
        body: options.body ? JSON.parse(options.body) : undefined };
      requests.push(request);
      return handle(request, requests.length);
    },
    openStream: () => { const stream = new FakeStream(); streams.push(stream); return stream; },
  });
  t.after(() => client.disconnect());
  return { client, states, storage, streams, requests, connections };
}

test("accepts room IDs and pasted invitation URLs without turning the whole URL into an ID", () => {
  assert.deepEqual(parseRoomInput(room), { id: room, inviteToken: undefined });
  assert.deepEqual(parseRoomInput(`http://localhost:3000/?page=chess&game=${room}#invite=secret`),
    { id: room, inviteToken: "secret" });
  assert.throws(() => parseRoomInput("http://localhost:3000/"), /房间号/);
});

test("a new guest claims the second seat and persists the token before the join request", async t => {
  let seenToken;
  const h = harness(t, request => {
    assert.equal(request.url, `${base}/api/games/${room}/join`);
    seenToken = request.body.playerToken;
    assert.equal(h.storage.get(`airchess:${base}:${room}:joining`), seenToken);
    assert.equal(request.body.inviteToken, "invitation");
    return response(snapshot(1, { humanColor: "b", playerColor: "b" }));
  }, []);
  await h.client.connect(`http://localhost:3000/?game=${room}#invite=invitation`);
  assert.equal(JSON.parse(h.storage.get(`airchess:${base}:${room}`)).humanToken, seenToken);
  assert.equal(h.states.at(-1).state.playerColor, "b");
  h.streams[0].state(snapshot(2));
  assert.equal(h.states.at(-1).state.playerColor, "b", "shared snapshots must preserve own seat");
});

test("a lost join response reuses the pre-saved player token", async t => {
  const tokens = [];
  const h = harness(t, request => {
    tokens.push(request.body.playerToken);
    if (tokens.length === 1) throw new TypeError("Connection lost");
    return response(snapshot(1, { playerColor: "b" }));
  }, []);
  const link = `http://localhost:3000/?game=${room}#invite=invitation`;
  await assert.rejects(h.client.connect(link), /Connection lost/);
  await h.client.connect(link);
  assert.equal(tokens[0], tokens[1]);
});

test("old browser credentials resume through /me instead of consuming a second seat", async t => {
  const h = harness(t, request => {
    assert.equal(request.url, `${base}/api/games/${room}/me`);
    assert.equal(request.headers.Authorization, `Bearer ${token}`);
    return response(snapshot(3, { playerColor: "w" }));
  }, [["atelier_chess_tokens", JSON.stringify({ [room]: { humanToken: token } })]]);
  await h.client.connect(room);
  assert.equal(h.states.at(-1).state.playerColor, "w");
  assert.throws(() => h.client.invitation("http://localhost:3000/"), /邀请信息/);
});

test("a room ID alone is spectating and cannot issue moves", async t => {
  const h = harness(t, () => response(snapshot(1)), []);
  await h.client.connect(room);
  await assert.rejects(h.client.command("moves", { move: "e2e4" }), /观战/);
  assert.equal(h.requests.length, 1);
});

test("waiting rooms explain why moves cannot start", async t => {
  const h = harness(t, () => response(snapshot(0, { phase: "waiting", playerColor: "w" })));
  await h.client.connect(room);
  await assert.rejects(h.client.command("moves", { move: "e2e4" }), /等待另一位玩家/);
  assert.equal(h.requests.length, 1);
});

test("latest SSE version is used for moves and an older HTTP response cannot roll back the board", async t => {
  const h = harness(t, request => {
    if (request.method === "GET") return response(snapshot(1, { playerColor: "w" }));
    assert.equal(request.body.version, 4);
    return response(snapshot(3));
  });
  await h.client.connect(room);
  h.streams[0].state(snapshot(4));
  await h.client.command("moves", { move: "e2e4" });
  assert.equal(h.states.at(-1).state.version, 4);
  assert.equal(h.streams.length, 1, "moves never reopen the stream");
});

test("same-version presence updates are delivered and SSE errors keep automatic reconnection alive", async t => {
  const h = harness(t, () => response(snapshot(1, { playerColor: "w" })));
  await h.client.connect(room);
  h.streams[0].state(snapshot(1, { presence: { w: true, b: true } }));
  assert.equal(h.states.at(-1).state.presence.b, true);
  h.streams[0].onerror(new Event("error"));
  assert.equal(h.connections.at(-1), "error");
  assert.equal(h.streams[0].closed, false);
  h.streams[0].state(snapshot(2));
  assert.equal(h.connections.at(-1), "connected");
});

test("a failed move retries with the same request ID and original payload", async t => {
  let posted = 0;
  const h = harness(t, request => {
    if (request.method === "GET") return response(snapshot(1, { playerColor: "w" }));
    posted++;
    if (posted === 1) throw new TypeError("Response lost");
    return response(snapshot(2));
  });
  await h.client.connect(room);
  await h.client.command("moves", { move: "e2e4" });
  assert.deepEqual(h.requests[1].body, h.requests[2].body);
  assert.equal(h.states.at(-1).state.version, 2);
});

test("version conflicts fetch authoritative state but never automatically replay the move", async t => {
  let reads = 0;
  const h = harness(t, request => {
    if (request.method === "GET") return response(snapshot(++reads, { playerColor: "w" }));
    return response({ detail: { code: "version_conflict" } }, 409);
  });
  await h.client.connect(room);
  await assert.rejects(h.client.command("moves", { move: "e2e4" }), error =>
    error instanceof ChessApiError && error.code === "version_conflict");
  assert.equal(h.states.at(-1).state.version, 2);
  assert.equal(h.requests.filter(request => request.method === "POST").length, 1);
});

test("new room invitations include invitation data, never the player's bearer token", async t => {
  const h = harness(t, request => response(snapshot(0, {
    phase: "waiting", playerColor: "w",
    ...(request.method === "POST" ? { credentials: { humanToken: token }, inviteToken: "invite-secret" } : {}),
  })), []);
  await h.client.create("w");
  const invitation = h.client.invitation("http://localhost:3000/");
  assert.equal(new URL(invitation).searchParams.get("game"), room);
  assert.equal(new URL(invitation).hash, "#invite=invite-secret");
  assert.ok(!invitation.includes(token));
});
