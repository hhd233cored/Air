export type PieceColor = "w" | "b";
export type PieceType = "p" | "n" | "b" | "r" | "q" | "k";
export type AIDifficulty = "casual" | "club" | "master";

export interface ChessPiece {
  type: PieceType;
  color: PieceColor;
}

export interface BoardSquare {
  r: number;
  c: number;
}

export interface ChessMove {
  from: BoardSquare;
  to: BoardSquare;
  captured?: ChessPiece;
  promotion?: PieceType;
  isDoublePawn?: boolean;
  isEnPassant?: boolean;
  epCaptureSquare?: BoardSquare;
  isCastle?: "K" | "Q";
  rookFrom?: BoardSquare;
  rookTo?: BoardSquare;
}

export interface CastlingRights {
  wK: boolean;
  wQ: boolean;
  bK: boolean;
  bQ: boolean;
}

export interface ChessSnapshot {
  board: (ChessPiece | null)[][];
  turn: PieceColor;
  castling: CastlingRights;
  enPassant: BoardSquare | null;
  halfMoveClock: number;
  fullMoveNumber: number;
  positionCounts: Record<string, number>;
}

export interface MoveRecord {
  move: ChessMove;
  piece: ChessPiece;
  san: string;
  uci?: string;
  snapshot?: ChessSnapshot;
}

export interface GameStatus {
  over: boolean;
  result: PieceColor | "draw" | null;
  reason: string | null;
  title?: string;
  subtitle?: string;
  inCheck: boolean;
}

export const FILES = ["a", "b", "c", "d", "e", "f", "g", "h"] as const;
export const RANKS = ["8", "7", "6", "5", "4", "3", "2", "1"] as const;

export const PIECE_RECTS: Record<string, [number, number, number, number]> = {
  br: [37, 307, 197, 223],
  bn: [251, 280, 243, 250],
  bb: [518, 263, 180, 267],
  bq: [735, 286, 233, 244],
  bk: [996, 268, 215, 262],
  bp: [1247, 328, 167, 202],
  wr: [34, 649, 202, 237],
  wn: [256, 622, 251, 264],
  wb: [512, 605, 192, 281],
  wq: [731, 637, 244, 249],
  wk: [991, 605, 225, 281],
  wp: [1243, 669, 174, 217],
};

export function renderPieceSVGMarkup(type: PieceType, color: PieceColor): string {
  const rect = PIECE_RECTS[color + type];
  if (!rect) return "";
  const [x, y, w, h] = rect;
  return (
    `<svg class="piece-svg piece-${color} piece-${type}" viewBox="0 0 300 300" aria-hidden="true">` +
    `<svg x="${(300 - w) / 2}" y="${290 - h}" width="${w}" height="${h}" viewBox="${x} ${y} ${w} ${h}" overflow="hidden">` +
    `<image href="/chess/piece-sheet.png" width="1448" height="1086" /></svg></svg>`
  );
}

export function moveToUCI(m: ChessMove): string {
  return `${FILES[m.from.c]}${RANKS[m.from.r]}${FILES[m.to.c]}${RANKS[m.to.r]}${m.promotion ?? ""}`;
}

const PIECE_VALUES: Record<PieceType, number> = {
  p: 100,
  n: 320,
  b: 330,
  r: 500,
  q: 900,
  k: 20000,
};

const MATERIAL_POINTS: Record<PieceType, number> = {
  p: 1,
  n: 3,
  b: 3,
  r: 5,
  q: 9,
  k: 0,
};

