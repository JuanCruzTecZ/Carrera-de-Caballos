import {
  FINISH_LEVEL,
  GAME_MODES,
  HIDDEN_CARD_RULES,
  MAX_PLAYERS,
  MIN_PLAYERS,
  PLAYER_COLORS,
  RANDOM_CHALLENGE_TYPES,
  ROOM_PHASES,
  SECRET_SYMBOLS,
} from "./constants";

const CARD_SUITS = [
  { id: "spades", symbol: "♠", color: "black" },
  { id: "hearts", symbol: "♥", color: "red" },
  { id: "diamonds", symbol: "♦", color: "red" },
  { id: "clubs", symbol: "♣", color: "black" },
];

const CARD_VALUES = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14];
const RANDOM_SEQUENCE = Object.values(RANDOM_CHALLENGE_TYPES);

export function uid(prefix = "id") {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
}

export function randomRoomCode() {
  return String(Math.floor(1000 + Math.random() * 9000));
}

export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function randomItem(items) {
  return items[Math.floor(Math.random() * items.length)];
}

export function buildClient(clientId, controlledPlayerId = "") {
  return {
    id: clientId,
    controlledPlayerId,
    joinedAt: Date.now(),
    lastSeenAt: Date.now(),
  };
}

function createPlayer(name, index, createdBy) {
  return {
    id: uid("player"),
    name,
    horseNumber: index + 1,
    lane: index + 1,
    color: PLAYER_COLORS[index % PLAYER_COLORS.length],
    createdBy,
    joinedAt: Date.now(),
    position: 0,
    betDrinks: 0,
    drankBeforeStart: false,
    totalPenaltyDrinks: 0,
  };
}

function createRaceState(mode) {
  return {
    mode,
    round: 0,
    winnerId: null,
    currentChallenge: null,
    history: [],
    challengeQueue: mode === GAME_MODES.RANDOM ? shuffle(RANDOM_SEQUENCE) : [],
  };
}

function ensureRaceState(room) {
  room.race ||= createRaceState(room.settings?.mode || GAME_MODES.CLASSIC);
  room.race.history ||= [];
  room.race.round = Number(room.race.round) || 0;
  room.race.challengeQueue ||= room.race.mode === GAME_MODES.RANDOM ? shuffle(RANDOM_SEQUENCE) : [];
  room.actionLock ||= { key: "", ownerClientId: "", expiresAt: 0 };
  return room;
}

function ensureChallengeState(room) {
  ensureRaceState(room);
  const challenge = room.race.currentChallenge;
  if (!challenge) return room;

  if (challenge.type === RANDOM_CHALLENGE_TYPES.MATH) {
    challenge.submissions ||= {};
  } else if (challenge.type === RANDOM_CHALLENGE_TYPES.TAP) {
    challenge.taps ||= {};
    challenge.startsAt ||= Date.now();
    challenge.endsAt ||= Date.now() + 5000;
  } else if (challenge.type === RANDOM_CHALLENGE_TYPES.POKER) {
    challenge.hands ||= {};
  } else if (challenge.type === RANDOM_CHALLENGE_TYPES.HIDDEN_CARD) {
    challenge.cards ||= {};
    challenge.rule ||= randomItem(HIDDEN_CARD_RULES);
  } else if (challenge.type === RANDOM_CHALLENGE_TYPES.SECRET_SYMBOL) {
    challenge.picks ||= {};
    challenge.winnerSymbolId ||= randomItem(SECRET_SYMBOLS).id;
  } else if (challenge.type === RANDOM_CHALLENGE_TYPES.NUMBER_TARGET) {
    challenge.picks ||= {};
    challenge.targetNumber ||= Math.floor(Math.random() * 100) + 1;
  }

  return room;
}

export function createRoom(roomId, hostClientId, hostName) {
  const player = createPlayer(hostName.trim() || "Jugador 1", 0, hostClientId);
  return {
    id: roomId,
    code: roomId,
    createdAt: Date.now(),
    hostClientId,
    phase: ROOM_PHASES.SETUP,
    settings: {
      mode: GAME_MODES.CLASSIC,
    },
    playerOrder: [player.id],
    players: {
      [player.id]: player,
    },
    clients: {
      [hostClientId]: buildClient(hostClientId, player.id),
    },
    race: createRaceState(GAME_MODES.CLASSIC),
  };
}

