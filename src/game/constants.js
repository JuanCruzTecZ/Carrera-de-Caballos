export const MAX_PLAYERS = 6;
export const MIN_PLAYERS = 2;
export const FINISH_LEVEL = 7;

export const ROOM_PHASES = {
  SETUP: "setup",
  BETS: "bets",
  PREDRINK: "predrink",
  RACE: "race",
  FINISHED: "finished",
};

export const GAME_MODES = {
  CLASSIC: "CLASSIC",
  RANDOM: "RANDOM",
};

export const RANDOM_CHALLENGE_TYPES = {
  MATH: "math",
  DICE: "dice",
  TAP: "tap",
  POKER: "poker",
  HIDDEN_CARD: "hidden_card",
  SECRET_SYMBOL: "secret_symbol",
  NUMBER_TARGET: "number_target",
};

export const PLAYER_COLORS = ["#f94144", "#277da1", "#f9c74f", "#90be6d", "#f3722c", "#577590"];

export const SECRET_SYMBOLS = [
  { id: "star", label: "Estrella", glyph: "★" },
  { id: "moon", label: "Luna", glyph: "☾" },
  { id: "bolt", label: "Rayo", glyph: "⚡" },
  { id: "heart", label: "Corazón", glyph: "♥" },
];

export const HIDDEN_CARD_RULES = [
  { id: "highest", label: "Carta más alta" },
  { id: "lowest", label: "Carta más baja" },
  { id: "red", label: "Carta roja" },
  { id: "black", label: "Carta negra" },
  { id: "even", label: "Número par" },
  { id: "odd", label: "Número impar" },
];
