import { parsePerformanceTime, formatPerformanceTime, validatePerformanceTime } from "./performanceTime";

test.each([
  [67, 6700, 0, "1:07"], [67.2, 6720, 1, "1:07.2"],
  ["67", 6700, 0, "1:07"], ["67.2", 6720, 1, "1:07.2"], ["67.20", 6720, 2, "1:07.20"],
  ["1:07", 6700, 0, "1:07"], ["1:07.2", 6720, 1, "1:07.2"], ["1:07.20", 6720, 2, "1:07.20"],
  ["59.99", 5999, 2, "0:59.99"], ["60", 6000, 0, "1:00"], ["0:59", 5900, 0, "0:59"],
  ["0.01", 1, 2, "0:00.01"], ["60:00", 360000, 0, "60:00"], [" 67.2 ", 6720, 1, "1:07.2"],
])("parses %p without losing precision", (input, hundredths, precision, formatted) => {
  const result = parsePerformanceTime(input);
  expect(result).toEqual({ ok: true, value: { hundredths, precision }, error: null });
  Object.freeze(result.value);
  expect(formatPerformanceTime(result.value)).toBe(formatted);
  expect(parsePerformanceTime(formatted).value).toEqual(result.value);
});

test.each(["", " ", null, undefined, false, {}, [], "NaN", "Infinity", NaN, Infinity, -Infinity,
  "-1", -1, "0", 0, "0:00.00", "1:7", "1:60", "1:99", ":07", "1:", "1:07:20", "1.5:07",
  "1:07.", "1:07.200", "67.123", ".5", "+67", "1e2", "67s", "1,07", "1: 07", "9007199254740991",
])("rejects invalid time %p", input => {
  expect(parsePerformanceTime(input)).toEqual({ ok: false, value: null, error: "invalid_time" });
});

test.each([
  { hundredths: 0, precision: 0 }, { hundredths: -1, precision: 2 }, { hundredths: 1.2, precision: 2 },
  { hundredths: Infinity, precision: 2 }, { hundredths: 6721, precision: 1 }, { hundredths: 6700, precision: 3 },
  { hundredths: 6720, precision: 0 }, null,
])("rejects corrupt canonical time %p", time => {
  expect(validatePerformanceTime(time)).toBe(false);
  expect(formatPerformanceTime(time)).toBeNull();
});


test("canonical time rejects arrays and inherited data", () => {
  for (const t of [Object.assign([], { hundredths: 6700, precision: 0 }), Object.create({ hundredths: 6700, precision: 0 })]) {
    expect(validatePerformanceTime(t)).toBe(false);
  }
});
test.each([["0:59.9", "0:59.9"], ["2:00", "2:00"], ["10:00.00", "10:00.00"], ["00067.20", "1:07.20"]])("review time case %s", (input, output) => {
  expect(formatPerformanceTime(parsePerformanceTime(input).value)).toBe(output);
});
test.each(["-1:07", "1:-07", "1:60.0", "1:7:2", "abc", "1.2.3"])("review malformed time %s", input => expect(parsePerformanceTime(input).ok).toBe(false));