export function getOrderedPlayerIds(room) {
  return (room?.playerOrder || []).filter((playerId) => room.players?.[playerId]);
}

export function getOrderedPlayers(room) {
  return getOrderedPlayerIds(room).map((playerId) => room.players[playerId]);
}

export function findPlayerByCreator(room, clientId) {
  return getOrderedPlayers(room).find((player) => player.createdBy === clientId) || null;
}

function reindexPlayers(room) {
  getOrderedPlayers(room).forEach((player, index) => {
    player.horseNumber = index + 1;
    player.lane = index + 1;
    player.color = PLAYER_COLORS[index % PLAYER_COLORS.length];
  });
}

export function upsertClient(room, clientId, controlledPlayerId = "") {
  room.clients ||= {};
  room.clients[clientId] = {
    ...(room.clients[clientId] || {}),
    id: clientId,
    controlledPlayerId,
    lastSeenAt: Date.now(),
    joinedAt: room.clients[clientId]?.joinedAt || Date.now(),
  };
  if (!room.hostClientId) {
    room.hostClientId = clientId;
  }
  return room;
}

export function normalizeHost(room) {
  room.clients ||= {};
  if (room.hostClientId && room.clients[room.hostClientId]) return room;
  const nextHost = Object.values(room.clients)
    .sort((left, right) => (left.joinedAt || 0) - (right.joinedAt || 0))[0]
    ?.id;
  room.hostClientId = nextHost || room.hostClientId || "";
  return room;
}

export function removeClient(room, clientId) {
  if (room.clients?.[clientId]) {
    delete room.clients[clientId];
  }
  normalizeHost(room);
  return room;
}

export function hasActiveLock(room, lockKey = "") {
  ensureRaceState(room);
  const lock = room.actionLock || {};
  const active = Number(lock.expiresAt) > Date.now();
  if (!active) return false;
  if (!lockKey) return true;
  return lock.key === lockKey;
}

export function acquireLock(room, key, ownerClientId, durationMs = 5000) {
  ensureRaceState(room);
  const lock = room.actionLock || {};
  if (Number(lock.expiresAt) > Date.now() && lock.ownerClientId !== ownerClientId) {
    return false;
  }
  room.actionLock = {
    key,
    ownerClientId,
    expiresAt: Date.now() + durationMs,
  };
  return true;
}

export function releaseLock(room, key, ownerClientId) {
  ensureRaceState(room);
  const lock = room.actionLock || {};
  if (lock.key !== key || lock.ownerClientId !== ownerClientId) return room;
  room.actionLock = { key: "", ownerClientId: "", expiresAt: 0 };
  return room;
}

export function setClientControl(room, clientId, controlledPlayerId = "") {
  upsertClient(room, clientId, controlledPlayerId);
  return room;
}

export function addPlayer(room, name, createdBy) {
  if (room.phase !== ROOM_PHASES.SETUP) return room;
  if (getOrderedPlayerIds(room).length >= MAX_PLAYERS) return room;
  const normalizedName = name.trim();
  if (!normalizedName) return room;

  const player = createPlayer(normalizedName, getOrderedPlayerIds(room).length, createdBy);
  room.players[player.id] = player;
  room.playerOrder.push(player.id);
  reindexPlayers(room);
  return room;
}

export function removePlayer(room, playerId) {
  if (room.phase !== ROOM_PHASES.SETUP) return room;
  delete room.players[playerId];
  room.playerOrder = room.playerOrder.filter((id) => id !== playerId);
  Object.values(room.clients || {}).forEach((client) => {
    if (client.controlledPlayerId === playerId) {
      client.controlledPlayerId = "";
    }
  });
  reindexPlayers(room);
  return room;
}

export function renamePlayer(room, playerId, name) {
  if (room.phase !== ROOM_PHASES.SETUP) return room;
  const normalizedName = name.trim();
  if (!normalizedName || !room.players[playerId]) return room;
  room.players[playerId].name = normalizedName;
  return room;
}

export function setGameMode(room, mode) {
  if (room.phase !== ROOM_PHASES.SETUP) return room;
  room.settings.mode = mode;
  return room;
}

export function setPlayerBet(room, playerId, drinks) {
  const player = room.players[playerId];
  if (!player || room.phase !== ROOM_PHASES.BETS) return room;
  player.betDrinks = clamp(Number(drinks) || 0, 0, 99);
  return room;
}

