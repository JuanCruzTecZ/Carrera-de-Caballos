import { useEffect, useMemo, useRef, useState } from "react";
import {
  acquireLock,
  addPlayer,
  allPlayersBet,
  allPlayersReady,
  confirmPredrink,
  createRandomChallenge,
  hasActiveLock,
  normalizeHost,
  createRoom,
  findPlayerByCreator,
  formatCard,
  getOrderedPlayerIds,
  getOrderedPlayers,
  getPlayerConnectionCounts,
  getRaceLeaderIds,
  getSetupIssues,
  moveBetsToPredrink,
  moveSetupToBets,
  randomRoomCode,
  registerTap,
  releaseLock,
  removeClient,
  removePlayer,
  renamePlayer,
  restartRoom,
  resolveClassicSpin,
  resolveRandomChallenge,
  setClientControl,
  setGameMode,
  setPlayerBet,
  startRace,
  submitMathAnswer,
  submitNumberTarget,
  submitSecretSymbol,
  uid,
  upsertClient,
} from "./game/engine";
import {
  FINISH_LEVEL,
  GAME_MODES,
  RANDOM_CHALLENGE_TYPES,
  ROOM_PHASES,
  SECRET_SYMBOLS,
} from "./game/constants";
import { connectRoomPresence, createRoomInStore, fetchRoom, subscribeToRoom, transactRoom } from "./lib/roomStore";
import { isFirebaseConfigured } from "./lib/firebase";

const SESSION_KEY = "horse-race-session-v1";

function loadSession() {
  try {
    const stored = JSON.parse(window.localStorage.getItem(SESSION_KEY) || "{}");
    return {
      clientId: stored.clientId || uid("client"),
      roomId: stored.roomId || "",
      controlledPlayerId: stored.controlledPlayerId || "",
    };
  } catch {
    return {
      clientId: uid("client"),
      roomId: "",
      controlledPlayerId: "",
    };
  }
}

