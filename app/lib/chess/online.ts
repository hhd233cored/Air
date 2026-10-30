import type { BoardSquare, ChessPiece, GameStatus, MoveRecord, PieceColor } from "./engine";

export interface OnlineCredentials {
  humanToken?: string;
  inviteToken?: string;
}

export interface ServerGameState {
  id: string;
  version: number;
  humanColor?: PieceColor;
  playerColor?: PieceColor;
  board: (ChessPiece | null)[][];
  turn: PieceColor;
  castling: { wK: boolean; wQ: boolean; bK: boolean; bQ: boolean };
  enPassant: BoardSquare | null;
  halfMoveClock: number;
  fullMoveNumber: number;
  positionCounts?: Record<string, number>;
  status?: GameStatus;
  history: MoveRecord[];
  phase: "waiting" | "playing" | "finished";
  presence?: { w: boolean; b: boolean };
  pendingAction?: { id: string; type: "undo" | "reset" | "draw"; by: PieceColor } | null;
  credentials?: OnlineCredentials;
  inviteToken?: string;
}

type ConnectionState = "idle" | "connecting" | "connected" | "error";
type Stream = Pick<EventSource, "addEventListener" | "close" | "readyState" | "onopen" | "onerror">;
type Storage = Pick<globalThis.Storage, "getItem" | "setItem">;

const ERROR_MESSAGES: Record<string, string> = {
  waiting_for_opponent: "等待另一位玩家通过邀请链接入座后，才能开始走棋。",
  version_conflict: "棋局已有更新，已同步最新状态，请重新选择走法。",
  not_your_turn: "还没轮到你走棋。",
  invalid_token: "玩家凭证无效，请使用原来的浏览器恢复席位。",
  invalid_invite: "邀请信息无效，请向创建者索取完整邀请链接。",
  room_full: "双方席位均已有人，请使用房间号观战。",
  illegal_move: "这步棋不符合规则，请重新选择。",
  game_over: "对局已经结束，可以向对手申请重开。",
  not_found: "没有找到这个房间，请检查房间号或邀请链接。",
  action_pending: "已有待确认的请求，请先处理该请求。",
  no_matching_action: "这条请求已经失效，已同步最新棋局。",
  no_moves: "当前没有可以撤回的走棋。",
  rate_limited: "请求过于频繁，请稍后重试。",
};

export class ChessApiError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string) {
    super(ERROR_MESSAGES[code] || `游戏请求失败（HTTP ${status}），请稍后重试。`);
    this.status = status;
    this.code = code;
  }
}

export function parseRoomInput(input: string, base = "http://localhost/") {
  let id = input.trim();
  let inviteToken: string | undefined;
  if (id.includes("?") || id.includes("://")) {
    const url = new URL(id, base);
    id = url.searchParams.get("game") || "";
    inviteToken = new URLSearchParams(url.hash.slice(1)).get("invite") || undefined;
  }
  if (!/^[a-zA-Z0-9_-]{8,64}$/.test(id)) {
    throw new Error("请输入有效的房间号，或粘贴完整邀请链接。");
  }
  return { id, inviteToken };
}

export function makeInvitationUrl(pageUrl: string, id: string, inviteToken: string) {
  const url = new URL(pageUrl);
  url.searchParams.set("page", "chess");
  url.searchParams.set("game", id);
  url.hash = new URLSearchParams({ invite: inviteToken }).toString();
  return url.toString();
}

interface Options {
  baseUrl: string;
  storage: Storage;
  onState: (state: ServerGameState, initial: boolean) => void;
  onConnection: (state: ConnectionState) => void;
  fetch?: typeof fetch;
  openStream?: (url: string) => Stream;
}

/** Owns a room connection independently of React renders and board selection. */
export class OnlineChessClient {
  private options: Options;
  private base: string;
  private state: ServerGameState | null = null;
  private session: OnlineCredentials | null = null;
  private color?: PieceColor;
  private room = "";
  private generation = 0;
  private stream: Stream | null = null;
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private lastActivity = 0;

  constructor(options: Options) {
    this.options = options;
    this.base = options.baseUrl.trim().replace(/\/+$/, "");
  }

  private key(id: string) { return `airchess:${this.base}:${id}`; }

  private readSession(id: string): OnlineCredentials | null {
    try {
      const saved = this.options.storage.getItem(this.key(id));
      if (saved) return JSON.parse(saved);
      // Preserve seats created by the original frontend.
      const legacy = JSON.parse(this.options.storage.getItem("atelier_chess_tokens") || "{}");
      return legacy[id] || null;
    } catch { return null; }
  }

  private saveSession(id: string, credentials: OnlineCredentials) {
    // A failed write must be reported before claiming an unrecoverable player seat.
    this.options.storage.setItem(this.key(id), JSON.stringify(credentials));
  }

  private async request<T>(path: string, body?: unknown, token?: string): Promise<T> {
    const headers: Record<string, string> = {};
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (token) headers.Authorization = `Bearer ${token}`;
    const response = await (this.options.fetch || fetch)(`${this.base}${path}`, {
      method: body === undefined ? "GET" : "POST", headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: "no-store", signal: AbortSignal.timeout(10_000),
    });
    const payload = await response.json();
    if (!response.ok) throw new ChessApiError(response.status, payload.detail?.code || "unknown");
    return payload as T;
  }