export function confirmPredrink(room, playerId) {
  const player = room.players[playerId];
  if (!player || room.phase !== ROOM_PHASES.PREDRINK) return room;
  player.drankBeforeStart = true;
  return room;
}

export function clearPredrinkConfirmation(room) {
  getOrderedPlayers(room).forEach((player) => {
    player.drankBeforeStart = false;
  });
  return room;
}

export function getPlayerConnectionCounts(room) {
  const counts = {};
  getOrderedPlayerIds(room).forEach((playerId) => {
    counts[playerId] = 0;
  });

  Object.values(room.clients || {}).forEach((client) => {
    if (client.controlledPlayerId && counts[client.controlledPlayerId] !== undefined) {
      counts[client.controlledPlayerId] += 1;
    }
  });

  return counts;
}

export function getSetupIssues(room) {
  const issues = [];
  const players = getOrderedPlayers(room);

  if (players.length < MIN_PLAYERS) {
    issues.push("La carrera necesita al menos 2 jugadores o equipos.");
  }

  if (players.length > MAX_PLAYERS) {
    issues.push("La carrera admite hasta 6 jugadores o equipos.");
  }

  if (room.settings.mode === GAME_MODES.RANDOM) {
    const connectionCounts = getPlayerConnectionCounts(room);
    const disconnected = players.filter((player) => (connectionCounts[player.id] || 0) < 1);
    if (disconnected.length > 0) {
      issues.push("En RANDOM cada jugador o equipo necesita al menos un celular conectado de forma individual.");
    }
  }

  return issues;
}

export function allPlayersBet(room) {
  return getOrderedPlayers(room).every((player) => player.betDrinks >= 1);
}

export function allPlayersReady(room) {
  return getOrderedPlayers(room).every((player) => player.drankBeforeStart);
}

export function moveSetupToBets(room) {
  if (room.phase !== ROOM_PHASES.SETUP) return room;
  if (getSetupIssues(room).length > 0) return room;
  room.phase = ROOM_PHASES.BETS;
  getOrderedPlayers(room).forEach((player) => {
    player.betDrinks = player.betDrinks || 0;
  });
  return room;
}

export function moveBetsToPredrink(room) {
  if (room.phase !== ROOM_PHASES.BETS || !allPlayersBet(room)) return room;
  room.phase = ROOM_PHASES.PREDRINK;
  clearPredrinkConfirmation(room);
  return room;
}

export function startRace(room) {
  if (room.phase !== ROOM_PHASES.PREDRINK || !allPlayersReady(room)) return room;
  room.phase = ROOM_PHASES.RACE;
  room.race = createRaceState(room.settings.mode);
  getOrderedPlayers(room).forEach((player) => {
    player.position = 0;
    player.totalPenaltyDrinks = 0;
  });
  return room;
}

export function restartRoom(room) {
  room.phase = ROOM_PHASES.SETUP;
  room.race = createRaceState(room.settings.mode);
  getOrderedPlayers(room).forEach((player) => {
    player.position = 0;
    player.betDrinks = 0;
    player.drankBeforeStart = false;
    player.totalPenaltyDrinks = 0;
  });
  return room;
}

function finishRace(room, winnerId, summary) {
  ensureRaceState(room);
  room.phase = ROOM_PHASES.FINISHED;
  room.race.winnerId = winnerId;
  room.race.summary = summary;
  room.race.currentChallenge = null;
  return room;
}

function recordHistory(room, entry) {
  ensureRaceState(room);
  room.race.history.unshift({
    id: uid("round"),
    createdAt: Date.now(),
    ...entry,
  });
}

export function resolveClassicSpin(room) {
  if (room.phase !== ROOM_PHASES.RACE || room.settings.mode !== GAME_MODES.CLASSIC) return room;
  ensureRaceState(room);
  const contenders = getOrderedPlayers(room);
  if (!contenders.length) return room;

  const winner = randomItem(contenders);
  room.race.round += 1;
  winner.position = clamp((Number(winner.position) || 0) + 1, 0, FINISH_LEVEL);
  winner.totalPenaltyDrinks = (Number(winner.totalPenaltyDrinks) || 0) + 3;

  recordHistory(room, {
    mode: GAME_MODES.CLASSIC,
    title: `Ronda ${room.race.round}`,
    description: `${winner.name} ganó la ruleta, avanzó un nivel y debe tomar 3 tragos.`,
    winners: [winner.id],
  });

  if (winner.position >= FINISH_LEVEL) {
    return finishRace(
      room,
      winner.id,
      `${winner.name} llegó al nivel ${FINISH_LEVEL} y debe repartir ${winner.betDrinks} tragos.`,
    );
  }

  return room;
}