function saveSession(session) {
  window.localStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

function App() {
  const [session, setSession] = useState(loadSession);
  const [room, setRoom] = useState(null);
  const [roomLoading, setRoomLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [createName, setCreateName] = useState("Jugador 1");
  const [joinCode, setJoinCode] = useState("");
  const [newPlayerName, setNewPlayerName] = useState("");
  const [renameDrafts, setRenameDrafts] = useState({});
  const [mathDraft, setMathDraft] = useState("");
  const [numberDraft, setNumberDraft] = useState("");
  const [clock, setClock] = useState(Date.now());
  const [classicSpinState, setClassicSpinState] = useState({
    open: false,
    activeHorseId: "",
    winnerHorseId: "",
    title: "Ruleta del nivel",
  });
  const [roundFeedback, setRoundFeedback] = useState(null);
  const challengePanelRef = useRef(null);

  useEffect(() => {
    saveSession(session);
  }, [session]);

  useEffect(() => {
    if (!session.roomId) {
      setRoom(null);
      setRoomLoading(false);
      return undefined;
    }

    setRoomLoading(true);
    const unsubscribe = subscribeToRoom(session.roomId, (nextRoom) => {
      setRoom(nextRoom);
      setRoomLoading(false);
    });

    return unsubscribe;
  }, [session.roomId]);

  useEffect(() => {
    if (!session.roomId) return undefined;

    let cancelled = false;
    let cleanupPresence = () => {};

    const syncClient = async () => {
      cleanupPresence = await connectRoomPresence(session.roomId, session.clientId, session.controlledPlayerId);
      await transactRoom(session.roomId, (draft) => {
        if (!draft) return draft;
        upsertClient(draft, session.clientId, session.controlledPlayerId);
        return draft;
      });
    };

    syncClient();

    const interval = window.setInterval(() => {
      if (!cancelled) {
        syncClient();
      }
    }, 15000);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
      cleanupPresence();
    };
  }, [session.clientId, session.controlledPlayerId, session.roomId]);

  useEffect(() => {
    if (!room?.race?.currentChallenge || room.phase !== ROOM_PHASES.RACE) return undefined;

    const interval = window.setInterval(() => {
      setClock(Date.now());
    }, 200);

    return () => {
      window.clearInterval(interval);
    };
  }, [room?.race?.currentChallenge, room?.phase]);

  useEffect(() => {
    if (!room || !session.controlledPlayerId) return;
    if (room.players?.[session.controlledPlayerId]) return;
    setSession((current) => ({ ...current, controlledPlayerId: "" }));
  }, [room, session.controlledPlayerId]);

  useEffect(() => {
    if (
      room?.phase === ROOM_PHASES.RACE &&
      room.settings.mode === GAME_MODES.RANDOM &&
      room.race.currentChallenge?.type === RANDOM_CHALLENGE_TYPES.TAP &&
      room.race.currentChallenge.endsAt <= clock &&
      room.hostClientId === session.clientId
    ) {
      handleResolveRandomChallenge();
    }
  }, [clock, room, session.clientId]);

  useEffect(() => {
    if (!room?.race?.history?.length || room.phase !== ROOM_PHASES.RACE) return;
    const latest = room.race.history[0];
    setRoundFeedback({
      id: latest.id,
      title: latest.title,
      description: latest.description,
    });
    const timeout = window.setTimeout(() => setRoundFeedback(null), 1800);
    return () => window.clearTimeout(timeout);
  }, [room?.race?.history?.[0]?.id, room?.phase]);

  useEffect(() => {
    if (room?.phase !== ROOM_PHASES.RACE || room?.settings?.mode !== GAME_MODES.RANDOM) return;
    if (!currentChallenge || !challengePanelRef.current) return;
    const timeout = window.setTimeout(() => {
      challengePanelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 120);
    return () => window.clearTimeout(timeout);
  }, [currentChallenge?.type, room?.phase, room?.settings?.mode]);

  const orderedPlayers = useMemo(() => getOrderedPlayers(room || { players: {}, playerOrder: [] }), [room]);
  const connectionCounts = useMemo(() => (room ? getPlayerConnectionCounts(room) : {}), [room]);
  const setupIssues = useMemo(() => (room ? getSetupIssues(room) : []), [room]);
  const controlledPlayer = room?.players?.[session.controlledPlayerId] || null;
  const currentChallenge = room?.race?.currentChallenge || null;
  const raceLeaderIds = room ? getRaceLeaderIds(room) : [];
  const isHost = room?.hostClientId === session.clientId;
  const canManageAllPlayers = !session.controlledPlayerId || isHost;
  const actionLocked = room?.actionLock?.expiresAt > Date.now();

  function canControlPlayer(playerId) {
    return canManageAllPlayers || session.controlledPlayerId === playerId;
  }

  function canEditBet(playerId) {
    if (session.controlledPlayerId === playerId) return true;
    if (isHost && (connectionCounts[playerId] || 0) === 0) return true;
    return false;
  }

  async function runRoomMutation(mutator) {
    if (!session.roomId) return;
    setMessage("");
    try {
      await transactRoom(session.roomId, (draft) => {
        if (!draft) return draft;
        return mutator(draft);
      });
    } catch (error) {
      console.error(error);
      setMessage(`No se pudo actualizar la carrera. ${error?.message || ""}`.trim());
    }
  }

  async function handleCreateRoom() {
    setMessage("");
    const playerName = createName.trim() || "Jugador 1";
    const roomId = randomRoomCode();
    const nextRoom = createRoom(roomId, session.clientId, playerName);

    try {
      await createRoomInStore(nextRoom);
      const hostPlayerId = nextRoom.playerOrder[0];
      setSession((current) => ({
        ...current,
        roomId,
        controlledPlayerId: hostPlayerId,
      }));
      setJoinCode(roomId);
    } catch (error) {
      console.error(error);
      setMessage("No se pudo crear la carrera.");
    }
  }

  async function handleJoinRoom() {
    setMessage("");
    const roomId = joinCode.trim();
    if (!roomId) {
      setMessage("Ingresá un código de sala.");
      return;
    }

    try {
      const existingRoom = await fetchRoom(roomId);
      if (!existingRoom) {
        setMessage("La sala no existe.");
        return;
      }

      let assignedPlayerId =
        existingRoom.players?.[session.controlledPlayerId]?.id || findPlayerByCreator(existingRoom, session.clientId)?.id || "";

      await transactRoom(roomId, (draft) => {
        if (!draft) return draft;
        upsertClient(draft, session.clientId, assignedPlayerId);
        return draft;
      });

      setSession((current) => ({
        ...current,
        roomId,
        controlledPlayerId: assignedPlayerId,
      }));
    } catch (error) {
      console.error(error);
      setMessage("No se pudo unir el dispositivo a la sala.");
    }
  }

  async function handleLeaveRoom() {
    const previousRoomId = session.roomId;
    const previousClientId = session.clientId;

    if (previousRoomId) {
      await transactRoom(previousRoomId, (draft) => {
        if (!draft) return draft;
        removeClient(draft, previousClientId);
        normalizeHost(draft);
        return draft;
      });
    }

    setRoom(null);
    setRoomLoading(false);
    setSession({
      clientId: uid("client"),
      roomId: "",
      controlledPlayerId: "",
    });
  }

  async function handleAddPlayer() {
    if (!isHost) return;
    if (!newPlayerName.trim()) return;
    await runRoomMutation((draft) => addPlayer(draft, newPlayerName, session.clientId));
    setNewPlayerName("");
  }

  async function handleRenamePlayer(playerId) {
    if (!isHost) return;
    const draft = renameDrafts[playerId];
    if (!draft?.trim()) return;
    await runRoomMutation((roomDraft) => renamePlayer(roomDraft, playerId, draft));
  }

  async function handleSetControl(controlledPlayerId) {
    setSession((current) => ({ ...current, controlledPlayerId }));
    await runRoomMutation((draft) => setClientControl(draft, session.clientId, controlledPlayerId));
  }

  async function handleStartBets() {
    if (!isHost) return;
    if (setupIssues.length > 0) {
      setMessage(setupIssues[0]);
      return;
    }
    await runRoomMutation((draft) => moveSetupToBets(draft));
  }

  async function handleContinueToPredrink() {
    if (!isHost) return;
    if (!allPlayersBet(room)) {
      setMessage("Todos los jugadores o equipos tienen que apostar al menos 1 trago.");
      return;
    }
    await runRoomMutation((draft) => moveBetsToPredrink(draft));
  }

  async function handleStartRace() {
    if (!isHost) return;
    if (!allPlayersReady(room)) {
      setMessage("Falta confirmar que todos tomaron sus tragos iniciales.");
      return;
    }
    await runRoomMutation((draft) => startRace(draft));
  }

  async function handleSpinClassic() {
    if (!isHost) return;
    const lockRoom = await transactRoom(session.roomId, (draft) => {
      if (!draft) return draft;
      if (!acquireLock(draft, "resolve_classic", session.clientId, 8000)) return draft;
      return draft;
    });
    if (lockRoom?.actionLock?.ownerClientId !== session.clientId) {
      setMessage("La carrera está procesando otra acción.");
      return;
    }
    const contenders = orderedPlayers;
    if (!contenders.length) return;

    setClassicSpinState({
      open: true,
      activeHorseId: contenders[0]?.id || "",
      winnerHorseId: "",
      title: "Ruleta del nivel",
    });

    let tickIndex = 0;
    const spinTicks = 18 + Math.floor(Math.random() * 8);
    const interval = window.setInterval(() => {
      tickIndex += 1;
      const current = contenders[tickIndex % contenders.length];
      setClassicSpinState((state) => ({
        ...state,
        activeHorseId: current?.id || "",
      }));
    }, 90);

    const winner = contenders[Math.floor(Math.random() * contenders.length)];

    window.setTimeout(async () => {
      window.clearInterval(interval);
      setClassicSpinState({
        open: true,
        activeHorseId: winner?.id || "",
        winnerHorseId: winner?.id || "",
        title: "Ruleta del nivel",
      });

      window.setTimeout(async () => {
        await runRoomMutation((draft) => {
          if (!draft || draft.phase !== ROOM_PHASES.RACE || draft.settings.mode !== GAME_MODES.CLASSIC) return draft;
          const target = draft.players?.[winner?.id];
          if (!target) return draft;
          draft.race ||= { mode: GAME_MODES.CLASSIC, round: 0, winnerId: null, currentChallenge: null, history: [] };
          draft.race.history ||= [];
          draft.race.round = (Number(draft.race.round) || 0) + 1;
          target.position = Math.min((Number(target.position) || 0) + 1, FINISH_LEVEL);
          target.totalPenaltyDrinks = (Number(target.totalPenaltyDrinks) || 0) + 3;
          draft.race.history.unshift({
            id: uid("round"),
            createdAt: Date.now(),
            mode: GAME_MODES.CLASSIC,
            title: `Ronda ${draft.race.round}`,
            description: `${target.name} ganó la ruleta, avanzó un nivel y debe tomar 3 tragos.`,
            winners: [target.id],
          });
          if (target.position >= FINISH_LEVEL) {
            draft.phase = ROOM_PHASES.FINISHED;
            draft.race.winnerId = target.id;
            draft.race.summary = `${target.name} llegó al nivel ${FINISH_LEVEL} y debe repartir ${target.betDrinks} tragos.`;
            draft.race.currentChallenge = null;
          }
          releaseLock(draft, "resolve_classic", session.clientId);
          return draft;
        });

        setClassicSpinState({
          open: false,
          activeHorseId: "",
          winnerHorseId: "",
          title: "Ruleta del nivel",
        });
      }, 900);
    }, spinTicks * 90);
  }

  async function handleCreateRandomChallenge() {
    if (!isHost) return;
    await runRoomMutation((draft) => {
      if (hasActiveLock(draft)) return draft;
      return createRandomChallenge(draft);
    });
  }

  async function handleResolveRandomChallenge() {
    if (!isHost) return;
    if (currentChallenge?.type === RANDOM_CHALLENGE_TYPES.DICE) {
      const lockRoom = await transactRoom(session.roomId, (draft) => {
        if (!draft) return draft;
        if (!acquireLock(draft, "resolve_random_dice", session.clientId, 8000)) return draft;
        return draft;
      });
      if (lockRoom?.actionLock?.ownerClientId !== session.clientId) {
        setMessage("La carrera está procesando otra acción.");
        return;
      }
      const contenders = orderedPlayers;
      if (!contenders.length) return;

      setClassicSpinState({
        open: true,
        activeHorseId: contenders[0]?.id || "",
        winnerHorseId: "",
        title: "Ruleta RANDOM",
      });

      let tickIndex = 0;
      const interval = window.setInterval(() => {
        tickIndex += 1;
        const current = contenders[tickIndex % contenders.length];
        setClassicSpinState((state) => ({
          ...state,
          activeHorseId: current?.id || "",
        }));
      }, 90);

      const spinTicks = 18 + Math.floor(Math.random() * 8);
      window.setTimeout(() => {
        window.clearInterval(interval);
        const winner = contenders[Math.floor(Math.random() * contenders.length)];
        setClassicSpinState({
          open: true,
          activeHorseId: winner?.id || "",
          winnerHorseId: winner?.id || "",
          title: "Ruleta RANDOM",
        });

        window.setTimeout(async () => {
          await runRoomMutation((draft) => {
            const updated = resolveRandomChallenge(draft);
            releaseLock(updated, "resolve_random_dice", session.clientId);
            return updated;
          });
          setClassicSpinState({
            open: false,
            activeHorseId: "",
            winnerHorseId: "",
            title: "Ruleta del nivel",
          });
        }, 900);
      }, spinTicks * 90);
      return;
    }
    await runRoomMutation((draft) => {
      if (hasActiveLock(draft)) return draft;
      return resolveRandomChallenge(draft);
    });
  }

  async function handleSubmitMathAnswer() {
    if (!controlledPlayer || mathDraft === "") return;
    await runRoomMutation((draft) => submitMathAnswer(draft, controlledPlayer.id, mathDraft));
    setMathDraft("");
  }

  async function handleSubmitNumber() {
    if (!controlledPlayer || numberDraft === "") return;
    await runRoomMutation((draft) => submitNumberTarget(draft, controlledPlayer.id, numberDraft));
    setNumberDraft("");
  }

  async function handleTap() {
    if (!controlledPlayer) return;
    await runRoomMutation((draft) => registerTap(draft, controlledPlayer.id));
  }

  async function handleConfirmPredrink(playerId) {
    if (!canControlPlayer(playerId)) return;
    await runRoomMutation((draft) => confirmPredrink(draft, playerId));
  }

  async function handleRestartRoom() {
    if (!isHost) return;
    await runRoomMutation((draft) => restartRoom(draft));
  }

  function renderLanding() {
    return (
      <section className="screen landing-screen">
        <div className="landing-grid">
          <div className="hero-card">
            <div className="eyebrow">Carrera de Caballos</div>
            <h1>Juego de carrera, apuestas de tragos y resolución en tiempo real.</h1>
            <p className="hero-copy">
              Flujo listo para crear una carrera, sumar jugadores o equipos, configurar el modo y correr hasta el nivel 7.
            </p>
            <div className="stack-note">
              <span>{isFirebaseConfigured() ? "Modo Firebase activo" : "Modo local activo"}</span>
              <span>{isFirebaseConfigured() ? "Realtime Database conectado" : "Usando fallback local hasta cargar credenciales"}</span>
            </div>
          </div>

          <div className="panel form-panel">
            <div className="panel-block">
              <div className="eyebrow">Crear carrera</div>
              <label className="field">
                <span>Nombre del jugador o equipo creador</span>
                <input value={createName} onChange={(event) => setCreateName(event.target.value)} maxLength={18} />
              </label>
              <button className="primary-btn" onClick={handleCreateRoom}>
                Crear carrera
              </button>
            </div>

            <div className="panel-block">
              <div className="eyebrow">Unirse</div>
              <label className="field">
                <span>Código de carrera</span>
                <input value={joinCode} onChange={(event) => setJoinCode(event.target.value)} maxLength={4} inputMode="numeric" />
              </label>
              <button className="secondary-btn" onClick={handleJoinRoom}>
                Unirse a la carrera
              </button>
            </div>
          </div>
        </div>
      </section>
    );
  }

  function renderPlayerCard(player) {
    const isControlledHere = session.controlledPlayerId === player.id;
    const connections = connectionCounts[player.id] || 0;

    return (
      <article className="player-card" key={player.id}>
        <div className="player-card-head">
          <div className="horse-badge" style={{ backgroundColor: player.color }}>
            #{player.horseNumber}
          </div>
          <div>
            <div className="player-name">{player.name}</div>
            <div className="player-meta">Celulares conectados: {connections}</div>
          </div>
        </div>

        <div className="rename-row">
          <input
            value={renameDrafts[player.id] ?? player.name}
            onChange={(event) => setRenameDrafts((current) => ({ ...current, [player.id]: event.target.value }))}
            maxLength={18}
            disabled={!isHost}
          />
          <button className="ghost-btn" onClick={() => handleRenamePlayer(player.id)} disabled={!isHost}>
            Guardar
          </button>
        </div>

        <div className="player-card-actions">
          <button className={isControlledHere ? "chip-btn active" : "chip-btn"} onClick={() => handleSetControl(player.id)}>
            Controlar este caballo
          </button>
          {room?.phase === ROOM_PHASES.SETUP && orderedPlayers.length > 1 ? (
            <button
              className="ghost-btn danger"
              onClick={() => runRoomMutation((draft) => removePlayer(draft, player.id))}
              disabled={!isHost}
            >
              Eliminar
            </button>
          ) : null}
        </div>
      </article>
    );
  }

  function renderSetup() {
    return (
      <section className="screen">
        <header className="topbar">
          <div>
            <div className="eyebrow">Sala</div>
            <h2>{room.code}</h2>
          </div>
          <div className="topbar-actions">
            <button className={!session.controlledPlayerId ? "chip-btn active" : "chip-btn"} onClick={() => handleSetControl("")}>
              Modo compartido
            </button>
            <button className="ghost-btn" onClick={handleLeaveRoom}>
              Salir
            </button>
          </div>
        </header>

        <div className="two-column-layout">
          <section className="panel">
            <div className="panel-header">
              <div>
                <div className="eyebrow">Configuración</div>
                <h3>Jugadores o equipos</h3>
              </div>
              <div className="count-pill">{orderedPlayers.length}/6</div>
            </div>

            <div className="player-grid">{orderedPlayers.map(renderPlayerCard)}</div>

            <div className="add-player-row">
              <input
                placeholder="Nuevo jugador o equipo"
                value={newPlayerName}
                onChange={(event) => setNewPlayerName(event.target.value)}
                maxLength={18}
                disabled={!isHost}
              />
              <button className="secondary-btn" onClick={handleAddPlayer} disabled={!isHost}>
                Agregar
              </button>
            </div>
          </section>

          <section className="panel">
            <div className="panel-header">
              <div>
                <div className="eyebrow">Modo de juego</div>
                <h3>Selección de carrera</h3>
              </div>
            </div>

            <div className="mode-grid">
              <button
                className={room.settings.mode === GAME_MODES.CLASSIC ? "mode-card active" : "mode-card"}
                onClick={() => runRoomMutation((draft) => setGameMode(draft, GAME_MODES.CLASSIC))}
                disabled={!isHost}
              >
                <strong>CLASICO</strong>
                <span>Ruleta aleatoria. Si tu caballo sube, ese grupo toma 3 tragos.</span>
              </button>
              <button
                className={room.settings.mode === GAME_MODES.RANDOM ? "mode-card active" : "mode-card"}
                onClick={() => runRoomMutation((draft) => setGameMode(draft, GAME_MODES.RANDOM))}
                disabled={!isHost}
              >
                <strong>RANDOM</strong>
                <span>Pruebas mixtas. Puede haber varios avances salvo en la llegada final.</span>
              </button>
            </div>

            <div className="rules-panel">
              <div className="rule-line">El creador queda asignado como jugador 1.</div>
              <div className="rule-line">La carrera termina cuando un caballo llega primero al nivel {FINISH_LEVEL}.</div>
              <div className="rule-line">El ganador reparte los tragos que apostó al principio.</div>
              <div className="rule-line">Los jugadores que se unan con código eligen acá el caballo que les corresponde.</div>
            </div>

            {setupIssues.length ? (
              <div className="issue-list">
                {setupIssues.map((issue) => (
                  <div className="issue-item" key={issue}>
                    {issue}
                  </div>
                ))}
              </div>
            ) : null}

            <button className="primary-btn block-btn" onClick={handleStartBets} disabled={!isHost || actionLocked}>
              Continuar a apuestas
            </button>
          </section>
        </div>
      </section>
    );
  }

  function renderBets() {
    return (
      <section className="screen">
        <header className="topbar">
          <div>
            <div className="eyebrow">Sala {room.code}</div>
            <h2>Apuestas iniciales</h2>
          </div>
          <button className="ghost-btn" onClick={handleLeaveRoom}>
            Salir
          </button>
        </header>

        <div className="panel">
          <div className="panel-header">
            <div>
              <div className="eyebrow">Apuesta</div>
              <h3>Cada jugador o equipo apuesta sus tragos</h3>
            </div>
          </div>

          <div className="bet-grid">
            {orderedPlayers.map((player) => (
              <article className="bet-card" key={player.id} style={{ "--horse-color": player.color }}>
                <div className="bet-card-head">
                  <div className="horse-badge" style={{ backgroundColor: player.color }}>
                    #{player.horseNumber}
                  </div>
                  <div>
                    <div className="player-name">{player.name}</div>
                    <div className="player-meta">Apuesta actual: {player.betDrinks} tragos</div>
                  </div>
                </div>

                <div className="bet-stepper">
                  <div className="bet-display">{player.betDrinks}</div>
                  <div className="bet-actions">
                    {[-10, -5, -1, 1, 5, 10].map((delta) => (
                      <button
                        key={delta}
                        className="shot-btn"
                        onClick={() => runRoomMutation((draft) => setPlayerBet(draft, player.id, player.betDrinks + delta))}
                        disabled={!canEditBet(player.id)}
                      >
                        {delta > 0 ? `+${delta}` : delta}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="bet-meta-row">
                  <input
                    type="number"
                    min="0"
                    max="99"
                    value={player.betDrinks}
                    onChange={(event) => runRoomMutation((draft) => setPlayerBet(draft, player.id, event.target.value))}
                    disabled={!canEditBet(player.id)}
                  />
                  <span className="player-meta">Rango sugerido: 1 a 99 tragos</span>
                </div>

                {!canEditBet(player.id) ? (
                  <div className="bet-lock-note">Este caballo ya tiene un celular asignado. La apuesta la edita ese dispositivo.</div>
                ) : null}
              </article>
            ))}
          </div>

          <button className="primary-btn block-btn" onClick={handleContinueToPredrink} disabled={!isHost || actionLocked}>
            Confirmar apuestas y mostrar tragos a tomar
          </button>
        </div>
      </section>
    );
  }

  function renderPredrink() {
    return (
      <section className="screen">
        <header className="topbar">
          <div>
            <div className="eyebrow">Sala {room.code}</div>
            <h2>Tragos previos a la carrera</h2>
          </div>
          <button className="ghost-btn" onClick={handleLeaveRoom}>
            Salir
          </button>
        </header>

        <div className="two-column-layout">
          <section className="panel">
            <div className="panel-header">
              <div>
                <div className="eyebrow">Resumen</div>
                <h3>Todos deben tomar lo apostado</h3>
              </div>
            </div>

            <div className="predrink-list">
              {orderedPlayers.map((player) => (
                <article className={player.drankBeforeStart ? "predrink-card ready" : "predrink-card"} key={player.id}>
                  <div className="predrink-main">
                    <div className="horse-badge" style={{ backgroundColor: player.color }}>
                      #{player.horseNumber}
                    </div>
                    <div>
                      <div className="player-name">{player.name}</div>
                      <div className="player-meta">Debe tomar {player.betDrinks} tragos antes de largar</div>
                    </div>
                  </div>
                  <button className="secondary-btn" onClick={() => handleConfirmPredrink(player.id)} disabled={!canControlPlayer(player.id)}>
                    {player.drankBeforeStart ? "Confirmado" : "Ya tomó"}
                  </button>
                </article>
              ))}
            </div>
          </section>

          <section className="panel">
            <div className="panel-header">
              <div>
                <div className="eyebrow">Largada</div>
                <h3>Esperando confirmación completa</h3>
              </div>
            </div>

            <div className="rules-panel">
              <div className="rule-line">Modo seleccionado: {room.settings.mode}</div>
              <div className="rule-line">Nivel inicial: 0</div>
              <div className="rule-line">Meta: {FINISH_LEVEL}</div>
            </div>

            <button className="primary-btn block-btn" onClick={handleStartRace} disabled={!isHost || actionLocked}>
              Empezar carrera
            </button>
          </section>
        </div>
      </section>
    );
  }

  function renderTrack() {
    const levels = Array.from({ length: FINISH_LEVEL + 1 }, (_, index) => FINISH_LEVEL - index);

    return (
      <div className="track-shell fair-shell">
        <div className="track-band finish-band">FINISH LINE</div>
        <div className="track-levels fair-levels">
          {levels.map((level) => (
            <div key={level} className={level === FINISH_LEVEL ? "track-level fair-level finish" : "track-level fair-level"}>
              <div className="track-level-label fair-label">{level}</div>
              <div className="track-lanes fair-lanes">
                {orderedPlayers.map((player) => {
                  const occupied = player.position === level;
                  const isLeader = raceLeaderIds.includes(player.id);
                  return (
                    <div className={occupied ? "track-lane fair-lane occupied" : "track-lane fair-lane"} key={`${level}-${player.id}`}>
                      <div className="peg-hole peg-hole-a" />
                      <div className="peg-hole peg-hole-b" />
                      {occupied ? (
                        <div className={isLeader ? "horse-token horse-piece leader" : "horse-token horse-piece"} style={{ "--horse-color": player.color }}>
                          <span className="horse-piece-top">
                            <span className="horse-number">{player.horseNumber}</span>
                          </span>
                          <span className="horse-name">{player.name}</span>
                        </div>
                      ) : (
                        <div className="lane-placeholder" />
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
        <div className="track-band start-band">START</div>
      </div>
    );
  }

  function renderRandomChallengePanel() {
    if (!currentChallenge) {
        return (
          <div className="panel compact-panel" ref={challengePanelRef}>
            <div className="panel-header">
              <div>
                <div className="eyebrow">Modo RANDOM</div>
                <h3>Siguiente prueba</h3>
              </div>
            </div>
            <p className="panel-copy">Generá una metodología aleatoria para decidir qué caballo sube un nivel.</p>
            <button className="primary-btn block-btn" onClick={handleCreateRandomChallenge} disabled={!isHost || actionLocked}>
              Generar desafío
            </button>
          </div>
      );
    }

    if (currentChallenge.type === RANDOM_CHALLENGE_TYPES.MATH) {
      return (
        <div className="panel compact-panel" ref={challengePanelRef}>
          <div className="eyebrow">Desafío matemático</div>
          <h3>{currentChallenge.prompt}</h3>
          <p className="panel-copy">Gana quien responda primero correctamente.</p>
          {controlledPlayer ? (
            <div className="answer-row">
              <input value={mathDraft} onChange={(event) => setMathDraft(event.target.value)} inputMode="numeric" />
              <button className="secondary-btn" onClick={handleSubmitMathAnswer}>
                Enviar
              </button>
            </div>
          ) : (
            <p className="panel-copy">Este dispositivo está en modo compartido. Para competir en RANDOM conviene asignarlo a un jugador.</p>
          )}
          <button className="primary-btn block-btn" onClick={handleResolveRandomChallenge} disabled={!isHost || actionLocked}>
            Resolver ronda
          </button>
        </div>
      );
    }

    if (currentChallenge.type === RANDOM_CHALLENGE_TYPES.DICE) {
      return (
        <div className="panel compact-panel" ref={challengePanelRef}>
          <div className="eyebrow">Ruleta aleatoria</div>
          <h3>Selección visual del caballo</h3>
          <p className="panel-copy">Esta ronda reemplaza el dado por una ruleta como la del modo clásico.</p>
          <button className="primary-btn block-btn" onClick={handleResolveRandomChallenge} disabled={!isHost || actionLocked}>
            Girar ruleta RANDOM
          </button>
        </div>
      );
    }

    if (currentChallenge.type === RANDOM_CHALLENGE_TYPES.TAP) {
      const timeLeft = Math.max(0, Math.ceil((currentChallenge.endsAt - clock) / 1000));
      const myTaps = controlledPlayer ? currentChallenge.taps?.[controlledPlayer.id] || 0 : 0;

      return (
        <div className="panel compact-panel" ref={challengePanelRef}>
          <div className="eyebrow">Tap rápido</div>
          <h3>{currentChallenge.prompt}</h3>
          <div className="tap-timer">{timeLeft}</div>
          {controlledPlayer ? (
            <>
              <button className="tap-btn" onPointerDown={handleTap}>
                TAP
              </button>
              <div className="tap-score">Tus toques: {myTaps}</div>
            </>
          ) : (
            <p className="panel-copy">Este dispositivo no tiene un caballo asignado para competir en esta prueba.</p>
          )}
          <button className="primary-btn block-btn" onClick={handleResolveRandomChallenge} disabled={!isHost || actionLocked}>
            Cerrar ronda
          </button>
        </div>
      );
    }

    if (currentChallenge.type === RANDOM_CHALLENGE_TYPES.POKER) {
      return (
        <div className="panel compact-panel" ref={challengePanelRef}>
          <div className="eyebrow">Póker automático</div>
          <h3>{currentChallenge.prompt}</h3>
          <div className="mini-results">
            {orderedPlayers.map((player) => (
              <div className="mini-result-row" key={player.id}>
                <span>{player.name}</span>
                <span>
                  {currentChallenge.hands[player.id].cards.map((card) => formatCard(card)).join(" ")} |{" "}
                  {currentChallenge.hands[player.id].score.label}
                </span>
              </div>
            ))}
          </div>
          <button className="primary-btn block-btn" onClick={handleResolveRandomChallenge} disabled={!isHost || actionLocked}>
            Resolver póker
          </button>
        </div>
      );
    }

    if (currentChallenge.type === RANDOM_CHALLENGE_TYPES.HIDDEN_CARD) {
      return (
        <div className="panel compact-panel" ref={challengePanelRef}>
          <div className="eyebrow">Carta oculta</div>
          <h3>{currentChallenge.prompt}</h3>
          <div className="rules-panel">
            <div className="rule-line">Regla de la ronda: {currentChallenge.rule.label}</div>
          </div>
          <div className="card-grid">
            {orderedPlayers.map((player) => (
              <article className="playing-card" key={player.id}>
                <div className="player-meta">{player.name}</div>
                <div className="playing-card-face">{formatCard(currentChallenge.cards[player.id])}</div>
              </article>
            ))}
          </div>
          <button className="primary-btn block-btn" onClick={handleResolveRandomChallenge} disabled={!isHost || actionLocked}>
            Resolver carta
          </button>
        </div>
      );
    }

    if (currentChallenge.type === RANDOM_CHALLENGE_TYPES.SECRET_SYMBOL) {
      return (
        <div className="panel compact-panel" ref={challengePanelRef}>
          <div className="eyebrow">Símbolo secreto</div>
          <h3>{currentChallenge.prompt}</h3>
          {controlledPlayer ? (
            <div className="symbol-grid">
              {SECRET_SYMBOLS.map((symbol) => (
                <button
                  className={
                    currentChallenge.picks?.[controlledPlayer.id] === symbol.id ? "symbol-btn active" : "symbol-btn"
                  }
                  key={symbol.id}
                  onClick={() => runRoomMutation((draft) => submitSecretSymbol(draft, controlledPlayer.id, symbol.id))}
                >
                  <span className="symbol-glyph">{symbol.glyph}</span>
                  <span>{symbol.label}</span>
                </button>
              ))}
            </div>
          ) : (
            <p className="panel-copy">Este dispositivo no tiene un caballo asignado para elegir símbolo.</p>
          )}
          <button className="primary-btn block-btn" onClick={handleResolveRandomChallenge} disabled={!isHost || actionLocked}>
            Revelar símbolo ganador
          </button>
        </div>
      );
    }

    if (currentChallenge.type === RANDOM_CHALLENGE_TYPES.NUMBER_TARGET) {
      return (
        <div className="panel compact-panel">
          <div className="eyebrow">Número objetivo</div>
          <h3>{currentChallenge.prompt}</h3>
          <p className="panel-copy">La app ya eligió un número objetivo oculto. Avanzan los más cercanos.</p>
          {controlledPlayer ? (
            <div className="answer-row">
              <input
                value={numberDraft}
                onChange={(event) => setNumberDraft(event.target.value)}
                inputMode="numeric"
                min="1"
                max="100"
              />
              <button className="secondary-btn" onClick={handleSubmitNumber}>
                Enviar número
              </button>
            </div>
          ) : (
            <p className="panel-copy">Este dispositivo no tiene un caballo asignado para enviar número.</p>
          )}
          <button className="primary-btn block-btn" onClick={handleResolveRandomChallenge} disabled={!isHost}>
            Resolver número objetivo
          </button>
        </div>
      );
    }

    return null;
  }

  function renderRaceSidebar() {
    const raceHistory = room.race?.history || [];

    return (
      <div className="race-sidebar">
        <div className="panel compact-panel">
          <div className="panel-header">
            <div>
              <div className="eyebrow">Estado</div>
              <h3>
                Modo {room.settings.mode} | Ronda {room.race.round}
              </h3>
            </div>
          </div>

          <div className="leaderboard">
            {orderedPlayers.map((player) => (
              <div className="leader-row" key={player.id}>
                <div className="leader-main">
                  <span className="leader-dot" style={{ backgroundColor: player.color }} />
                  <span>{player.name}</span>
                </div>
                <div className="leader-values">
                  <span>Nivel {player.position}</span>
                  <span>Apuesta {player.betDrinks}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {room.settings.mode === GAME_MODES.CLASSIC ? (
          <div className="panel compact-panel">
            <div className="eyebrow">Ruleta</div>
            <h3>Resolución del nivel</h3>
            <p className="panel-copy">La ruleta decide quién gana el nivel. Si sube, ese grupo toma 3 tragos.</p>
            <button className="primary-btn block-btn" onClick={handleSpinClassic} disabled={!isHost || actionLocked}>
              Girar ruleta
            </button>
          </div>
        ) : (
          renderRandomChallengePanel()
        )}

        <div className="panel compact-panel">
          <div className="eyebrow">Historial</div>
          <h3>Últimas rondas</h3>
          <div className="history-list">
            {raceHistory.length ? (
              raceHistory.slice(0, 5).map((item) => (
                <article className="history-card" key={item.id}>
                  <strong>{item.title}</strong>
                  <span>{item.description}</span>
                  {item.tieBreakWinnerId ? <span>Desempate final: {room.players[item.tieBreakWinnerId]?.name}</span> : null}
                </article>
              ))
            ) : (
              <div className="panel-copy">Todavía no hay rondas resueltas.</div>
            )}
          </div>
        </div>
      </div>
    );
  }

  function renderRace() {
    if (!room.race) {
      return (
        <section className="screen center-screen">
          <div className="panel loading-panel">
            <div className="eyebrow">Preparando carrera</div>
            <h2>Sincronizando hipódromo</h2>
          </div>
        </section>
      );
    }

    return (
      <section className="screen race-screen">
        <header className="topbar">
          <div>
            <div className="eyebrow">Sala {room.code}</div>
            <h2>Hipódromo</h2>
          </div>
          <div className="topbar-actions">
            <button className={!session.controlledPlayerId ? "chip-btn active" : "chip-btn"} onClick={() => handleSetControl("")}>
              Compartido
            </button>
            {controlledPlayer ? <div className="current-controller">Controlando: {controlledPlayer.name}</div> : null}
            <button className="ghost-btn" onClick={handleLeaveRoom}>
              Salir
            </button>
          </div>
        </header>

        <div className="race-layout">
          <section className="panel track-panel">{renderTrack()}</section>
          {renderRaceSidebar()}
        </div>
        {classicSpinState.open ? (
          <div className="roulette-overlay">
            <div className="roulette-card">
              <div className="eyebrow">{classicSpinState.title}</div>
              <h3>Decidiendo qué caballo avanza</h3>
              <div className="roulette-stage">
                <div className="roulette-pointer" />
                <div className="roulette-wheel round-wheel">
                  {orderedPlayers.map((player, index) => {
                    const rotation = (360 / orderedPlayers.length) * index;
                    return (
                      <div
                        key={player.id}
                        className={
                          classicSpinState.activeHorseId === player.id
                            ? classicSpinState.winnerHorseId === player.id
                              ? "roulette-segment round-segment active winner"
                              : "roulette-segment round-segment active"
                            : "roulette-segment round-segment"
                        }
                        style={{
                          "--segment-color": player.color,
                          transform: `rotate(${rotation}deg)`,
                        }}
                      >
                        <div className="round-segment-label" style={{ transform: `translateX(-50%) rotate(${-rotation}deg)` }}>
                          <span className="roulette-number">#{player.horseNumber}</span>
                          <span>{player.name}</span>
                        </div>
                      </div>
                    );
                  })}
                  <div className="roulette-center-disc">RUEDA</div>
                </div>
              </div>
              <div className="roulette-current">
                {classicSpinState.activeHorseId
                  ? `Caballo seleccionado: ${
                      orderedPlayers.find((player) => player.id === classicSpinState.activeHorseId)?.name || ""
                    }`
                  : ""}
              </div>
            </div>
          </div>
        ) : null}
        {roundFeedback ? (
          <div className="round-feedback">
            <div className="round-feedback-card">
              <div className="eyebrow">{roundFeedback.title}</div>
              <div>{roundFeedback.description}</div>
            </div>
          </div>
        ) : null}
      </section>
    );
  }

  function renderFinished() {
    const winner = room.players?.[room.race.winnerId];
    const finishHistory = room.race?.history || [];
    const totalBetDrinks = orderedPlayers.reduce((accumulator, player) => accumulator + (Number(player.betDrinks) || 0), 0);
    return (
      <section className="screen">
        <header className="topbar">
          <div>
            <div className="eyebrow">Carrera finalizada</div>
            <h2>{room.code}</h2>
          </div>
          <button className="ghost-btn" onClick={handleLeaveRoom}>
            Salir
          </button>
        </header>

        <div className="two-column-layout">
          <section className="panel winner-panel">
            <div className="eyebrow">Ganador</div>
            <h3>{winner?.name}</h3>
            <div className="winner-number" style={{ color: winner?.color }}>
              Caballo #{winner?.horseNumber}
            </div>
            <p className="panel-copy">{room.race.summary}</p>
            <div className="rules-panel">
              <div className="rule-line">Apuesta del ganador: {winner?.betDrinks || 0} tragos</div>
              <div className="rule-line">Total apostado en la mesa: {totalBetDrinks} tragos</div>
              <div className="rule-line">Penalidad acumulada del ganador: {winner?.totalPenaltyDrinks || 0} tragos</div>
            </div>
            <button className="primary-btn" onClick={handleRestartRoom} disabled={!isHost}>
              Jugar otra carrera
            </button>
          </section>

          <section className="panel">
            <div className="panel-header">
              <div>
                <div className="eyebrow">Resultado</div>
                <h3>Tabla final</h3>
              </div>
            </div>
            <div className="leaderboard">
              {orderedPlayers
                .slice()
                .sort((left, right) => right.position - left.position || left.horseNumber - right.horseNumber)
                .map((player) => (
                  <div className="leader-row" key={player.id}>
                    <div className="leader-main">
                      <span className="leader-dot" style={{ backgroundColor: player.color }} />
                      <span>
                        {player.name} | Caballo #{player.horseNumber}
                      </span>
                    </div>
                    <div className="leader-values">
                      <span>Nivel {player.position}</span>
                      <span>Apuesta {player.betDrinks}</span>
                    </div>
                  </div>
                ))}
            </div>
          </section>

          <section className="panel">
            <div className="panel-header">
              <div>
                <div className="eyebrow">Historial final</div>
                <h3>Resumen de rondas</h3>
              </div>
            </div>
            <div className="history-list">
              {finishHistory.length ? (
                finishHistory.slice(0, 10).map((item) => (
                  <article className="history-card" key={item.id}>
                    <strong>{item.title}</strong>
                    <span>{item.description}</span>
                  </article>
                ))
              ) : (
                <div className="panel-copy">No hay rondas registradas.</div>
              )}
            </div>
          </section>
        </div>
      </section>
    );
  }

  function renderAppContent() {
    if (roomLoading) {
      return (
        <section className="screen center-screen">
          <div className="panel loading-panel">
            <div className="eyebrow">Sincronizando</div>
            <h2>Cargando estado de la carrera</h2>
          </div>
        </section>
      );
    }

    if (!room) return renderLanding();
    if (room.phase === ROOM_PHASES.SETUP) return renderSetup();
    if (room.phase === ROOM_PHASES.BETS) return renderBets();
    if (room.phase === ROOM_PHASES.PREDRINK) return renderPredrink();
    if (room.phase === ROOM_PHASES.RACE) return renderRace();
    return renderFinished();
  }

  return (
    <div className="app-shell">
      {message ? <div className="message-banner">{message}</div> : null}
      {renderAppContent()}
      <footer className="app-footer">Diseñado y Creado por Juan Cruz Zenarruza</footer>
    </div>
  );
}

export default App;
