// Pure stopwatch contract: positive integer hundredths plus entered precision.
// Numeric input has only its shortest decimal precision; use strings to retain
// trailing zeroes. No rounding or inferred precision is performed on input.
export function validatePerformanceTime(time) {
  return !!time && typeof time === "object"
    && [Object.prototype, null].includes(Object.getPrototypeOf(time))
    && Reflect.ownKeys(time).every(key => ["hundredths", "precision"].includes(key)
      && Object.prototype.hasOwnProperty.call(Object.getOwnPropertyDescriptor(time, key), "value"))
    && Object.prototype.hasOwnProperty.call(time, "hundredths")
    && Object.prototype.hasOwnProperty.call(time, "precision")
    && Number.isSafeInteger(time.hundredths) && time.hundredths > 0
    && [0, 1, 2].includes(time.precision)
    && time.hundredths % (10 ** (2 - time.precision)) === 0;
}

export function parsePerformanceTime(input) {
  const invalid = () => ({ ok: false, value: null, error: "invalid_time" });
  if (typeof input !== "string" && typeof input !== "number") return invalid();
  if (typeof input === "number" && !Number.isFinite(input)) return invalid();
  // Bound parsing work; even maximum safe integer hundredths fits in 32 chars.
  if (typeof input === "string" && input.length > 128) return invalid();
  const text = String(input).trim();
  const match = /^(?:(\d+):([0-5]\d)|(\d+))(?:\.(\d{1,2}))?$/.exec(text);
  if (!match) return invalid();
  const fraction = match[4] || "";
  const seconds = match[3] === undefined
    ? Number(match[1]) * 60 + Number(match[2]) : Number(match[3]);
  const value = { hundredths: seconds * 100 + Number(fraction.padEnd(2, "0")), precision: fraction.length };
  return validatePerformanceTime(value) ? { ok: true, value, error: null } : invalid();
}

// Formatting never adds precision that was not entered and never mutates time.
export function formatPerformanceTime(time) {
  if (!validatePerformanceTime(time)) return null;
  const seconds = Math.floor(time.hundredths / 100);
  const fraction = String(time.hundredths % 100).padStart(2, "0").slice(0, time.precision);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}${fraction ? `.${fraction}` : ""}`;
}
