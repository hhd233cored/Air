"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  type AIDifficulty,
  type BoardSquare,
  ChessGame,
  type ChessMove,
  type ChessPiece,
  FILES,
  type GameStatus,
  type MoveRecord,
  moveToUCI,
  PIECE_RECTS,
  type PieceColor,
  type PieceType,
  RANKS,
  SoundEffects,
} from "../lib/chess/engine";
import { makeInvitationUrl, OnlineChessClient, type OnlineCredentials, type ServerGameState } from "../lib/chess/online";

export type ChessMode = "ai" | "local" | "online";
type OnlineConnectionState = "idle" | "connecting" | "connected" | "error" | "expired";

interface BoardViewSnapshot {
  board: (ChessPiece | null)[][];
  turn: PieceColor;
  fullMoveNumber: number;
  history: MoveRecord[];
  status: GameStatus;
  lastMove: ChessMove | null;
  checkedKingSq: BoardSquare | null;
  capturedByWhite: PieceType[];
  capturedByBlack: PieceType[];
  whiteAdvantage: number;
  blackAdvantage: number;
  fen: string;
}

function createBoardViewSnapshot(game: ChessGame, serverStatus?: GameStatus | null): BoardViewSnapshot {
  const status = serverStatus ? { ...game.getGameStatus(), ...serverStatus } : game.getGameStatus();
  if (status.over && !status.title) {
    status.title = status.result === "draw" ? "和棋" : status.result === "w" ? "白方胜" : "黑方胜";
    status.subtitle = status.reason === "agreement" ? "双方同意和棋" : status.reason === "resignation" ? "对手认输" : "对局结束";
  }
  const lastMove = game.history.length > 0 ? game.history[game.history.length - 1].move : null;
  const checkedKingSq = status.inCheck ? game.findKing(game.turn) : null;
  const { capturedByWhite, capturedByBlack, whiteAdvantage, blackAdvantage } = game.getMaterialAndCaptures();
  return {
    board: game.board.map((row) => row.map((cell) => (cell ? { ...cell } : null))),
    turn: game.turn,
    fullMoveNumber: game.fullMoveNumber,
    history: [...game.history],
    status,
    lastMove,
    checkedKingSq,
    capturedByWhite,
    capturedByBlack,
    whiteAdvantage,
    blackAdvantage,
    fen: game.getFEN(),
  };
}

const PROMO_NAMES: Record<PieceType, string> = {
  q: "后",
  r: "车",
  b: "象",
  n: "马",
  p: "兵",
  k: "王",
};

const SERVER_BASE_URL = (process.env.NEXT_PUBLIC_CHESS_API_BASE_URL || "").trim().replace(/\/+$/, "");

export function PieceGraphic({ type, color }: { type: PieceType; color: PieceColor }) {
  const rect = PIECE_RECTS[color + type];
  if (!rect) return null;
  const [x, y, w, h] = rect;
  return (
    <svg className={`piece-svg piece-${color} piece-${type}`} viewBox="0 0 300 300" aria-hidden="true">
      <svg x={(300 - w) / 2} y={290 - h} width={w} height={h} viewBox={`${x} ${y} ${w} ${h}`} overflow="hidden">
        <image href="/chess/piece-sheet.png" width="1448" height="1086" />
      </svg>
    </svg>
  );
}

