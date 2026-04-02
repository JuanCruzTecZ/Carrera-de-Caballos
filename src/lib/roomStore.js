import { get, onDisconnect, onValue, ref, remove, runTransaction, set } from "firebase/database";
import { getFirebaseDatabase, getFirebaseRoomsRoot, isFirebaseConfigured } from "./firebase";

const LOCAL_KEY = "horse-race-rooms-v1";
const LOCAL_EVENT = "horse-race-local-update";
const ROOM_TTL_MS = 24 * 60 * 60 * 1000;

function clone(value) {
  return value ? JSON.parse(JSON.stringify(value)) : value;
}

function readLocalRooms() {
  try {
    return JSON.parse(window.localStorage.getItem(LOCAL_KEY) || "{}");
  } catch (error) {
    console.error("No se pudieron leer las salas locales.", error);
    return {};
  }
}

function writeLocalRooms(rooms) {
  window.localStorage.setItem(LOCAL_KEY, JSON.stringify(rooms));
  window.dispatchEvent(new CustomEvent(LOCAL_EVENT));
}

function roomPath(roomId) {
  return `${getFirebaseRoomsRoot()}/${roomId}`;
}

function rootPath() {
  return getFirebaseRoomsRoot();
}

async function purgeFirebaseRooms() {
  const database = getFirebaseDatabase();
  const snapshot = await get(ref(database, rootPath()));
  const rooms = snapshot.val() || {};
  const now = Date.now();
  await Promise.all(
    Object.entries(rooms).map(async ([roomId, room]) => {
      if (now - (Number(room?.createdAt) || 0) > ROOM_TTL_MS) {
        await remove(ref(database, roomPath(roomId)));
      }
    }),
  );
}

function purgeLocalRooms() {
  const rooms = readLocalRooms();
  const now = Date.now();
  let changed = false;
  Object.entries(rooms).forEach(([roomId, room]) => {
    if (now - (Number(room?.createdAt) || 0) > ROOM_TTL_MS) {
      delete rooms[roomId];
      changed = true;
    }
  });
  if (changed) writeLocalRooms(rooms);
}

export async function fetchRoom(roomId) {
  if (!roomId) return null;

  if (isFirebaseConfigured()) {
    await purgeFirebaseRooms();
    const database = getFirebaseDatabase();
    const snapshot = await get(ref(database, roomPath(roomId)));
    return snapshot.val();
  }

  purgeLocalRooms();
  const rooms = readLocalRooms();
  return clone(rooms[roomId] || null);
}

export async function createRoomInStore(room) {
  if (isFirebaseConfigured()) {
    await purgeFirebaseRooms();
    const database = getFirebaseDatabase();
    await set(ref(database, roomPath(room.id)), room);
    return room;
  }

  purgeLocalRooms();
  const rooms = readLocalRooms();
  rooms[room.id] = room;
  writeLocalRooms(rooms);
  return room;
}

export function subscribeToRoom(roomId, callback) {
  if (!roomId) return () => {};

  if (isFirebaseConfigured()) {
    const database = getFirebaseDatabase();
    return onValue(ref(database, roomPath(roomId)), (snapshot) => {
      callback(snapshot.val());
    });
  }

  const emit = () => {
    const rooms = readLocalRooms();
    callback(clone(rooms[roomId] || null));
  };

  const onStorage = (event) => {
    if (!event.key || event.key === LOCAL_KEY) emit();
  };

  emit();
  window.addEventListener("storage", onStorage);
  window.addEventListener(LOCAL_EVENT, emit);

  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(LOCAL_EVENT, emit);
  };
}

export async function transactRoom(roomId, mutator) {
  if (!roomId) return null;

  if (isFirebaseConfigured()) {
    const database = getFirebaseDatabase();
    const result = await runTransaction(ref(database, roomPath(roomId)), (currentRoom) => {
      if (!currentRoom) return currentRoom;
      const nextRoom = mutator(currentRoom);
      if (!nextRoom) return nextRoom;
      nextRoom.updatedAt = Date.now();
      return nextRoom;
    });
    return result.snapshot.val();
  }

  const rooms = readLocalRooms();
  const currentRoom = clone(rooms[roomId]);
  if (!currentRoom) return null;
  const nextRoom = mutator(currentRoom);
  nextRoom.updatedAt = Date.now();
  rooms[roomId] = nextRoom;
  writeLocalRooms(rooms);
  return clone(nextRoom);
}

export async function connectRoomPresence(roomId, clientId, controlledPlayerId = "") {
  if (!roomId || !clientId) return () => {};

  if (isFirebaseConfigured()) {
    const database = getFirebaseDatabase();
    const clientRef = ref(database, `${roomPath(roomId)}/clients/${clientId}`);
    await set(clientRef, {
      id: clientId,
      controlledPlayerId,
      joinedAt: Date.now(),
      lastSeenAt: Date.now(),
    });
    await onDisconnect(clientRef).remove();
    return async () => {
      await remove(clientRef);
    };
  }

  return () => {};
}