function buildDeck() {
  const deck = [];
  CARD_SUITS.forEach((suit) => {
    CARD_VALUES.forEach((value) => {
      deck.push({
        suit: suit.id,
        suitSymbol: suit.symbol,
        color: suit.color,
        value,
      });
    });
  });
  return deck;
}

function shuffle(list) {
  const clone = [...list];
  for (let index = clone.length - 1; index > 0; index -= 1) {
    const randomIndex = Math.floor(Math.random() * (index + 1));
    [clone[index], clone[randomIndex]] = [clone[randomIndex], clone[index]];
  }
  return clone;
}

function valueLabel(value) {
  if (value === 11) return "J";
  if (value === 12) return "Q";
  if (value === 13) return "K";
  if (value === 14) return "A";
  return String(value);
}

export function formatCard(card) {
  return `${valueLabel(card.value)}${card.suitSymbol}`;
}

function generateMathChallenge() {
  const left = Math.floor(Math.random() * 15) + 3;
  const right = Math.floor(Math.random() * 15) + 3;
  const useMultiply = Math.random() > 0.5;
  return {
    type: RANDOM_CHALLENGE_TYPES.MATH,
    prompt: useMultiply ? `${left} x ${right}` : `${left} + ${right}`,
    answer: useMultiply ? left * right : left + right,
    submissions: {},
  };
}

function generateDiceChallenge() {
  return {
    type: RANDOM_CHALLENGE_TYPES.DICE,
    prompt: "El dado decide qué caballo avanza un nivel.",
  };
}

function generateTapChallenge() {
  return {
    type: RANDOM_CHALLENGE_TYPES.TAP,
    prompt: "Golpeá el botón lo más rápido posible durante 5 segundos.",
    startsAt: Date.now(),
    endsAt: Date.now() + 5000,
    taps: {},
  };
}

function evaluatePokerHand(cards) {
  const sorted = [...cards].sort((a, b) => b.value - a.value);
  const values = sorted.map((card) => card.value);
  const counts = values.reduce((accumulator, value) => {
    accumulator[value] = (accumulator[value] || 0) + 1;
    return accumulator;
  }, {});
  const frequencies = Object.entries(counts).sort((a, b) => {
    if (b[1] === a[1]) return Number(b[0]) - Number(a[0]);
    return b[1] - a[1];
  });

  const isFlush = sorted.every((card) => card.suit === sorted[0].suit);
  const uniqueValues = [...new Set(values)].sort((a, b) => b - a);
  let isStraight = uniqueValues.length === 5 && uniqueValues[0] - uniqueValues[4] === 4;
  let straightHigh = uniqueValues[0];
  if (!isStraight && JSON.stringify(uniqueValues) === JSON.stringify([14, 5, 4, 3, 2])) {
    isStraight = true;
    straightHigh = 5;
  }

  if (isStraight && isFlush) {
    return { rank: 8, label: "Escalera de color", values: [straightHigh] };
  }
  if (frequencies[0][1] === 4) {
    return { rank: 7, label: "Póker", values: [Number(frequencies[0][0]), Number(frequencies[1][0])] };
  }
  if (frequencies[0][1] === 3 && frequencies[1][1] === 2) {
    return { rank: 6, label: "Full", values: [Number(frequencies[0][0]), Number(frequencies[1][0])] };
  }
  if (isFlush) {
    return { rank: 5, label: "Color", values };
  }
  if (isStraight) {
    return { rank: 4, label: "Escalera", values: [straightHigh] };
  }
  if (frequencies[0][1] === 3) {
    const kickers = frequencies.slice(1).map(([value]) => Number(value)).sort((a, b) => b - a);
    return { rank: 3, label: "Trío", values: [Number(frequencies[0][0]), ...kickers] };
  }
  if (frequencies[0][1] === 2 && frequencies[1][1] === 2) {
    const pairs = frequencies.slice(0, 2).map(([value]) => Number(value)).sort((a, b) => b - a);
    const kicker = Number(frequencies[2][0]);
    return { rank: 2, label: "Doble par", values: [...pairs, kicker] };
  }
  if (frequencies[0][1] === 2) {
    const kickers = frequencies.slice(1).map(([value]) => Number(value)).sort((a, b) => b - a);
    return { rank: 1, label: "Par", values: [Number(frequencies[0][0]), ...kickers] };
  }
  return { rank: 0, label: "Carta alta", values };
}

