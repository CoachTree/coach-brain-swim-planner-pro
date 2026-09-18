import { supabase } from "@/lib/supabaseClient";

const TABLES = {
  athletes: "athletes",
  sessions: "saved_sessions",
  favourites: "favourites",
  testSets: "test_sets",
  journal: "journal_entries",
};

function uuid() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return "xxxxxxxxxxxx4xxxyxxxxxxxxxxxxxxx".replace(/[xy]/g, (character) => {
    const random = (Math.random() * 16) | 0;
    const value = character === "x" ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}

function nowIso() {
  return new Date().toISOString();
}

async function getUserId() {
  if (!supabase) throw new Error("Supabase is not configured.");

  const { data, error } = await supabase.auth.getUser();
  if (error) throw error;
  if (!data.user) throw new Error("You must be signed in to use cloud storage.");
  return data.user.id;
}

function rowToRecord(row) {
  return {
    ...row.data,
    id: row.id,
    user_id: row.user_id,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function recordToData(record, userId, createdAt, updatedAt) {
  return {
    ...record,
    user_id: userId,
    created_at: createdAt,
    updated_at: updatedAt,
  };
}

function makeCollection(table) {
  return {
    async list() {
      const userId = await getUserId();
      const { data, error } = await supabase
        .from(table)
        .select("id, user_id, data, created_at, updated_at")
        .eq("user_id", userId)
        .order("updated_at", { ascending: false });

      if (error) throw error;
      return (data || []).map(rowToRecord);
    },

    async get(id) {
      const userId = await getUserId();
      const { data, error } = await supabase
        .from(table)
        .select("id, user_id, data, created_at, updated_at")
        .eq("id", id)
        .eq("user_id", userId)
        .maybeSingle();

      if (error) throw error;
      return data ? rowToRecord(data) : null;
    },

    async upsert(entry) {
      const userId = await getUserId();
      const existing = entry.id ? await this.get(entry.id) : null;
      const createdAt = existing?.created_at || entry.created_at || nowIso();
      const updatedAt = nowIso();
      const id = entry.id || uuid();
      const record = recordToData(
        { ...entry, id },
        userId,
        createdAt,
        updatedAt,
      );

      const { data, error } = await supabase
        .from(table)
        .upsert(
          {
            id,
            user_id: userId,
            data: record,
            created_at: createdAt,
            updated_at: updatedAt,
          },
          { onConflict: "id" },
        )
        .select("id, user_id, data, created_at, updated_at")
        .single();

      if (error) throw error;
      return rowToRecord(data);
    },

    async remove(id) {
      const userId = await getUserId();
      const { error } = await supabase
        .from(table)
        .delete()
        .eq("id", id)
        .eq("user_id", userId);

      if (error) throw error;
    },

    async clear() {
      const userId = await getUserId();
      const { error } = await supabase
        .from(table)
        .delete()
        .eq("user_id", userId);

      if (error) throw error;
    },
  };
}

export const Athletes = makeCollection(TABLES.athletes);
export const SavedSessions = makeCollection(TABLES.sessions);
export const Favourites = makeCollection(TABLES.favourites);
export const TestSets = makeCollection(TABLES.testSets);
export const Journal = makeCollection(TABLES.journal);

export const CloudSchema = {
  TABLES,
};