const PST: Record<string, number[][]> = {
  p: [
    [0, 0, 0, 0, 0, 0, 0, 0],
    [50, 50, 50, 50, 50, 50, 50, 50],
    [10, 10, 20, 30, 30, 20, 10, 10],
    [4, 6, 16, 28, 28, 14, 6, 4],
    [0, 4, 18, 26, 26, 10, 2, 0],
    [-4, -2, 6, 12, 12, 0, -2, -4],
    [8, 10, 0, -20, -20, 10, 10, 8],
    [0, 0, 0, 0, 0, 0, 0, 0],
  ],
  n: [
    [-50, -40, -30, -30, -30, -30, -40, -50],
    [-40, -20, 0, 0, 0, 0, -20, -40],
    [-30, 0, 10, 15, 15, 10, 0, -30],
    [-30, 5, 15, 20, 20, 15, 5, -30],
    [-30, 0, 15, 20, 20, 15, 0, -30],
    [-30, 5, 10, 15, 15, 10, 5, -30],
    [-40, -20, 0, 5, 5, 0, -20, -40],
    [-50, -40, -30, -30, -30, -30, -40, -50],
  ],
  b: [
    [-20, -10, -10, -10, -10, -10, -10, -20],
    [-10, 0, 0, 0, 0, 0, 0, -10],
    [-10, 0, 5, 10, 10, 5, 0, -10],
    [-10, 5, 5, 10, 10, 5, 5, -10],
    [-10, 0, 10, 10, 10, 10, 0, -10],
    [-10, 10, 10, 10, 10, 10, 10, -10],
    [-10, 5, 0, 0, 0, 0, 5, -10],
    [-20, -10, -10, -10, -10, -10, -10, -20],
  ],
  r: [
    [0, 0, 0, 0, 0, 0, 0, 0],
    [5, 10, 10, 10, 10, 10, 10, 5],
    [-5, 0, 0, 0, 0, 0, 0, -5],
    [-5, 0, 0, 0, 0, 0, 0, -5],
    [-5, 0, 0, 0, 0, 0, 0, -5],
    [-5, 0, 0, 0, 0, 0, 0, -5],
    [-5, 0, 0, 0, 0, 0, 0, -5],
    [0, 0, 0, 5, 5, 0, 0, 0],
  ],
  q: [
    [-20, -10, -10, -5, -5, -10, -10, -20],
    [-10, 0, 0, 0, 0, 0, 0, -10],
    [-10, 0, 5, 5, 5, 5, 0, -10],
    [-5, 0, 5, 5, 5, 5, 0, -5],
    [0, 0, 5, 5, 5, 5, 0, -5],
    [-10, 5, 5, 5, 5, 5, 0, -10],
    [-10, 0, 5, 0, 0, 0, 0, -10],
    [-20, -10, -10, -5, -5, -10, -10, -20],
  ],
  kMid: [
    [-30, -40, -40, -50, -50, -40, -40, -30],
    [-30, -40, -40, -50, -50, -40, -40, -30],
    [-30, -40, -40, -50, -50, -40, -40, -30],
    [-30, -40, -40, -50, -50, -40, -40, -30],
    [-20, -30, -30, -40, -40, -30, -30, -20],
    [-10, -20, -20, -20, -20, -20, -20, -10],
    [20, 20, 0, 0, 0, 0, 20, 20],
    [20, 30, 10, 0, 0, 10, 30, 20],
  ],
  kEnd: [
    [-50, -40, -30, -20, -20, -30, -40, -50],
    [-30, -20, -10, 0, 0, -10, -20, -30],
    [-30, -10, 20, 30, 30, 20, -10, -30],
    [-30, -10, 30, 40, 40, 30, -10, -30],
    [-30, -10, 30, 40, 40, 30, -10, -30],
    [-30, -10, 20, 30, 30, 20, -10, -30],
    [-30, -30, 0, 0, 0, 0, -30, -30],
    [-50, -30, -30, -30, -30, -30, -30, -50],
  ],
};

export class ChessGame {
  board: (ChessPiece | null)[][] = [];
  turn: PieceColor = "w";
  castling: CastlingRights = { wK: true, wQ: true, bK: true, bQ: true };
  enPassant: BoardSquare | null = null;
  halfMoveClock = 0;
  fullMoveNumber = 1;
  history: MoveRecord[] = [];
  positionCounts: Record<string, number> = {};

  constructor() {
    this.reset();
  }

  reset() {
    this.board = this._createInitialBoard();
    this.turn = "w";
    this.castling = { wK: true, wQ: true, bK: true, bQ: true };
    this.enPassant = null;
    this.halfMoveClock = 0;
    this.fullMoveNumber = 1;
    this.history = [];
    this.positionCounts = {};
    this._recordPosition();
  }

  private _createInitialBoard(): (ChessPiece | null)[][] {
    const backRank: PieceType[] = ["r", "n", "b", "q", "k", "b", "n", "r"];
    const board: (ChessPiece | null)[][] = Array.from({ length: 8 }, () => Array(8).fill(null));

    for (let c = 0; c < 8; c++) {
      board[0][c] = { type: backRank[c], color: "b" };
      board[1][c] = { type: "p", color: "b" };
      board[6][c] = { type: "p", color: "w" };
      board[7][c] = { type: backRank[c], color: "w" };
    }
    return board;
  }

  cloneState(): ChessSnapshot {
    return {
      board: this.board.map((row) => row.map((cell) => (cell ? { ...cell } : null))),
      turn: this.turn,
      castling: { ...this.castling },
      enPassant: this.enPassant ? { ...this.enPassant } : null,
      halfMoveClock: this.halfMoveClock,
      fullMoveNumber: this.fullMoveNumber,
      positionCounts: { ...this.positionCounts },
    };
  }