function compareScores(left, right) {
  if (left.rank !== right.rank) return left.rank - right.rank;
  const length = Math.max(left.values.length, right.values.length);
  for (let index = 0; index < length; index += 1) {
    const leftValue = left.values[index] || 0;
    const rightValue = right.values[index] || 0;
    if (leftValue !== rightValue) return leftValue - rightValue;
  }
  return 0;
}

function generatePokerChallenge(room) {
  const deck = shuffle(buildDeck());
  const hands = {};
  const orderedPlayers = getOrderedPlayers(room);

  orderedPlayers.forEach((player, index) => {
    const cards = deck.slice(index * 5, index * 5 + 5);
    hands[player.id] = {
      cards,
      score: evaluatePokerHand(cards),
    };
  });

  return {
    type: RANDOM_CHALLENGE_TYPES.POKER,
    prompt: "La app reparte una mano de póker automática entre todos.",
    hands,
  };
}

function generateHiddenCardChallenge(room) {
  const deck = shuffle(buildDeck());
  const cards = {};
  getOrderedPlayers(room).forEach((player, index) => {
    cards[player.id] = deck[index];
  });

  return {
    type: RANDOM_CHALLENGE_TYPES.HIDDEN_CARD,
    prompt: "Cada caballo recibe una carta oculta. La regla sale al azar.",
    rule: randomItem(HIDDEN_CARD_RULES),
    cards,
  };
}

function generateSecretSymbolChallenge() {
  return {
    type: RANDOM_CHALLENGE_TYPES.SECRET_SYMBOL,
    prompt: "Cada jugador elige un símbolo. Luego la app revela el símbolo ganador.",
    winnerSymbolId: randomItem(SECRET_SYMBOLS).id,
    picks: {},
  };
}

function generateNumberTargetChallenge() {
  return {
    type: RANDOM_CHALLENGE_TYPES.NUMBER_TARGET,
    prompt: "Cada jugador elige un número del 1 al 100. La app elige uno y avanzan los más cercanos.",
    targetNumber: Math.floor(Math.random() * 100) + 1,
    picks: {},
  };
}

export function createRandomChallenge(room) {
  if (room.phase !== ROOM_PHASES.RACE || room.settings.mode !== GAME_MODES.RANDOM) return room;
  ensureRaceState(room);
  if (room.race.currentChallenge) return room;

  if (!room.race.challengeQueue.length) {
    room.race.challengeQueue = shuffle(RANDOM_SEQUENCE);
  }

  const type = room.race.challengeQueue.shift();
  room.race.round += 1;

  if (type === RANDOM_CHALLENGE_TYPES.MATH) {
    room.race.currentChallenge = generateMathChallenge();
  } else if (type === RANDOM_CHALLENGE_TYPES.DICE) {
    room.race.currentChallenge = generateDiceChallenge();
  } else if (type === RANDOM_CHALLENGE_TYPES.TAP) {
    room.race.currentChallenge = generateTapChallenge();
  } else if (type === RANDOM_CHALLENGE_TYPES.POKER) {
    room.race.currentChallenge = generatePokerChallenge(room);
  } else if (type === RANDOM_CHALLENGE_TYPES.HIDDEN_CARD) {
    room.race.currentChallenge = generateHiddenCardChallenge(room);
  } else if (type === RANDOM_CHALLENGE_TYPES.SECRET_SYMBOL) {
    room.race.currentChallenge = generateSecretSymbolChallenge();
  } else if (type === RANDOM_CHALLENGE_TYPES.NUMBER_TARGET) {
    room.race.currentChallenge = generateNumberTargetChallenge();
  }

  return room;
}

export function submitMathAnswer(room, playerId, value) {
  ensureChallengeState(room);
  const challenge = room.race.currentChallenge;
  if (!challenge || challenge.type !== RANDOM_CHALLENGE_TYPES.MATH) return room;
  challenge.submissions[playerId] = {
    value: Number(value),
    submittedAt: Date.now(),
  };
  return room;
}