  private accept(state: ServerGameState, initial = false) {
    if (state.id !== this.room || (this.state && state.version < this.state.version)) return;
    this.color = state.playerColor || state.humanColor || this.color;
    this.state = { ...state, playerColor: this.color, humanColor: this.color,
      credentials: this.session || undefined };
    this.options.onState(this.state, initial);
  }

  async create(color: PieceColor) {
    this.disconnect();
    const generation = this.generation;
    this.options.onConnection("connecting");
    const state = await this.request<ServerGameState>("/api/games", { humanColor: color });
    if (generation !== this.generation) return;
    this.saveSession(state.id, { ...state.credentials, inviteToken: state.inviteToken });
    await this.connect(state.id);
  }

  async connect(input: string, base?: string) {
    const { id, inviteToken } = parseRoomInput(input, base);
    this.disconnect();
    const generation = this.generation;
    this.room = id;
    this.session = this.readSession(id);
    this.color = undefined;
    this.state = null;
    this.options.onConnection("connecting");
    const path = `/api/games/${encodeURIComponent(id)}`;
    let state: ServerGameState;
    if (this.session?.humanToken) {
      state = await this.request<ServerGameState>(`${path}/me`, undefined, this.session.humanToken);
    } else if (inviteToken) {
      // Persist the chosen token before joining; a lost response can be safely retried.
      const pendingKey = `${this.key(id)}:joining`;
      const token = this.options.storage.getItem(pendingKey)
        || Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2, "0")).join("");
      this.options.storage.setItem(pendingKey, token);
      state = await this.request<ServerGameState>(`${path}/join`, { inviteToken, playerToken: token });
      if (generation !== this.generation) return;
      this.session = { humanToken: token };
      this.saveSession(id, this.session);
    } else {
      // A room ID alone is a spectator link, never a player credential.
      state = await this.request<ServerGameState>(path);
    }
    if (generation !== this.generation) return;
    this.accept(state, true);
    const stream = (this.options.openStream || ((url) => new EventSource(url)))(`${this.base}${path}/events`);
    this.stream = stream;
    const ping = () => {
      if (generation !== this.generation || !this.session?.humanToken
        || stream.readyState !== 1 || Date.now() - this.lastActivity > 30_000) return;
      void this.request(`${path}/heartbeat`, {}, this.session.humanToken).catch(() => {});
    };
    stream.addEventListener("state", (event) => {
      if (generation !== this.generation) return;
      try {
        this.accept(JSON.parse((event as MessageEvent).data));
        this.lastActivity = Date.now();
        this.options.onConnection("connected");
      } catch { /* A subsequent full snapshot can recover a malformed event. */ }
    });
    stream.addEventListener("heartbeat", () => {
      if (generation !== this.generation) return;
      this.lastActivity = Date.now();
      this.options.onConnection("connected");
    });
    stream.onopen = () => {
      if (generation !== this.generation) return;
      this.lastActivity = Date.now();
      this.options.onConnection("connected");
      ping();
    };
    stream.onerror = () => {
      if (generation === this.generation) this.options.onConnection("error");
      // Leave EventSource open so the browser can reconnect automatically.
    };
    this.heartbeat = setInterval(() => {
      if (Date.now() - this.lastActivity > 30_000) this.options.onConnection("error");
      ping();
    }, 15_000);
  }

  async command(action: "moves" | "undo" | "reset" | "actions/respond", fields: Record<string, unknown> = {}) {
    if (!this.session?.humanToken || !this.state) throw new Error("当前为观战模式，请通过邀请链接领取席位。");
    if (this.state.phase === "waiting") throw new Error(ERROR_MESSAGES.waiting_for_opponent);
    const generation = this.generation;
    const token = this.session.humanToken;
    const path = `/api/games/${encodeURIComponent(this.room)}`;
    const body = { ...fields, version: this.state.version, requestId: crypto.randomUUID() };
    for (let attempt = 0; ; attempt++) {
      try {
        const state = await this.request<ServerGameState>(`${path}/${action}`, body, token);
        if (generation === this.generation) this.accept(state);
        return;
      } catch (error) {
        if (generation !== this.generation) return;
        if (!(error instanceof ChessApiError) && attempt === 0) continue;
        if (error instanceof ChessApiError && error.status === 409 && generation === this.generation) {
          this.accept(await this.request<ServerGameState>(`${path}/me`, undefined, token));
        }
        throw error;
      }
    }
  }

  invitation(pageUrl: string) {
    if (!this.session?.inviteToken) throw new Error("没有保存此房间的邀请信息，请由创建者新建房间并分享邀请链接。");
    return makeInvitationUrl(pageUrl, this.room, this.session.inviteToken);
  }

  disconnect() {
    this.generation++;
    this.stream?.close();
    this.stream = null;
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = null;
    this.options.onConnection("idle");
  }
}