  getPositionKey(): string {
    let key = "";
    for (let r = 0; r < 8; r++) {
      let empty = 0;
      for (let c = 0; c < 8; c++) {
        const p = this.board[r][c];
        if (!p) {
          empty++;
        } else {
          if (empty > 0) {
            key += empty;
            empty = 0;
          }
          key += p.color === "w" ? p.type.toUpperCase() : p.type;
        }
      }
      if (empty > 0) key += empty;
      if (r < 7) key += "/";
    }
    const cStr =
      (this.castling.wK ? "K" : "") +
        (this.castling.wQ ? "Q" : "") +
        (this.castling.bK ? "k" : "") +
        (this.castling.bQ ? "q" : "") || "-";
    const epStr = this.enPassant ? `${FILES[this.enPassant.c]}${RANKS[this.enPassant.r]}` : "-";
    return `${key} ${this.turn} ${cStr} ${epStr}`;
  }

  getFEN(): string {
    return `${this.getPositionKey()} ${this.halfMoveClock} ${this.fullMoveNumber}`;
  }

  private _recordPosition() {
    const key = this.getPositionKey();
    this.positionCounts[key] = (this.positionCounts[key] || 0) + 1;
  }

  inBounds(r: number, c: number): boolean {
    return r >= 0 && r < 8 && c >= 0 && c < 8;
  }