export function registerTap(room, playerId) {
  ensureChallengeState(room);
  const challenge = room.race.currentChallenge;
  if (!challenge || challenge.type !== RANDOM_CHALLENGE_TYPES.TAP) return room;
  if (Date.now() > challenge.endsAt) return room;
  challenge.taps[playerId] = (challenge.taps[playerId] || 0) + 1;
  return room;
}

export function submitSecretSymbol(room, playerId, symbolId) {
  ensureChallengeState(room);
  const challenge = room.race.currentChallenge;
  if (!challenge || challenge.type !== RANDOM_CHALLENGE_TYPES.SECRET_SYMBOL) return room;
  challenge.picks[playerId] = symbolId;
  return room;
}

export function submitNumberTarget(room, playerId, value) {
  ensureChallengeState(room);
  const challenge = room.race.currentChallenge;
  if (!challenge || challenge.type !== RANDOM_CHALLENGE_TYPES.NUMBER_TARGET) return room;
  const numericValue = clamp(Number(value) || 1, 1, 100);
  challenge.picks[playerId] = numericValue;
  return room;
}

function resolveFinalAdvance(room, winnerIds, title, description) {
  ensureRaceState(room);
  const uniqueWinners = [...new Set(winnerIds)].filter((playerId) => room.players[playerId]);
  if (!uniqueWinners.length) {
    recordHistory(room, {
      mode: GAME_MODES.RANDOM,
      title,
      description,
      winners: [],
    });
    room.race.currentChallenge = null;
    return room;
  }

  const finalists = uniqueWinners.filter((playerId) => room.players[playerId].position === FINISH_LEVEL - 1);
  const allowedWinners = [...uniqueWinners];
  let tieBreakWinnerId = null;

  if (finalists.length > 1) {
    tieBreakWinnerId = randomItem(finalists);
    for (let index = allowedWinners.length - 1; index >= 0; index -= 1) {
      if (finalists.includes(allowedWinners[index]) && allowedWinners[index] !== tieBreakWinnerId) {
        allowedWinners.splice(index, 1);
      }
    }
  }

  allowedWinners.forEach((playerId) => {
    room.players[playerId].position = clamp((Number(room.players[playerId].position) || 0) + 1, 0, FINISH_LEVEL);
  });

  recordHistory(room, {
    mode: GAME_MODES.RANDOM,
    title,
    description,
    winners: allowedWinners,
    tieBreakWinnerId,
  });

  const finishers = allowedWinners.filter((playerId) => room.players[playerId].position >= FINISH_LEVEL);
  if (finishers.length > 0) {
    const winnerId = finishers[0];
    return finishRace(
      room,
      winnerId,
      `${room.players[winnerId].name} llegó al nivel ${FINISH_LEVEL} y debe repartir ${room.players[winnerId].betDrinks} tragos.`,
    );
  }

  room.race.currentChallenge = null;
  return room;
}

