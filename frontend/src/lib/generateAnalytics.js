// Calendar days must use the same timezone as the GA4 reporting property.
// Coach Brain's GA4 property uses Brisbane time, not the visitor's device timezone.
export const GENERATE_TIME_ZONE = "Australia/Brisbane";
export const GENERATE_STORAGE_KEY = "coach-brain:analytics:generate:v1";

function calendarDay(timestamp) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: GENERATE_TIME_ZONE,
    year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date(timestamp));
  const value = (type) => Number(parts.find((part) => part.type === type).value);
  return Date.UTC(value("year"), value("month") - 1, value("day")) / 86400000;
}

function repeatParameters() {
  try {
    const now = Date.now();
    const storage = window.localStorage;
    const raw = storage.getItem(GENERATE_STORAGE_KEY);
    if (raw === null) {
      // Persist successfully before claiming this is the first observed Generate.
      calendarDay(now);
      storage.setItem(GENERATE_STORAGE_KEY, JSON.stringify({ firstGenerateAt: now }));
      return { generate_type: "first_observed", days_since_first_generate: 0 };
    }
    const first = JSON.parse(raw)?.firstGenerateAt;
    if (!Number.isSafeInteger(first) || first < 0 || first > now) {
      return { generate_type: "unknown" };
    }
    const days = calendarDay(now) - calendarDay(first);
    return {
      generate_type: days === 0 ? "same_day_repeat" : "later_day_repeat",
      days_since_first_generate: days,
    };
  } catch {
    // Leave damaged records untouched rather than misclassifying them as new users.
    return { generate_type: "unknown" };
  }
}

export function trackGenerateSession(parameters) {
  try {
    const repeat = repeatParameters();
    if (typeof window.gtag !== "function") return;
    // Explicit allowlist: no profile, email, account ID, or locally generated ID.
    const { stroke, goal, level, distance, intensity, pool_type } = parameters;
    window.gtag("event", "generate_session", {
      stroke, goal, level, distance, intensity, pool_type, ...repeat,
    });
  } catch {
    // Analytics is best-effort and must never interrupt successful generation.
  }
}