  findKing(color: PieceColor, board = this.board): BoardSquare | null {
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const p = board[r][c];
        if (p && p.color === color && p.type === "k") {
          return { r, c };
        }
      }
    }
    return null;
  }

  isSquareAttacked(r: number, c: number, byColor: PieceColor, board = this.board): boolean {
    const pawnRow = byColor === "w" ? r + 1 : r - 1;
    if (pawnRow >= 0 && pawnRow < 8) {
      if (c - 1 >= 0) {
        const p1 = board[pawnRow][c - 1];
        if (p1 && p1.color === byColor && p1.type === "p") return true;
      }
      if (c + 1 < 8) {
        const p2 = board[pawnRow][c + 1];
        if (p2 && p2.color === byColor && p2.type === "p") return true;
      }
    }

    const knightJumps = [
      [-2, -1], [-2, 1], [-1, -2], [-1, 2],
      [1, -2], [1, 2], [2, -1], [2, 1],
    ];
    for (let i = 0; i < knightJumps.length; i++) {
      const nr = r + knightJumps[i][0];
      const nc = c + knightJumps[i][1];
      if (nr >= 0 && nr < 8 && nc >= 0 && nc < 8) {
        const p = board[nr][nc];
        if (p && p.color === byColor && p.type === "n") return true;
      }
    }

    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (dr === 0 && dc === 0) continue;
        const nr = r + dr;
        const nc = c + dc;
        if (nr >= 0 && nr < 8 && nc >= 0 && nc < 8) {
          const p = board[nr][nc];
          if (p && p.color === byColor && p.type === "k") return true;
        }
      }
    }

    const orthoDirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
    for (let i = 0; i < orthoDirs.length; i++) {
      let nr = r + orthoDirs[i][0];
      let nc = c + orthoDirs[i][1];
      while (nr >= 0 && nr < 8 && nc >= 0 && nc < 8) {
        const p = board[nr][nc];
        if (p) {
          if (p.color === byColor && (p.type === "r" || p.type === "q")) return true;
          break;
        }
        nr += orthoDirs[i][0];
        nc += orthoDirs[i][1];
      }
    }

    const diagDirs = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
    for (let i = 0; i < diagDirs.length; i++) {
      let nr = r + diagDirs[i][0];
      let nc = c + diagDirs[i][1];
      while (nr >= 0 && nr < 8 && nc >= 0 && nc < 8) {
        const p = board[nr][nc];
        if (p) {
          if (p.color === byColor && (p.type === "b" || p.type === "q")) return true;
          break;
        }
        nr += diagDirs[i][0];
        nc += diagDirs[i][1];
      }
    }

    return false;
  }

  isInCheck(color: PieceColor = this.turn, board = this.board): boolean {
    const kingPos = this.findKing(color, board);
    if (!kingPos) return false;
    const opp: PieceColor = color === "w" ? "b" : "w";
    return this.isSquareAttacked(kingPos.r, kingPos.c, opp, board);
  }

  generatePseudoMoves(r: number, c: number): ChessMove[] {
    const piece = this.board[r][c];
    if (!piece) return [];
    const { type, color } = piece;
    const opp: PieceColor = color === "w" ? "b" : "w";
    const moves: ChessMove[] = [];

    if (type === "p") {
      const dir = color === "w" ? -1 : 1;
      const startRow = color === "w" ? 6 : 1;
      const promoRow = color === "w" ? 0 : 7;

      const r1 = r + dir;
      if (this.inBounds(r1, c) && !this.board[r1][c]) {
        if (r1 === promoRow) {
          (["q", "r", "b", "n"] as PieceType[]).forEach((promo) => {
            moves.push({ from: { r, c }, to: { r: r1, c }, promotion: promo });
          });
        } else {
          moves.push({ from: { r, c }, to: { r: r1, c } });
          const r2 = r + dir * 2;
          if (r === startRow && !this.board[r2][c]) {
            moves.push({ from: { r, c }, to: { r: r2, c }, isDoublePawn: true });
          }
        }
      }

      [-1, 1].forEach((dc) => {
        const nc = c + dc;
        if (!this.inBounds(r1, nc)) return;
        const target = this.board[r1][nc];
        if (target && target.color === opp) {
          if (r1 === promoRow) {
            (["q", "r", "b", "n"] as PieceType[]).forEach((promo) => {
              moves.push({ from: { r, c }, to: { r: r1, c: nc }, captured: target, promotion: promo });
            });
          } else {
            moves.push({ from: { r, c }, to: { r: r1, c: nc }, captured: target });
          }
        } else if (this.enPassant && this.enPassant.r === r1 && this.enPassant.c === nc) {
          const epCaptured = this.board[r][nc];
          if (epCaptured && epCaptured.color === opp && epCaptured.type === "p") {
            moves.push({
              from: { r, c },
              to: { r: r1, c: nc },
              captured: epCaptured,
              isEnPassant: true,
              epCaptureSquare: { r, c: nc },
            });
          }
        }
      });
    } else if (type === "n") {
      const jumps = [
        [-2, -1], [-2, 1], [-1, -2], [-1, 2],
        [1, -2], [1, 2], [2, -1], [2, 1],
      ];
      jumps.forEach(([dr, dc]) => {
        const nr = r + dr;
        const nc = c + dc;
        if (!this.inBounds(nr, nc)) return;
        const target = this.board[nr][nc];
        if (!target) {
          moves.push({ from: { r, c }, to: { r: nr, c: nc } });
        } else if (target.color === opp) {
          moves.push({ from: { r, c }, to: { r: nr, c: nc }, captured: target });
        }
      });
    } else if (type === "b" || type === "r" || type === "q") {
      const dirs: [number, number][] = [];
      if (type === "b" || type === "q") {
        dirs.push([-1, -1], [-1, 1], [1, -1], [1, 1]);
      }
      if (type === "r" || type === "q") {
        dirs.push([-1, 0], [1, 0], [0, -1], [0, 1]);
      }
      dirs.forEach(([dr, dc]) => {
        let nr = r + dr;
        let nc = c + dc;
        while (this.inBounds(nr, nc)) {
          const target = this.board[nr][nc];
          if (!target) {
            moves.push({ from: { r, c }, to: { r: nr, c: nc } });
          } else {
            if (target.color === opp) {
              moves.push({ from: { r, c }, to: { r: nr, c: nc }, captured: target });
            }
            break;
          }
          nr += dr;
          nc += dc;
        }
      });
    } else if (type === "k") {
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          if (dr === 0 && dc === 0) continue;
          const nr = r + dr;
          const nc = c + dc;
          if (!this.inBounds(nr, nc)) continue;
          const target = this.board[nr][nc];
          if (!target) {
            moves.push({ from: { r, c }, to: { r: nr, c: nc } });
          } else if (target.color === opp) {
            moves.push({ from: { r, c }, to: { r: nr, c: nc }, captured: target });
          }
        }
      }

      const homeRow = color === "w" ? 7 : 0;
      if (r === homeRow && c === 4 && !this.isInCheck(color)) {
        const canKingSide = color === "w" ? this.castling.wK : this.castling.bK;
        const canQueenSide = color === "w" ? this.castling.wQ : this.castling.bQ;

        if (
          canKingSide &&
          !this.board[homeRow][5] &&
          !this.board[homeRow][6] &&
          this.board[homeRow][7] &&
          this.board[homeRow][7]?.type === "r" &&
          this.board[homeRow][7]?.color === color &&
          !this.isSquareAttacked(homeRow, 5, opp) &&
          !this.isSquareAttacked(homeRow, 6, opp)
        ) {
          moves.push({
            from: { r: homeRow, c: 4 },
            to: { r: homeRow, c: 6 },
            isCastle: "K",
            rookFrom: { r: homeRow, c: 7 },
            rookTo: { r: homeRow, c: 5 },
          });
        }

        if (
          canQueenSide &&
          !this.board[homeRow][3] &&
          !this.board[homeRow][2] &&
          !this.board[homeRow][1] &&
          this.board[homeRow][0] &&
          this.board[homeRow][0]?.type === "r" &&
          this.board[homeRow][0]?.color === color &&
          !this.isSquareAttacked(homeRow, 3, opp) &&
          !this.isSquareAttacked(homeRow, 2, opp)
        ) {
          moves.push({
            from: { r: homeRow, c: 4 },
            to: { r: homeRow, c: 2 },
            isCastle: "Q",
            rookFrom: { r: homeRow, c: 0 },
            rookTo: { r: homeRow, c: 3 },
          });
        }
      }
    }

    return moves;
  }

  isMoveLegal(move: ChessMove): boolean {
    const { from, to } = move;
    const piece = this.board[from.r][from.c];
    if (!piece) return false;

    const savedFrom = this.board[from.r][from.c];
    const savedTo = this.board[to.r][to.c];
    let savedEp: ChessPiece | null = null;

    this.board[to.r][to.c] = move.promotion ? { type: move.promotion, color: piece.color } : piece;
    this.board[from.r][from.c] = null;

    if (move.isEnPassant && move.epCaptureSquare) {
      savedEp = this.board[move.epCaptureSquare.r][move.epCaptureSquare.c];
      this.board[move.epCaptureSquare.r][move.epCaptureSquare.c] = null;
    }

    const inCheck = this.isInCheck(piece.color, this.board);

    this.board[from.r][from.c] = savedFrom;
    this.board[to.r][to.c] = savedTo;
    if (move.isEnPassant && move.epCaptureSquare) {
      this.board[move.epCaptureSquare.r][move.epCaptureSquare.c] = savedEp;
    }

    return !inCheck;
  }

  getLegalMovesForSquare(r: number, c: number): ChessMove[] {
    const piece = this.board[r][c];
    if (!piece || piece.color !== this.turn) return [];
    const pseudo = this.generatePseudoMoves(r, c);
    return pseudo.filter((m) => this.isMoveLegal(m));
  }

  getLegalMovesFrom(r: number, c: number): ChessMove[] {
    return this.getLegalMovesForSquare(r, c);
  }

  getAllLegalMoves(color: PieceColor = this.turn): ChessMove[] {
    const savedTurn = this.turn;
    this.turn = color;
    const allMoves: ChessMove[] = [];
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const p = this.board[r][c];
        if (p && p.color === color) {
          const pseudo = this.generatePseudoMoves(r, c);
          for (let i = 0; i < pseudo.length; i++) {
            if (this.isMoveLegal(pseudo[i])) {
              allMoves.push(pseudo[i]);
            }
          }
        }
      }
    }
    this.turn = savedTurn;
    return allMoves;
  }

  private _buildSAN(move: ChessMove, piece: ChessPiece, allLegalMovesBefore: ChessMove[]): string {
    if (move.isCastle === "K") return "O-O";
    if (move.isCastle === "Q") return "O-O-O";

    const destSquare = `${FILES[move.to.c]}${RANKS[move.to.r]}`;
    const isCapture = Boolean(move.captured);

    if (piece.type === "p") {
      let san = isCapture ? `${FILES[move.from.c]}x${destSquare}` : destSquare;
      if (move.promotion) {
        san += `=${move.promotion.toUpperCase()}`;
      }
      return san;
    }

    const pieceLetter = piece.type.toUpperCase();
    let disambig = "";

    const ambiguous = allLegalMovesBefore.filter(
      (m) =>
        m !== move &&
        (m.from.r !== move.from.r || m.from.c !== move.from.c) &&
        m.to.r === move.to.r &&
        m.to.c === move.to.c &&
        this.board[m.from.r][m.from.c] &&
        this.board[m.from.r][m.from.c]?.type === piece.type,
    );

    if (ambiguous.length > 0) {
      const sameFile = ambiguous.some((m) => m.from.c === move.from.c);
      const sameRank = ambiguous.some((m) => m.from.r === move.from.r);
      if (!sameFile) {
        disambig = FILES[move.from.c];
      } else if (!sameRank) {
        disambig = RANKS[move.from.r];
      } else {
        disambig = `${FILES[move.from.c]}${RANKS[move.from.r]}`;
      }
    }

    return `${pieceLetter}${disambig}${isCapture ? "x" : ""}${destSquare}`;
  }

  makeMove(move: ChessMove, { recordSAN = true }: { recordSAN?: boolean } = {}): MoveRecord | null {
    const snapshot = this.cloneState();
    const piece = this.board[move.from.r][move.from.c];
    if (!piece) return null;

    const allLegalBefore = recordSAN ? this.getAllLegalMoves(this.turn) : [];
    let san = recordSAN ? this._buildSAN(move, piece, allLegalBefore) : "";

    this.board[move.to.r][move.to.c] = move.promotion ? { type: move.promotion, color: piece.color } : piece;
    this.board[move.from.r][move.from.c] = null;

    if (move.isEnPassant && move.epCaptureSquare) {
      this.board[move.epCaptureSquare.r][move.epCaptureSquare.c] = null;
    }

    if (move.isCastle && move.rookFrom && move.rookTo) {
      const rook = this.board[move.rookFrom.r][move.rookFrom.c];
      this.board[move.rookTo.r][move.rookTo.c] = rook;
      this.board[move.rookFrom.r][move.rookFrom.c] = null;
    }

    if (piece.type === "k") {
      if (piece.color === "w") {
        this.castling.wK = false;
        this.castling.wQ = false;
      } else {
        this.castling.bK = false;
        this.castling.bQ = false;
      }
    }
    if (piece.type === "r") {
      if (move.from.r === 7 && move.from.c === 0) this.castling.wQ = false;
      if (move.from.r === 7 && move.from.c === 7) this.castling.wK = false;
      if (move.from.r === 0 && move.from.c === 0) this.castling.bQ = false;
      if (move.from.r === 0 && move.from.c === 7) this.castling.bK = false;
    }
    if (move.to.r === 7 && move.to.c === 0) this.castling.wQ = false;
    if (move.to.r === 7 && move.to.c === 7) this.castling.wK = false;
    if (move.to.r === 0 && move.to.c === 0) this.castling.bQ = false;
    if (move.to.r === 0 && move.to.c === 7) this.castling.bK = false;

    if (move.isDoublePawn) {
      this.enPassant = {
        r: (move.from.r + move.to.r) / 2,
        c: move.from.c,
      };
    } else {
      this.enPassant = null;
    }

    if (piece.type === "p" || move.captured) {
      this.halfMoveClock = 0;
    } else {
      this.halfMoveClock++;
    }

    if (this.turn === "b") {
      this.fullMoveNumber++;
    }

    this.turn = this.turn === "w" ? "b" : "w";
    this._recordPosition();

    if (recordSAN) {
      const oppInCheck = this.isInCheck(this.turn);
      const oppMoves = this.getAllLegalMoves(this.turn);
      if (oppInCheck) {
        san += oppMoves.length === 0 ? "#" : "+";
      }
    }

    const record: MoveRecord = {
      move,
      piece: { ...piece },
      san,
      snapshot,
    };
    this.history.push(record);
    return record;
  }

  undoMove(): MoveRecord | null {
    if (this.history.length === 0) return null;
    const last = this.history.pop()!;
    const { snapshot } = last;
    if (snapshot) {
      this.board = snapshot.board;
      this.turn = snapshot.turn;
      this.castling = snapshot.castling;
      this.enPassant = snapshot.enPassant;
      this.halfMoveClock = snapshot.halfMoveClock;
      this.fullMoveNumber = snapshot.fullMoveNumber;
      this.positionCounts = snapshot.positionCounts;
    }
    return last;
  }

  isInsufficientMaterial(): boolean {
    const pieces: (ChessPiece & BoardSquare)[] = [];
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const p = this.board[r][c];
        if (p && p.type !== "k") {
          pieces.push({ ...p, r, c });
        }
      }
    }
    if (pieces.length === 0) return true;
    if (pieces.length === 1) {
      return pieces[0].type === "n" || pieces[0].type === "b";
    }
    if (pieces.length === 2) {
      if (pieces[0].type === "b" && pieces[1].type === "b" && pieces[0].color !== pieces[1].color) {
        const color0 = (pieces[0].r + pieces[0].c) % 2;
        const color1 = (pieces[1].r + pieces[1].c) % 2;
        return color0 === color1;
      }
    }
    return false;
  }

  getGameStatus(): GameStatus {
    const legalMoves = this.getAllLegalMoves(this.turn);
    const inCheck = this.isInCheck(this.turn);

    if (legalMoves.length === 0) {
      if (inCheck) {
        const winner: PieceColor = this.turn === "w" ? "b" : "w";
        return {
          over: true,
          result: winner,
          reason: "checkmate",
          title: winner === "w" ? "白方胜" : "黑方胜",
          subtitle: "将死 · Checkmate",
          inCheck: true,
        };
      }
      return {
        over: true,
        result: "draw",
        reason: "stalemate",
        title: "和棋",
        subtitle: "逼和 · Stalemate",
        inCheck: false,
      };
    }

    if (this.isInsufficientMaterial()) {
      return {
        over: true,
        result: "draw",
        reason: "insufficient",
        title: "和棋",
        subtitle: "子力不足 · Insufficient Material",
        inCheck,
      };
    }

    if (this.halfMoveClock >= 100) {
      return {
        over: true,
        result: "draw",
        reason: "fifty-move",
        title: "和棋",
        subtitle: "五十步规则 · 50-Move Rule",
        inCheck,
      };
    }

    const currentKey = this.getPositionKey();
    if ((this.positionCounts[currentKey] || 0) >= 3) {
      return {
        over: true,
        result: "draw",
        reason: "repetition",
        title: "和棋",
        subtitle: "三次重复局面 · Threefold Repetition",
        inCheck,
      };
    }

    return {
      over: false,
      result: null,
      reason: null,
      inCheck,
    };
  }

  getMaterialAndCaptures() {
    const startCounts: Record<PieceColor, Record<Exclude<PieceType, "k">, number>> = {
      w: { q: 1, r: 2, b: 2, n: 2, p: 8 },
      b: { q: 1, r: 2, b: 2, n: 2, p: 8 },
    };
    const currentCounts: Record<PieceColor, Record<Exclude<PieceType, "k">, number>> = {
      w: { q: 0, r: 0, b: 0, n: 0, p: 0 },
      b: { q: 0, r: 0, b: 0, n: 0, p: 0 },
    };

    let whiteScore = 0;
    let blackScore = 0;

    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const p = this.board[r][c];
        if (!p || p.type === "k") continue;
        currentCounts[p.color][p.type]++;
        if (p.color === "w") whiteScore += MATERIAL_POINTS[p.type];
        else blackScore += MATERIAL_POINTS[p.type];
      }
    }

    const capturedByWhite: PieceType[] = [];
    const capturedByBlack: PieceType[] = [];
    const order: Exclude<PieceType, "k">[] = ["q", "r", "b", "n", "p"];

    order.forEach((type) => {
      const missingBlack = Math.max(0, startCounts.b[type] - currentCounts.b[type]);
      for (let i = 0; i < missingBlack; i++) capturedByWhite.push(type);

      const missingWhite = Math.max(0, startCounts.w[type] - currentCounts.w[type]);
      for (let i = 0; i < missingWhite; i++) capturedByBlack.push(type);
    });

    return {
      capturedByWhite,
      capturedByBlack,
      whiteAdvantage: Math.max(0, whiteScore - blackScore),
      blackAdvantage: Math.max(0, blackScore - whiteScore),
    };
  }

  evaluateBoard(): number {
    let score = 0;
    let nonPawnMaterial = 0;

    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const p = this.board[r][c];
        if (p && p.type !== "k" && p.type !== "p") {
          nonPawnMaterial += PIECE_VALUES[p.type];
        }
      }
    }

    const isEndgame = nonPawnMaterial <= 2600;

    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const p = this.board[r][c];
        if (!p) continue;

        const base = PIECE_VALUES[p.type];
        const tableRow = p.color === "w" ? r : 7 - r;
        const positional =
          p.type === "k"
            ? isEndgame
              ? PST.kEnd[tableRow][c]
              : PST.kMid[tableRow][c]
            : PST[p.type][tableRow][c];

        if (p.color === "w") {
          score += base + positional;
        } else {
          score -= base + positional;
        }
      }
    }

    return score;
  }

  private _scoreMoveForOrdering(move: ChessMove): number {
    let score = 0;
    const attacker = this.board[move.from.r][move.from.c];
    if (move.captured) {
      const attackerVal = attacker ? PIECE_VALUES[attacker.type] : 100;
      score += 10 * PIECE_VALUES[move.captured.type] - attackerVal;
    }
    if (move.promotion) {
      score += PIECE_VALUES[move.promotion] * 8;
    }
    if (move.isCastle) {
      score += 80;
    }
    if (attacker && PST[attacker.type]) {
      const fromRow = attacker.color === "w" ? move.from.r : 7 - move.from.r;
      const toRow = attacker.color === "w" ? move.to.r : 7 - move.to.r;
      score += PST[attacker.type][toRow][move.to.c] - PST[attacker.type][fromRow][move.from.c];
    }
    return score;
  }

  private _orderMoves(moves: ChessMove[]): ChessMove[] {
    return moves
      .map((m) => ({ m, s: this._scoreMoveForOrdering(m) }))
      .sort((a, b) => b.s - a.s)
      .map((item) => item.m);
  }

  private _quiescence(alpha: number, beta: number, maximizingColor: PieceColor, depthLeft = 3): number {
    const standPat = maximizingColor === "w" ? this.evaluateBoard() : -this.evaluateBoard();

    if (standPat >= beta) return beta;
    if (alpha < standPat) alpha = standPat;
    if (depthLeft <= 0) return standPat;

    const allMoves = this.getAllLegalMoves(this.turn);
    const tacticalMoves = this._orderMoves(allMoves.filter((m) => m.captured || m.promotion));

    for (let i = 0; i < tacticalMoves.length; i++) {
      const move = tacticalMoves[i];
      this.makeMove(move, { recordSAN: false });
      const score = -this._quiescence(-beta, -alpha, this.turn, depthLeft - 1);
      this.undoMove();

      if (score >= beta) return beta;
      if (score > alpha) alpha = score;
    }

    return alpha;
  }

  private _negamax(depth: number, alpha: number, beta: number, colorSign: number): number {
    const currentKey = this.getPositionKey();
    if ((this.positionCounts[currentKey] || 0) >= 3) {
      return 0;
    }

    const moves = this.getAllLegalMoves(this.turn);
    if (moves.length === 0) {
      if (this.isInCheck(this.turn)) {
        return -19000 - depth * 100;
      }
      return 0;
    }

    if (depth === 0) {
      return this._quiescence(alpha, beta, this.turn, 2);
    }

    const ordered = this._orderMoves(moves);
    let best = -Infinity;

    for (let i = 0; i < ordered.length; i++) {
      const move = ordered[i];
      this.makeMove(move, { recordSAN: false });
      const val = -this._negamax(depth - 1, -beta, -alpha, -colorSign);
      this.undoMove();

      if (val > best) best = val;
      if (val > alpha) alpha = val;
      if (alpha >= beta) break;
    }

    return best;
  }

  computeBestMove(difficulty: AIDifficulty = "club"): ChessMove | null {
    const legalMoves = this.getAllLegalMoves(this.turn);
    if (legalMoves.length === 0) return null;
    if (legalMoves.length === 1) return legalMoves[0];

    const depthMap: Record<AIDifficulty, number> = {
      casual: 2,
      club: 3,
      master: 3,
    };
    const depth = depthMap[difficulty] || 3;
    const noiseRange = difficulty === "casual" ? 45 : difficulty === "club" ? 12 : 0;

    const ordered = this._orderMoves(legalMoves);
    let bestMove = ordered[0];
    let bestScore = -Infinity;
    let alpha = -Infinity;
    const beta = Infinity;

    for (let i = 0; i < ordered.length; i++) {
      const move = ordered[i];
      if (move.promotion && move.promotion !== "q") continue;

      this.makeMove(move, { recordSAN: false });
      const extraDepth = difficulty === "master" && ordered.length <= 18 ? depth : depth - 1;
      const rawScore = -this._negamax(extraDepth, -beta, -alpha, 1);
      this.undoMove();

      if (rawScore > alpha) {
        alpha = rawScore;
      }

      const noisyScore = noiseRange > 0 ? rawScore + (Math.random() - 0.5) * noiseRange : rawScore;

      if (noisyScore > bestScore) {
        bestScore = noisyScore;
        bestMove = move;
      }
    }

    return bestMove;
  }
}