export function ChessPage() {
  const gameRef = useRef<ChessGame>(new ChessGame());
  const sfxRef = useRef<SoundEffects | null>(null);
  const boardElRef = useRef<HTMLDivElement | null>(null);
  const moveListElRef = useRef<HTMLOListElement | null>(null);
  const dragGhostRef = useRef<HTMLDivElement | null>(null);
  const aiTimerRef = useRef<number | null>(null);
  const onlineClientRef = useRef<OnlineChessClient | null>(null);
  const serverStateRef = useRef<ServerGameState | null>(null);
  const soundForMoveRef = useRef<(prevLen: number) => void>(() => {});
  const onlineBusyRef = useRef(false);

  const [viewState, setViewState] = useState<BoardViewSnapshot>(() => createBoardViewSnapshot(new ChessGame()));
  const [mode, setMode] = useState<ChessMode>("ai");
  const [difficulty, setDifficulty] = useState<AIDifficulty>("club");
  const [playerColor, setPlayerColor] = useState<PieceColor>("w");
  const [flipped, setFlipped] = useState(false);
  const [autoFlipLocal, setAutoFlipLocal] = useState(false);

  const [selectedSquare, setSelectedSquare] = useState<BoardSquare | null>(null);
  const [legalMovesForSelected, setLegalMovesForSelected] = useState<ChessMove[]>([]);
  const [pendingPromotionMoves, setPendingPromotionMoves] = useState<ChessMove[] | null>(null);

  // Connection lifecycle is owned by OnlineChessClient, independent of board renders.
  const [onlineGameId, setOnlineGameId] = useState<string | null>(null);
  const [roomInput, setRoomInput] = useState<string>("");
  const [onlineState, setOnlineState] = useState<ServerGameState | null>(null);
  const [onlineClock, setOnlineClock] = useState(0);
  const [onlineBusy, setOnlineBusy] = useState(false);
  const [invitationLink, setInvitationLink] = useState("");
  const [onlineStatus, setOnlineStatus] = useState<OnlineConnectionState>("idle");
  const [onlineMessage, setOnlineMessage] = useState<string>("");
  const [credentials, setCredentials] = useState<OnlineCredentials | null>(null);
  const [copiedFeedback, setCopiedFeedback] = useState<string | null>(null);

  const aiThinking = mode === "ai" && !viewState.status.over && viewState.turn !== playerColor;

  // Drag state ref to avoid re-binding global pointer listeners on every frame
  const dragStateRef = useRef<{
    active: boolean;
    started: boolean;
    from: BoardSquare | null;
    piece: ChessPiece | null;
    startX: number;
    startY: number;
    legalMoves: ChessMove[];
    hoverKey: string | null;
  }>({
    active: false,
    started: false,
    from: null,
    piece: null,
    startX: 0,
    startY: 0,
    legalMoves: [],
    hoverKey: null,
  });

  const syncView = useCallback(() => {
    setViewState(createBoardViewSnapshot(gameRef.current, serverStateRef.current?.status));
  }, []);

  const getSfx = useCallback(() => {
    if (!sfxRef.current) {
      sfxRef.current = new SoundEffects();
    }
    return sfxRef.current;
  }, []);

  const playSoundForLastMove = useCallback(
    (prevLen: number) => {
      const game = gameRef.current;
      const sfx = getSfx();
      if (game.history.length <= prevLen) return;
      const lastEntry = game.history[game.history.length - 1];
      const status = game.getGameStatus();

      if (status.over) {
        const isWin =
          status.result === "draw"
            ? false
            : mode === "local"
              ? true
              : status.result === playerColor;
        sfx.playGameOver(isWin);
      } else if (status.inCheck) {
        sfx.playCheck();
      } else if (lastEntry?.move.isCastle) {
        sfx.playCastle();
      } else if (lastEntry?.move.captured) {
        sfx.playCapture();
      } else {
        sfx.playMove();
      }
    },
    [getSfx, mode, playerColor]
  );

  const animateBoardMove = useCallback((move: ChessMove, callback: () => void) => {
    const boardEl = boardElRef.current;
    if (!boardEl) {
      callback();
      return;
    }
    const fromSq = boardEl.querySelector<HTMLElement>(
      `.square[data-r="${move.from.r}"][data-c="${move.from.c}"]`
    );
    const toSq = boardEl.querySelector<HTMLElement>(
      `.square[data-r="${move.to.r}"][data-c="${move.to.c}"]`
    );
    const pieceEl = fromSq?.querySelector<HTMLElement>(".piece-container");

    if (!fromSq || !toSq || !pieceEl) {
      callback();
      return;
    }

    const fromRect = fromSq.getBoundingClientRect();
    const toRect = toSq.getBoundingClientRect();
    const dx = fromRect.left - toRect.left;
    const dy = fromRect.top - toRect.top;

    callback();

    window.requestAnimationFrame(() => {
      const newToSq = boardEl.querySelector<HTMLElement>(
        `.square[data-r="${move.to.r}"][data-c="${move.to.c}"]`
      );
      const newPieceEl = newToSq?.querySelector<HTMLElement>(".piece-container");
      if (!newPieceEl) return;

      newPieceEl.style.transition = "none";
      newPieceEl.style.transform = `translate(${dx}px, ${dy}px)`;

      window.requestAnimationFrame(() => {
        newPieceEl.style.transition = "transform 220ms cubic-bezier(0.22, 1, 0.36, 1)";
        newPieceEl.style.transform = "translate(0, 0)";
      });
    });
  }, []);

  useEffect(() => {
    soundForMoveRef.current = playSoundForLastMove;
  }, [playSoundForLastMove]);

  const loadServerState = useCallback(
    (state: ServerGameState, isInitial = false) => {
      const previous = serverStateRef.current;
      if (previous?.id === state.id && state.version < previous.version) return;
      serverStateRef.current = state;
      setOnlineState(state);
      setOnlineGameId(state.id);
      setRoomInput(state.id);
      setCredentials(state.credentials || null);
      if (isInitial) {
        const roomUrl = new URL(window.location.href);
        roomUrl.searchParams.set("page", "chess");
        roomUrl.searchParams.set("game", state.id);
        roomUrl.hash = "";
        window.history.replaceState(window.history.state, "", roomUrl);
        setInvitationLink(state.credentials?.inviteToken
          ? makeInvitationUrl(window.location.href, state.id, state.credentials.inviteToken) : "");
      }
      if (state.playerColor) {
        setPlayerColor(state.playerColor);
        if (isInitial) setFlipped(state.playerColor === "b");
      }
      // Presence updates have the same board version: keep the player's selection intact.
      if (!isInitial && previous?.id === state.id && previous.version === state.version
        && previous.phase === state.phase) return;
      setOnlineMessage("");
      const game = gameRef.current;
      const prevLen = game.history.length;
      game.board = state.board;
      game.turn = state.turn;
      game.castling = state.castling;
      game.enPassant = state.enPassant;
      game.halfMoveClock = state.halfMoveClock;
      game.fullMoveNumber = state.fullMoveNumber;
      game.positionCounts = state.positionCounts || {};
      game.history = state.history.map(h => ({ move: h.move, piece: h.piece, san: h.san, uci: h.uci }));
      setSelectedSquare(null);
      setLegalMovesForSelected([]);
      setPendingPromotionMoves(null);
      if (!isInitial && game.history.length > prevLen) {
        animateBoardMove(game.history[game.history.length - 1].move, () => {
          syncView();
          soundForMoveRef.current(prevLen);
        });
      } else {
        syncView();
      }
    },
    [animateBoardMove, syncView]
  );

  const closeOnlineStream = useCallback(() => {
    onlineClientRef.current?.disconnect();
  }, []);

  const runOnlineOperation = useCallback(async (operation: () => Promise<unknown>) => {
    if (onlineBusyRef.current) return false;
    onlineBusyRef.current = true;
    setOnlineBusy(true);
    try {
      await operation();
      setOnlineMessage("");
      return true;
    } catch (error) {
      setOnlineMessage(error instanceof Error ? error.message : "游戏请求失败，请检查连接后重试。");
      setOnlineStatus(current => current === "connecting" ? "error" : current);
      return false;
    } finally {
      onlineBusyRef.current = false;
      setOnlineBusy(false);
    }
  }, []);

  const createOnlineRoom = useCallback(
    async (preferredColor: PieceColor = playerColor) => {
      await runOnlineOperation(async () => {
        await onlineClientRef.current!.create(preferredColor);
      });
    }, [playerColor, runOnlineOperation]
  );

  const joinOnlineRoom = useCallback(async (input: string) => {
    await runOnlineOperation(async () => {
      await onlineClientRef.current!.connect(input, window.location.href);
    });
  }, [runOnlineOperation]);

  const sendOnlineCommand = useCallback((
    action: "moves" | "undo" | "reset" | "actions/respond",
    fields: Record<string, unknown> = {},
  ) => runOnlineOperation(async () => {
    await onlineClientRef.current!.command(action, fields);
  }), [runOnlineOperation]);

  // Only mount/unmount initializes the connection; board versions never reopen the stream.
  useEffect(() => {
    const client = new OnlineChessClient({
      baseUrl: SERVER_BASE_URL,
      storage: window.localStorage,
      onState: loadServerState,
      onConnection: setOnlineStatus,
    });
    onlineClientRef.current = client;
    const timer = window.setTimeout(() => {
      if (new URL(window.location.href).searchParams.has("game")) {
        setMode("online");
        void client.connect(window.location.href).catch(error => {
          setOnlineStatus("error");
          setOnlineMessage(error instanceof Error ? error.message : "无法连接棋局。");
        });
      }
    }, 0);
    return () => {
      window.clearTimeout(timer);
      client.disconnect();
      if (onlineClientRef.current === client) onlineClientRef.current = null;
    };
  }, [loadServerState]);

  useEffect(() => {
    if (mode !== "online" || !onlineState?.expiresAt || onlineState.phase === "expired") return;
    const timer = window.setInterval(() => setOnlineClock(performance.now()), 1000);
    return () => window.clearInterval(timer);
  }, [mode, onlineState?.expiresAt, onlineState?.phase]);

  // Auto-scroll move history
  useEffect(() => {
    if (moveListElRef.current) {
      moveListElRef.current.scrollTop = moveListElRef.current.scrollHeight;
    }
  }, [viewState.history.length]);

  // Trigger AI move when in AI mode and it's AI's turn
  useEffect(() => {
    if (aiTimerRef.current) {
      window.clearTimeout(aiTimerRef.current);
      aiTimerRef.current = null;
    }
    if (!aiThinking) return;

    aiTimerRef.current = window.setTimeout(() => {
      const game = gameRef.current;
      const aiMove = game.computeBestMove(difficulty);
      if (!aiMove) return;

      const prevLen = game.history.length;
      animateBoardMove(aiMove, () => {
        game.makeMove(aiMove, { recordSAN: true });
        syncView();
        playSoundForLastMove(prevLen);
      });
    }, 260);

    return () => {
      if (aiTimerRef.current) {
        window.clearTimeout(aiTimerRef.current);
        aiTimerRef.current = null;
      }
    };
  }, [aiThinking, animateBoardMove, difficulty, playSoundForLastMove, syncView]);

  const isPlayerTurn = useCallback(() => {
    const game = gameRef.current;
    const status = game.getGameStatus();
    if (status.over || aiThinking) return false;
    if (mode === "local") return true;
    if (mode === "online") {
      return Boolean(onlineGameId && onlineStatus === "connected" && !onlineBusyRef.current
        && credentials?.humanToken && onlineState?.phase === "playing"
        && game.turn === playerColor);
    }
    return game.turn === playerColor;
  }, [aiThinking, credentials, mode, onlineGameId, onlineState, onlineStatus, playerColor]);

  const executePlayerMove = useCallback(
    async (move: ChessMove) => {
      setSelectedSquare(null);
      setLegalMovesForSelected([]);
      setPendingPromotionMoves(null);

      if (mode === "online") {
        await sendOnlineCommand("moves", { move: moveToUCI(move) });
        return;
      }

      const game = gameRef.current;
      const prevLen = game.history.length;
      animateBoardMove(move, () => {
        game.makeMove(move, { recordSAN: true });
        if (mode === "local" && autoFlipLocal) {
          setFlipped(game.turn === "b");
        }
        syncView();
        playSoundForLastMove(prevLen);
      });
    },
    [
      animateBoardMove,
      autoFlipLocal,
      mode,
      sendOnlineCommand,
      playSoundForLastMove,
      syncView,
    ]
  );

  const selectSquare = useCallback(
    (r: number, c: number) => {
      const game = gameRef.current;
      const legalMoves = game.getLegalMovesForSquare(r, c);
      setSelectedSquare({ r, c });
      setLegalMovesForSelected(legalMoves);
      getSfx().playSelect();
    },
    [getSfx]
  );

  const clearSelection = useCallback(() => {
    setSelectedSquare(null);
    setLegalMovesForSelected([]);
  }, []);

  const attemptMoveOrSelect = useCallback(
    (r: number, c: number) => {
      if (!isPlayerTurn()) return;
      const game = gameRef.current;

      if (selectedSquare) {
        const matchingMoves = legalMovesForSelected.filter((m) => m.to.r === r && m.to.c === c);
        if (matchingMoves.length > 0) {
          if (matchingMoves.length > 1 && matchingMoves[0].promotion) {
            setPendingPromotionMoves(matchingMoves);
            return;
          }
          void executePlayerMove(matchingMoves[0]);
          return;
        }
      }

      const clickedPiece = game.board[r][c];
      if (clickedPiece && clickedPiece.color === game.turn) {
        if (selectedSquare && selectedSquare.r === r && selectedSquare.c === c) {
          clearSelection();
        } else {
          selectSquare(r, c);
        }
      } else {
        clearSelection();
      }
    },
    [clearSelection, executePlayerMove, isPlayerTurn, legalMovesForSelected, selectSquare, selectedSquare]
  );

  // Pointer drag-and-drop handlers on the board
  useEffect(() => {
    const handlePointerMove = (e: PointerEvent) => {
      const drag = dragStateRef.current;
      if (!drag.active || !drag.from || !drag.piece) return;

      const dx = e.clientX - drag.startX;
      const dy = e.clientY - drag.startY;
      const boardEl = boardElRef.current;
      const ghostEl = dragGhostRef.current;

      if (!drag.started && Math.hypot(dx, dy) > 5) {
        drag.started = true;
        if (ghostEl) {
          ghostEl.classList.remove("hidden");
        }
        const originSq = boardEl?.querySelector<HTMLElement>(
          `.square[data-r="${drag.from.r}"][data-c="${drag.from.c}"]`
        );
        originSq?.querySelector(".piece-container")?.classList.add("dragging-source");
      }

      if (drag.started && ghostEl) {
        ghostEl.style.left = `${e.clientX}px`;
        ghostEl.style.top = `${e.clientY}px`;

        if (boardEl) {
          boardEl.querySelectorAll(".square.drop-hover").forEach((el) => el.classList.remove("drop-hover"));
        }
        const targetEl = document.elementFromPoint(e.clientX, e.clientY);
        const sqEl = targetEl?.closest<HTMLElement>(".square");
        if (sqEl) {
          const tr = Number(sqEl.dataset.r);
          const tc = Number(sqEl.dataset.c);
          const isLegal = drag.legalMoves.some((m) => m.to.r === tr && m.to.c === tc);
          if (isLegal) {
            sqEl.classList.add("drop-hover");
          }
        }
      }
    };

    const handlePointerUp = (e: PointerEvent) => {
      const drag = dragStateRef.current;
      if (!drag.active) return;

      const boardEl = boardElRef.current;
      const ghostEl = dragGhostRef.current;
      if (boardEl) {
        boardEl.querySelectorAll(".square.drop-hover").forEach((el) => el.classList.remove("drop-hover"));
        boardEl.querySelectorAll(".piece-container.dragging-source").forEach((el) => el.classList.remove("dragging-source"));
      }
      if (ghostEl) {
        ghostEl.classList.add("hidden");
      }

      if (drag.started && drag.from) {
        const targetEl = document.elementFromPoint(e.clientX, e.clientY);
        const sqEl = targetEl?.closest<HTMLElement>(".square");
        if (sqEl) {
          const tr = Number(sqEl.dataset.r);
          const tc = Number(sqEl.dataset.c);
          if (tr !== drag.from.r || tc !== drag.from.c) {
            const matchingMoves = drag.legalMoves.filter((m) => m.to.r === tr && m.to.c === tc);
            if (matchingMoves.length > 0) {
              drag.active = false;
              drag.started = false;
              if (matchingMoves.length > 1 && matchingMoves[0].promotion) {
                setPendingPromotionMoves(matchingMoves);
              } else {
                void executePlayerMove(matchingMoves[0]);
              }
              return;
            }
          }
        }
      }

      drag.active = false;
      drag.started = false;
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [executePlayerMove]);

  const handleSquarePointerDown = (e: React.PointerEvent<HTMLDivElement>, r: number, c: number) => {
    if (e.button !== 0 || pendingPromotionMoves) return;
    getSfx().init();

    const game = gameRef.current;
    const piece = game.board[r][c];
    const canDragPiece = isPlayerTurn() && piece && piece.color === game.turn;

    if (canDragPiece) {
      const legalMoves = game.getLegalMovesForSquare(r, c);
      dragStateRef.current = {
        active: true,
        started: false,
        from: { r, c },
        piece,
        startX: e.clientX,
        startY: e.clientY,
        legalMoves,
        hoverKey: null,
      };
      selectSquare(r, c);
    } else {
      attemptMoveOrSelect(r, c);
    }
  };

  const startNewGame = useCallback(
    async (nextMode: ChessMode = mode, nextPlayerColor: PieceColor = playerColor) => {
      if (aiTimerRef.current) {
        window.clearTimeout(aiTimerRef.current);
        aiTimerRef.current = null;
      }
      setSelectedSquare(null);
      setLegalMovesForSelected([]);
      setPendingPromotionMoves(null);

      if (nextMode === "online") {
        if (onlineGameId && credentials?.humanToken
          && (onlineState?.phase === "playing" || onlineState?.phase === "finished")) {
          await sendOnlineCommand("reset");
        } else {
          await createOnlineRoom(nextPlayerColor);
        }
        return;
      }

      closeOnlineStream();
      serverStateRef.current = null;
      gameRef.current.reset();
      if (nextMode === "ai") {
        setFlipped(nextPlayerColor === "b");
      } else if (nextMode === "local") {
        setFlipped(false);
      }
      getSfx().playSelect();
      syncView();
    },
    [
      closeOnlineStream,
      createOnlineRoom,
      credentials,
      getSfx,
      mode,
      onlineGameId,
      onlineState,
      sendOnlineCommand,
      playerColor,
      syncView,
    ]
  );

  const handleUndo = useCallback(async () => {
    if (aiThinking || pendingPromotionMoves) return;
    const game = gameRef.current;

    if (mode === "online") {
      await sendOnlineCommand("undo");
      return;
    }

    if (game.history.length === 0) return;

    if (mode === "ai") {
      if (game.turn === playerColor && game.history.length >= 2) {
        game.undoMove();
        game.undoMove();
      } else {
        game.undoMove();
      }
    } else {
      game.undoMove();
      if (autoFlipLocal) {
        setFlipped(game.turn === "b");
      }
    }

    clearSelection();
    getSfx().playSelect();
    syncView();
  }, [
    aiThinking,
    autoFlipLocal,
    clearSelection,
    getSfx,
    mode,
    sendOnlineCommand,
    pendingPromotionMoves,
    playerColor,
    syncView,
  ]);

  const handleModeChange = (nextMode: ChessMode) => {
    if (nextMode === mode) return;
    setMode(nextMode);
    if (nextMode === "online") {
      setSelectedSquare(null);
      setLegalMovesForSelected([]);
      setPendingPromotionMoves(null);
      if (onlineGameId) {
        void joinOnlineRoom(onlineGameId);
      }
    } else {
      const url = new URL(window.location.href);
      url.searchParams.delete("game");
      url.hash = "";
      window.history.replaceState(window.history.state, "", url);
      closeOnlineStream();
      void startNewGame(nextMode, playerColor);
    }
  };

  const handlePlayerColorChange = (nextColor: PieceColor) => {
    if (nextColor === playerColor) return;
    setPlayerColor(nextColor);
    setFlipped(nextColor === "b");
    if (mode === "ai") {
      void startNewGame("ai", nextColor);
    } else if (mode === "online" && onlineStatus === "connected") {
      void createOnlineRoom(nextColor);
    }
  };

  const copyTextWithFeedback = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedFeedback(label);
      window.setTimeout(() => {
        setCopiedFeedback((prev) => (prev === label ? null : prev));
      }, 2000);
    } catch {
      setOnlineMessage("浏览器未允许复制，请选中下方邀请链接手动复制。");
    }
  };

  const {
    board,
    turn,
    fullMoveNumber,
    history,
    status,
    lastMove,
    checkedKingSq,
    capturedByWhite,
    capturedByBlack,
    whiteAdvantage,
    blackAdvantage,
  } = viewState;

  const topColor: PieceColor = flipped ? "w" : "b";
  const bottomColor: PieceColor = flipped ? "b" : "w";

  const describeSideName = (color: PieceColor) => (color === "w" ? "白方" : "黑方");

  const describeSideStatus = (color: PieceColor): { text: string; active: boolean; alert: boolean } => {
    if (status.over) {
      return { text: "", active: false, alert: false };
    }
    if (turn !== color) {
      return { text: "等待中", active: false, alert: false };
    }
    if (status.inCheck) {
      return { text: "被将军 · CHECK", active: true, alert: true };
    }
    return { text: "思考中", active: true, alert: false };
  };

  const topStatus = describeSideStatus(topColor);
  const bottomStatus = describeSideStatus(bottomColor);
  const topCaptured = topColor === "w" ? capturedByWhite : capturedByBlack;
  const bottomCaptured = bottomColor === "w" ? capturedByWhite : capturedByBlack;
  const topCapturedPieceColor: PieceColor = topColor === "w" ? "b" : "w";
  const bottomCapturedPieceColor: PieceColor = bottomColor === "w" ? "b" : "w";
  const topAdv = topColor === "w" ? whiteAdvantage : blackAdvantage;
  const bottomAdv = bottomColor === "w" ? whiteAdvantage : blackAdvantage;

  const displayRanks = flipped ? [...RANKS].reverse() : RANKS;
  const displayFiles = flipped ? [...FILES].reverse() : FILES;

  const movePairs: { moveNum: number; white?: MoveRecord; black?: MoveRecord }[] = [];
  for (let i = 0; i < history.length; i += 2) {
    movePairs.push({
      moveNum: Math.floor(i / 2) + 1,
      white: history[i],
      black: history[i + 1],
    });
  }

  const selectedPiece = selectedSquare ? board[selectedSquare.r][selectedSquare.c] : null;
  const opponentColor = playerColor === "w" ? "b" : "w";
  const onlineHint = onlineState?.phase === "expired" || onlineStatus === "expired"
    ? "房间已过期，联机已关闭；棋谱已保留，请创建新房间继续对局。"
    : onlineStatus === "error" ? "连接中断，正在自动重连；棋局已保留。"
    : !onlineGameId ? "创建房间并分享邀请链接，或粘贴对方的完整邀请链接加入。"
    : !credentials?.humanToken ? "当前为观战模式；参与对局请使用创建者的完整邀请链接。"
    : onlineState?.phase === "waiting" ? "等待对手入座：请复制邀请链接，让对方在另一浏览器或设备中打开。"
    : `你执${playerColor === "w" ? "白" : "黑"} · ${onlineState?.presence?.[opponentColor] ? "对手在线" : "对手暂时离线，棋局保留"}`;
  const remainingSeconds = onlineState?.remainingSeconds === undefined ? null : Math.max(0,
    Math.ceil(onlineState.remainingSeconds - Math.max(0, onlineClock - (onlineState.clientReceivedAt ?? onlineClock)) / 1000));
  const nearExpiration = remainingSeconds !== null && remainingSeconds <= 300 && onlineState?.phase !== "expired";
  const remainingLabel = remainingSeconds === null ? "" : `${Math.floor(remainingSeconds / 60)}:${String(remainingSeconds % 60).padStart(2, "0")}`;

  return (
    <section className="chess-page-shell chess-theme-walnut" aria-label="Atelier Chess 国际象棋对局室">
      <div className="chess-workspace">
        {/* Left / Center Column: Player Strips + Original AtelierChess Board */}
        <div className="chess-board-column">
          {/* Top Player Strip */}
          <div className={`chess-player-strip ${turn === topColor && !status.over ? "is-turn" : ""}`}>
            <div className="chess-player-strip__identity">
              <span className={`turn-dot ${topColor === "w" ? "white-dot" : "black-dot"} ${turn === topColor && !status.over ? "active-turn" : ""}`} />
              <span className="chess-player-strip__name">{describeSideName(topColor)}</span>
              {topStatus.text ? (
                <span className={`chess-status-pill ${topStatus.alert ? "is-alert" : topStatus.active ? "is-active" : ""}`}>
                  {topStatus.text}
                </span>
              ) : null}
            </div>
            <div className="chess-player-strip__captures">
              <div className="captured-pieces" aria-label="吃子列表">
                {topCaptured.map((type, idx) => (
                  <span className="mini-piece" key={`top-cap-${type}-${idx}`}>
                    <PieceGraphic type={type} color={topCapturedPieceColor} />
                  </span>
                ))}
              </div>
              {topAdv > 0 ? <span className="material-badge">+{topAdv}</span> : null}
            </div>
          </div>

          {/* Original AtelierChess Board Frame & Surface */}
          <div className="board-wrapper">
            <div className="board-frame">
              {/* Rank coordinates (8 to 1) */}
              <div className="coords-ranks" aria-hidden="true">
                {displayRanks.map((rk) => (
                  <span key={`rank-${rk}`}>{rk}</span>
                ))}
              </div>

              <div className="board-surface">
                <div
                  ref={boardElRef}
                  className="board"
                  role="grid"
                  aria-label="国际象棋棋盘"
                >
                  {Array.from({ length: 8 }, (_, dr) =>
                    Array.from({ length: 8 }, (__, dc) => {
                      const r = flipped ? 7 - dr : dr;
                      const c = flipped ? 7 - dc : dc;
                      const isLight = (r + c) % 2 === 0;
                      const piece = board[r][c];
                      const isSelected = Boolean(selectedSquare && selectedSquare.r === r && selectedSquare.c === c);
                      const isLastMove = Boolean(
                        lastMove &&
                          ((lastMove.from.r === r && lastMove.from.c === c) ||
                            (lastMove.to.r === r && lastMove.to.c === c))
                      );
                      const isKingCheck = Boolean(checkedKingSq && checkedKingSq.r === r && checkedKingSq.c === c);
                      const legalToHere = legalMovesForSelected.filter((m) => m.to.r === r && m.to.c === c);
                      const hasLegalMove = legalToHere.length > 0;
                      const isCapture = hasLegalMove && Boolean(piece || legalToHere[0].isEnPassant);

                      const sqClasses = [
                        "square",
                        isLight ? "light" : "dark",
                        isLastMove ? "last-move" : "",
                        isSelected ? "selected" : "",
                        isKingCheck ? "in-check" : "",
                        hasLegalMove ? (isCapture ? "legal-capture" : "legal-move") : "",
                      ]
                        .filter(Boolean)
                        .join(" ");

                      return (
                        <div
                          key={`sq-${r}-${c}`}
                          className={sqClasses}
                          data-r={r}
                          data-c={c}
                          role="gridcell"
                          aria-label={`${FILES[c]}${RANKS[r]}`}
                          onPointerDown={(e) => handleSquarePointerDown(e, r, c)}
                        >
                          {piece ? (
                            <div className="piece-container">
                              <PieceGraphic type={piece.type} color={piece.color} />
                            </div>
                          ) : null}
                          {hasLegalMove ? (
                            <span className={isCapture ? "capture-ring" : "move-dot"} />
                          ) : null}
                        </div>
                      );
                    })
                  )}
                </div>

                {/* Pawn Promotion Modal */}
                <div
                  className={`promotion-modal ${pendingPromotionMoves ? "" : "hidden"}`}
                  role="dialog"
                  aria-label="选择兵升变棋子"
                >
                  <div className="promotion-card">
                    <p className="promotion-title">选择升变棋子</p>
                    <div className="promotion-options">
                      {(["q", "r", "b", "n"] as PieceType[]).map((type) => {
                        const match = pendingPromotionMoves?.find((m) => m.promotion === type);
                        if (!match) return null;
                        return (
                          <button
                            key={`promo-${type}`}
                            type="button"
                            className="promo-option-btn"
                            onClick={() => void executePlayerMove(match)}
                          >
                            <div className="promo-piece-preview">
                              <PieceGraphic type={type} color={turn} />
                            </div>
                            <span className="promo-piece-label">{PROMO_NAMES[type]}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>

                {/* Game Over Overlay */}
                <div className={`gameover-overlay ${status.over ? "" : "hidden"}`}>
                  <div className="gameover-card">
                    <div className="gameover-badge">
                      {status.result === "draw" ? "½–½" : "♔"}
                    </div>
                    <h2 className="gameover-title">{status.title || "对局结束"}</h2>
                    <p className="gameover-subtitle">{status.subtitle || "Game Over"}</p>
                    <div className="gameover-actions">
                      <button
                        type="button"
                        className="chess-primary-btn"
                        onClick={() => void startNewGame(mode, playerColor)}
                      >
                        再来一局
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              {/* File coordinates (a to h) */}
              <div className="coords-files" aria-hidden="true">
                {displayFiles.map((fl) => (
                  <span key={`file-${fl}`}>{fl}</span>
                ))}
              </div>
            </div>
          </div>

          {/* Bottom Player Strip */}
          <div className={`chess-player-strip ${turn === bottomColor && !status.over ? "is-turn" : ""}`}>
            <div className="chess-player-strip__identity">
              <span className={`turn-dot ${bottomColor === "w" ? "white-dot" : "black-dot"} ${turn === bottomColor && !status.over ? "active-turn" : ""}`} />
              <span className="chess-player-strip__name">{describeSideName(bottomColor)}</span>
              {bottomStatus.text ? (
                <span className={`chess-status-pill ${bottomStatus.alert ? "is-alert" : bottomStatus.active ? "is-active" : ""}`}>
                  {bottomStatus.text}
                </span>
              ) : null}
            </div>
            <div className="chess-player-strip__captures">
              <div className="captured-pieces" aria-label="吃子列表">
                {bottomCaptured.map((type, idx) => (
                  <span className="mini-piece" key={`bottom-cap-${type}-${idx}`}>
                    <PieceGraphic type={type} color={bottomCapturedPieceColor} />
                  </span>
                ))}
              </div>
              {bottomAdv > 0 ? <span className="material-badge">+{bottomAdv}</span> : null}
            </div>
          </div>
        </div>

        {/* Right Column: Literary Notebook Control & Move Log Sidebar */}
        <aside className="chess-sidebar">
          {/* Mode & Match Controls Card */}
          <article className="chess-control-card">
            <div className="chess-card-header">
              <div>
                <p className="card-kicker">Atelier Chess / 05</p>
                <h2>对局手记</h2>
              </div>
              <span className="chess-turn-Readout">
                {status.over
                  ? status.title
                  : `第 ${fullMoveNumber} 回合 · ${turn === "w" ? "白方行棋" : "黑方行棋"}`}
              </span>
            </div>

            {/* 3-Mode Segmented Switcher */}
            <div className="chess-mode-tabs" role="tablist" aria-label="对局模式切换">
              <button
                type="button"
                role="tab"
                aria-selected={mode === "ai"}
                className={`chess-mode-tab ${mode === "ai" ? "is-active" : ""}`}
                onClick={() => handleModeChange("ai")}
              >
                本地 AI 对局
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={mode === "local"}
                className={`chess-mode-tab ${mode === "local" ? "is-active" : ""}`}
                onClick={() => handleModeChange("local")}
              >
                本地双人对局
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={mode === "online"}
                className={`chess-mode-tab ${mode === "online" ? "is-active" : ""}`}
                onClick={() => handleModeChange("online")}
              >
                线上联机
              </button>
            </div>

            {/* Mode-Specific Settings */}
            {mode === "ai" ? (
              <div className="chess-settings-panel">
                <div className="chess-setting-row">
                  <span className="chess-setting-label">AI 强度</span>
                  <div className="chess-pill-group">
                    {(["casual", "club", "master"] as AIDifficulty[]).map((level) => (
                      <button
                        key={level}
                        type="button"
                        className={`chess-pill-btn ${difficulty === level ? "is-active" : ""}`}
                        onClick={() => setDifficulty(level)}
                      >
                        {level === "casual" ? "入门" : level === "club" ? "标准" : "大师"}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="chess-setting-row">
                  <span className="chess-setting-label">执子方向</span>
                  <div className="chess-pill-group">
                    <button
                      type="button"
                      className={`chess-pill-btn ${playerColor === "w" ? "is-active" : ""}`}
                      onClick={() => handlePlayerColorChange("w")}
                    >
                      执白 · 先手
                    </button>
                    <button
                      type="button"
                      className={`chess-pill-btn ${playerColor === "b" ? "is-active" : ""}`}
                      onClick={() => handlePlayerColorChange("b")}
                    >
                      执黑 · 后手
                    </button>
                  </div>
                </div>
              </div>
            ) : null}

            {mode === "local" ? (
              <div className="chess-settings-panel">
                <div className="chess-setting-row">
                  <span className="chess-setting-label">同屏视角</span>
                  <div className="chess-pill-group">
                    <button
                      type="button"
                      className={`chess-pill-btn ${!autoFlipLocal ? "is-active" : ""}`}
                      onClick={() => setAutoFlipLocal(false)}
                    >
                      固定棋盘视角
                    </button>
                    <button
                      type="button"
                      className={`chess-pill-btn ${autoFlipLocal ? "is-active" : ""}`}
                      onClick={() => setAutoFlipLocal(true)}
                    >
                      落子后自动翻转
                    </button>
                  </div>
                </div>
                <p className="chess-mode-hint">
                  本地双人同屏对弈已启用：白黑双方轮流在同一棋盘落子，支持随时悔棋与手动旋转棋盘。
                </p>
              </div>
            ) : null}

            {mode === "online" ? (
              <div className="chess-settings-panel chess-online-panel">
                <div className="chess-setting-row">
                  <span className="chess-setting-label">建房执子</span>
                  <div className="chess-pill-group">
                    <button
                      type="button"
                      className={`chess-pill-btn ${playerColor === "w" ? "is-active" : ""}`}
                      onClick={() => handlePlayerColorChange("w")}
                    >
                      执白 · 先手
                    </button>
                    <button
                      type="button"
                      className={`chess-pill-btn ${playerColor === "b" ? "is-active" : ""}`}
                      onClick={() => handlePlayerColorChange("b")}
                    >
                      执黑 · 后手
                    </button>
                  </div>
                </div>

                <div className="chess-online-room-row">
                  <input
                    type="text"
                    className="chess-room-input"
                    aria-label="房间号或完整邀请链接"
                    placeholder="粘贴完整邀请链接；仅房间号可观战"
                    value={roomInput}
                    onChange={(e) => setRoomInput(e.target.value)}
                  />
                  <button
                    type="button"
                    className="chess-secondary-btn"
                    disabled={onlineBusy}
                    onClick={() => void joinOnlineRoom(roomInput)}
                  >
                    加入 / 恢复
                  </button>
                  <button
                    type="button"
                    className="chess-primary-btn"
                    disabled={onlineBusy}
                    onClick={() => void createOnlineRoom(playerColor)}
                  >
                    创建房间
                  </button>
                </div>

                {onlineGameId ? (
                  <div className="chess-online-share">
                    <button
                      type="button"
                      className="chess-share-btn"
                      disabled={!credentials?.inviteToken || onlineState?.phase === "expired"}
                      onClick={() => {
                        try {
                          copyTextWithFeedback(onlineClientRef.current!.invitation(window.location.href), "link");
                        } catch (error) {
                          setOnlineMessage(error instanceof Error ? error.message : "无法复制邀请链接。");
                        }
                      }}
                    >
                      {copiedFeedback === "link" ? "已复制邀请链接 ✦" : "复制邀请链接"}
                    </button>
                    <button
                      type="button"
                      className="chess-share-btn"
                      onClick={() => {
                        copyTextWithFeedback(onlineGameId, "room");
                      }}
                    >
                      {copiedFeedback === "room" ? "已复制房间号 ✦" : "复制房间号（观战）"}
                    </button>
                  </div>
                ) : null}
                {invitationLink && onlineState?.phase !== "expired" ? (
                  <label className="chess-input-field">
                    <span>邀请链接（可选中复制）</span>
                    <input aria-label="邀请链接" readOnly value={invitationLink}
                      onFocus={event => event.currentTarget.select()} />
                  </label>
                ) : null}
                <div className="chess-online-status-row" role="status" aria-live="polite">
                  <span className={`chess-online-dot is-${onlineStatus}`} />
                  <span className="chess-online-status-text">{onlineMessage || onlineHint}</span>
                </div>
                {remainingSeconds !== null && onlineState?.phase !== "expired" ? (
                  <p className={`chess-mode-hint ${nearExpiration ? "chess-expiry-warning" : ""}`}>
                    房间剩余 <time aria-label="房间剩余有效时间">{remainingLabel}</time> · 操作和重连不会续期
                  </p>
                ) : null}
                {nearExpiration ? <p className="chess-mode-hint chess-expiry-warning" role="status">房间将在 5 分钟内关闭，棋谱会保留。</p> : null}
                {onlineGameId && credentials?.humanToken && !credentials.inviteToken && onlineState?.phase === "waiting" ? (
                  <p className="chess-mode-hint">旧房间未保存邀请信息，请创建新房间后邀请对手。</p>
                ) : null}
                {onlineState?.pendingAction ? (
                  <div className="chess-online-request" aria-live="polite">
                    <p className="chess-mode-hint">
                      {onlineState.pendingAction.by === playerColor && credentials?.humanToken ? "已发出" : "对方提出"}
                      {onlineState.pendingAction.type === "undo" ? "悔棋" : onlineState.pendingAction.type === "reset" ? "重开" : "和棋"}请求
                    </p>
                    {credentials?.humanToken && onlineState.pendingAction.by !== playerColor ? (
                      <div className="chess-pill-group">
                        <button type="button" className="chess-primary-btn" disabled={onlineBusy}
                          onClick={() => void sendOnlineCommand("actions/respond", { actionId: onlineState.pendingAction!.id, accept: true })}>同意</button>
                        <button type="button" className="chess-secondary-btn" disabled={onlineBusy}
                          onClick={() => void sendOnlineCommand("actions/respond", { actionId: onlineState.pendingAction!.id, accept: false })}>拒绝</button>
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ) : null}

            {/* Action Toolbar */}
            <div className="chess-action-grid">
              <button
                type="button"
                className="chess-action-btn"
                onClick={() => void startNewGame(mode, playerColor)}
              >
                <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                  <path d="M3 3v5h5" />
                </svg>
                <span>新对局</span>
              </button>

              <button
                type="button"
                className="chess-action-btn"
                disabled={history.length === 0 || aiThinking || (mode === "online" && (onlineBusy || !credentials?.humanToken || onlineState?.phase === "expired" || Boolean(onlineState?.pendingAction)))}
                onClick={() => void handleUndo()}
              >
                <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <path d="M9 14 4 9l5-5" />
                  <path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5v0a5.5 5.5 0 0 1-5.5 5.5H11" />
                </svg>
                <span>悔棋</span>
              </button>

              <button
                type="button"
                className="chess-action-btn"
                onClick={() => {
                  setFlipped((f) => !f);
                  getSfx().playSelect();
                }}
              >
                <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <path d="m17 2 4 4-4 4" />
                  <path d="M3 11v-1a4 4 0 0 1 4-4h14" />
                  <path d="m7 22-4-4 4-4" />
                  <path d="M21 13v1a4 4 0 0 1-4 4H3" />
                </svg>
                <span>翻转棋盘</span>
              </button>
            </div>
          </article>

          {/* Move History Card */}
          <article className="chess-history-card">
            <div className="chess-card-header">
              <div>
                <p className="card-kicker">Move Log</p>
                <h2>棋谱记录</h2>
              </div>
              <span className="chess-ply-count">共 {history.length} 步</span>
            </div>

            <div className="move-history-container">
              {movePairs.length === 0 ? (
                <p className="empty-moves">尚无走子记录，点击或拖拽棋子开始落子</p>
              ) : (
                <ol ref={moveListElRef} className="move-list">
                  {movePairs.map((pair, idx) => {
                    const isLatestWhite = idx === movePairs.length - 1 && !pair.black;
                    const isLatestBlack = idx === movePairs.length - 1 && Boolean(pair.black);
                    return (
                      <li key={`move-pair-${pair.moveNum}`} className="move-row">
                        <span className="move-num">{pair.moveNum}.</span>
                        <span className={`move-san ${isLatestWhite ? "latest-move" : ""}`}>
                          {pair.white?.san ?? ""}
                        </span>
                        <span className={`move-san ${isLatestBlack ? "latest-move" : ""}`}>
                          {pair.black?.san ?? ""}
                        </span>
                      </li>
                    );
                  })}
                </ol>
              )}
            </div>
          </article>
        </aside>
      </div>

      {/* Floating Drag Ghost for Pointer Dragging */}
      <div ref={dragGhostRef} className="drag-ghost hidden" aria-hidden="true">
        {selectedPiece ? (
          <PieceGraphic type={selectedPiece.type} color={selectedPiece.color} />
        ) : null}
      </div>
    </section>
  );
}
