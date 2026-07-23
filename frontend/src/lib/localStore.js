/**
 * Local persistence layer for Swim Training Planner.
 *
 * Designed to mirror a future REST API 1:1, so swapping localStorage
 * for a backend store is a single file change.
 *
 * Schema (versioned namespace `swim:v1:*`):
 *   swim:v1:coach_id   -> string uuid (stable per browser)
 *   swim:v1:athletes   -> [Athlete]
 *   swim:v1:sessions   -> [SavedSession]
 *   swim:v1:favourites -> [FavouriteSession]
 *   swim:v1:test_sets  -> [TestSet]
 *   swim:v1:journal    -> [JournalEntry]
 *
 * Common fields on every record:
 *   id          : uuid v4
 *   coach_id    : string (the local browser coach id; replaced by real account id later)
 *   created_at  : ISO-8601 string
 *   updated_at  : ISO-8601 string
 */

const NS = "swim:v1";
const KEYS = {
  coachId: `${NS}:coach_id`,
  athletes: `${NS}:athletes`,
  sessions: `${NS}:sessions`,
  favourites: `${NS}:favourites`,
  testSets: `${NS}:test_sets`,
  journal: `${NS}:journal`,
};

function uuid() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  // RFC4122-ish fallback
  return "xxxxxxxxxxxx4xxxyxxxxxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function nowIso() {
  return new Date().toISOString();
}

function readArr(key) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeArr(key, arr) {
  try {
    localStorage.setItem(key, JSON.stringify(arr));
  } catch {
    /* quota / disabled — silently ignore */
  }
}

export function getCoachId() {
  let cid = null;
  try {
    cid = localStorage.getItem(KEYS.coachId);
  } catch {
    /* ignore */
  }
  if (!cid) {
    cid = uuid();
    try {
      localStorage.setItem(KEYS.coachId, cid);
    } catch {
      /* ignore */
    }
  }
  return cid;
}

function withMeta(entry, existing) {
  const coach_id = getCoachId();
  if (existing) {
    return { ...existing, ...entry, updated_at: nowIso(), coach_id };
  }
  return {
    id: entry.id || uuid(),
    coach_id,
    created_at: nowIso(),
    updated_at: nowIso(),
    ...entry,
  };
}

function makeCollection(storageKey) {
  return {
    list() {
      return readArr(storageKey).sort((a, b) =>
        (b.updated_at || "").localeCompare(a.updated_at || ""),
      );
    },
    get(id) {
      return readArr(storageKey).find((e) => e.id === id) || null;
    },
    upsert(entry) {
      const arr = readArr(storageKey);
      const idx = arr.findIndex((e) => e.id === entry.id);
      if (idx >= 0) {
        const merged = withMeta(entry, arr[idx]);
        arr[idx] = merged;
        writeArr(storageKey, arr);
        return merged;
      }
      const created = withMeta(entry);
      arr.push(created);
      writeArr(storageKey, arr);
      return created;
    },
    remove(id) {
      const arr = readArr(storageKey).filter((e) => e.id !== id);
      writeArr(storageKey, arr);
    },
    clear() {
      writeArr(storageKey, []);
    },
  };
}

export const Favourites = makeCollection(KEYS.favourites);
export const Athletes = makeCollection(KEYS.athletes);
export const SavedSessions = makeCollection(KEYS.sessions);
export const TestSets = makeCollection(KEYS.testSets);
export const Journal = makeCollection(KEYS.journal);

export function exportCoachData() {
  return {
    app: "Coach Brain Swim Planner",
    schema: NS,
    exported_at: nowIso(),
    coach_id: getCoachId(),
    athletes: readArr(KEYS.athletes),
    sessions: readArr(KEYS.sessions),
    favourites: readArr(KEYS.favourites),
    test_sets: readArr(KEYS.testSets),
    journal: readArr(KEYS.journal),
  };
}

export function importCoachData(payload) {
  if (
    !payload ||
    typeof payload !== "object" ||
    payload.app !== "Coach Brain Swim Planner" ||
    typeof payload.schema !== "string"
  ) {
    throw new Error("Invalid backup file");
  }

  const next = {
    athletes: Array.isArray(payload.athletes) ? payload.athletes : [],
    sessions: Array.isArray(payload.sessions) ? payload.sessions : [],
    favourites: Array.isArray(payload.favourites) ? payload.favourites : [],
    testSets: Array.isArray(payload.test_sets) ? payload.test_sets : [],
    journal: Array.isArray(payload.journal) ? payload.journal : [],
  };

  writeArr(KEYS.athletes, next.athletes);
  writeArr(KEYS.sessions, next.sessions);
  writeArr(KEYS.favourites, next.favourites);
  writeArr(KEYS.testSets, next.testSets);
  writeArr(KEYS.journal, next.journal);

  if (payload.coach_id) {
    try {
      localStorage.setItem(KEYS.coachId, String(payload.coach_id));
    } catch {
      /* ignore */
    }
  }

  return {
    athletes: next.athletes.length,
    sessions: next.sessions.length,
    favourites: next.favourites.length,
    test_sets: next.testSets.length,
    journal: next.journal.length,
  };
}

export const Schema = {
  NS,
  KEYS,
};