export class SoundEffects {
  private ctx: AudioContext | null = null;
  enabled = true;

  init() {
    if (typeof window === "undefined") return;
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!this.ctx && AudioCtx) {
      this.ctx = new AudioCtx();
    }
    if (this.ctx && this.ctx.state === "suspended") {
      this.ctx.resume().catch(() => {});
    }
  }

  toggle(): boolean {
    this.enabled = !this.enabled;
    if (this.enabled) {
      this.playSelect();
    }
    return this.enabled;
  }

  private _woodTap(freq = 165, duration = 0.065, gainPeak = 0.18, delay = 0) {
    if (!this.enabled) return;
    this.init();
    if (!this.ctx) return;

    const now = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    const filter = this.ctx.createBiquadFilter();

    osc.type = "triangle";
    osc.frequency.setValueAtTime(freq, now);
    osc.frequency.exponentialRampToValueAtTime(freq * 0.42, now + duration);

    filter.type = "lowpass";
    filter.frequency.setValueAtTime(720, now);

    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(gainPeak, now + 0.006);
    gain.gain.exponentialRampToValueAtTime(0.0008, now + duration);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this.ctx.destination);

    osc.start(now);
    osc.stop(now + duration + 0.01);
  }

  playSelect() {
    this._woodTap(290, 0.035, 0.06, 0);
  }

  playMove() {
    this._woodTap(160, 0.07, 0.18, 0);
  }

  playCapture() {
    this._woodTap(220, 0.055, 0.22, 0);
    this._woodTap(135, 0.075, 0.2, 0.018);
  }

  playCastle() {
    this._woodTap(165, 0.065, 0.17, 0);
    this._woodTap(195, 0.065, 0.15, 0.085);
  }

  playCheck() {
    if (!this.enabled) return;
    this.init();
    if (!this.ctx) return;

    this._woodTap(185, 0.06, 0.16, 0);

    const now = this.ctx.currentTime + 0.02;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = "sine";
    osc.frequency.setValueAtTime(587.33, now);
    osc.frequency.exponentialRampToValueAtTime(580, now + 0.36);

    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(0.09, now + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0005, now + 0.38);

    osc.connect(gain);
    gain.connect(this.ctx.destination);

    osc.start(now);
    osc.stop(now + 0.4);
  }

  playGameOver(isWin = true) {
    if (!this.enabled) return;
    this.init();
    if (!this.ctx) return;

    const notes = isWin ? [440, 554.37, 659.25] : [392, 349.23, 329.63];
    notes.forEach((freq, idx) => {
      if (!this.ctx) return;
      const now = this.ctx.currentTime + idx * 0.09;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = "sine";
      osc.frequency.setValueAtTime(freq, now);

      gain.gain.setValueAtTime(0.001, now);
      gain.gain.linearRampToValueAtTime(0.075, now + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0005, now + 0.55);

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start(now);
      osc.stop(now + 0.58);
    });
  }
}