export function resolveRandomChallenge(room) {
  ensureRaceState(room);
  ensureChallengeState(room);
  const challenge = room.race.currentChallenge;
  if (!challenge) return room;

  if (challenge.type === RANDOM_CHALLENGE_TYPES.DICE) {
    const winner = randomItem(getOrderedPlayers(room));
    return resolveFinalAdvance(
      room,
      winner ? [winner.id] : [],
      `Ronda ${room.race.round}: Dado`,
      winner ? `${winner.name} fue elegido al azar por el dado.` : "El dado no encontró ganador.",
    );
  }

  if (challenge.type === RANDOM_CHALLENGE_TYPES.MATH) {
    const correctEntries = Object.entries(challenge.submissions)
      .filter(([, submission]) => submission.value === challenge.answer)
      .sort((left, right) => left[1].submittedAt - right[1].submittedAt);
    const winnerId = correctEntries[0]?.[0];
    return resolveFinalAdvance(
      room,
      winnerId ? [winnerId] : [],
      `Ronda ${room.race.round}: Matemática`,
      winnerId
        ? `${room.players[winnerId].name} respondió primero el resultado correcto: ${challenge.answer}.`
        : "Nadie respondió correctamente la cuenta.",
    );
  }

  if (challenge.type === RANDOM_CHALLENGE_TYPES.TAP) {
    const sortedEntries = Object.entries(challenge.taps).sort((left, right) => right[1] - left[1]);
    const topValue = sortedEntries[0]?.[1] || 0;
    const winners = sortedEntries.filter((entry) => entry[1] === topValue && topValue > 0).map(([playerId]) => playerId);
    return resolveFinalAdvance(
      room,
      winners,
      `Ronda ${room.race.round}: Tap`,
      winners.length
        ? `Ganaron quienes hicieron ${topValue} toques en el tiempo límite.`
        : "Nadie registró toques válidos.",
    );
  }

  if (challenge.type === RANDOM_CHALLENGE_TYPES.SECRET_SYMBOL) {
    const winners = Object.entries(challenge.picks || {})
      .filter(([, symbolId]) => symbolId === challenge.winnerSymbolId)
      .map(([playerId]) => playerId);
    const symbol = SECRET_SYMBOLS.find((item) => item.id === challenge.winnerSymbolId);
    return resolveFinalAdvance(
      room,
      winners,
      `Ronda ${room.race.round}: Símbolo`,
      `La app reveló ${symbol?.label || "un símbolo"} como ganador.`,
    );
  }

  if (challenge.type === RANDOM_CHALLENGE_TYPES.NUMBER_TARGET) {
    const entries = Object.entries(challenge.picks || {});
    if (!entries.length) {
      return resolveFinalAdvance(room, [], `Ronda ${room.race.round}: Número objetivo`, "Nadie eligió un número.");
    }
    const distances = entries.map(([playerId, value]) => ({
      playerId,
      distance: Math.abs(value - challenge.targetNumber),
    }));
    const bestDistance = Math.min(...distances.map((entry) => entry.distance));
    const winners = distances.filter((entry) => entry.distance === bestDistance).map((entry) => entry.playerId);
    return resolveFinalAdvance(
      room,
      winners,
      `Ronda ${room.race.round}: Número objetivo`,
      `El número objetivo fue ${challenge.targetNumber}. Avanzan quienes quedaron más cerca.`,
    );
  }

  if (challenge.type === RANDOM_CHALLENGE_TYPES.HIDDEN_CARD) {
    const cardEntries = Object.entries(challenge.cards);
    let winners = [];

    if (challenge.rule.id === "highest") {
      const best = Math.max(...cardEntries.map(([, card]) => card.value));
      winners = cardEntries.filter(([, card]) => card.value === best).map(([playerId]) => playerId);
    } else if (challenge.rule.id === "lowest") {
      const best = Math.min(...cardEntries.map(([, card]) => card.value));
      winners = cardEntries.filter(([, card]) => card.value === best).map(([playerId]) => playerId);
    } else if (challenge.rule.id === "red") {
      winners = cardEntries.filter(([, card]) => card.color === "red").map(([playerId]) => playerId);
    } else if (challenge.rule.id === "black") {
      winners = cardEntries.filter(([, card]) => card.color === "black").map(([playerId]) => playerId);
    } else if (challenge.rule.id === "even") {
      winners = cardEntries.filter(([, card]) => card.value % 2 === 0).map(([playerId]) => playerId);
    } else if (challenge.rule.id === "odd") {
      winners = cardEntries.filter(([, card]) => card.value % 2 === 1).map(([playerId]) => playerId);
    }

    return resolveFinalAdvance(
      room,
      winners,
      `Ronda ${room.race.round}: Carta oculta`,
      `La regla de esta ronda fue: ${challenge.rule.label}.`,
    );
  }

  if (challenge.type === RANDOM_CHALLENGE_TYPES.POKER) {
    const ranked = Object.entries(challenge.hands).map(([playerId, hand]) => ({
      playerId,
      score: hand.score,
    }));
    ranked.sort((left, right) => compareScores(right.score, left.score));
    const best = ranked[0];
    const winners = ranked.filter((entry) => compareScores(entry.score, best.score) === 0).map((entry) => entry.playerId);
    return resolveFinalAdvance(
      room,
      winners,
      `Ronda ${room.race.round}: Póker`,
      `La mejor mano fue ${best?.score?.label || "sin resultado"}.`,
    );
  }

  return room;
}

export function getRaceLeaderIds(room) {
  const players = getOrderedPlayers(room);
  const bestPosition = Math.max(...players.map((player) => player.position), 0);
  return players.filter((player) => player.position === bestPosition).map((player) => player.id);
}

export function getRandomQueuePreview(room) {
  ensureRaceState(room);
  return [...(room.race.challengeQueue || [])];
}
