import { normalizePerformanceDefinition as normalize, comparePerformanceDefinitions as compare,
  canonicalizePerformanceDefinition as canonical, MATCHING_VERSION } from "./performanceDefinition";

const definition = (segment = {}, top = {}) => ({ schemaVersion: 1, unit: "m", poolLength: 25,
  segment: { task: "swim", stroke: "freestyle", repeatCount: 8, repeatDistance: 100,
    startType: "push", recovery: { mode: "send_off", seconds: 90 }, equipment: [],
    effort: "controlled", target: { state: "none" }, ...segment }, ...top });
const freeze = x => { if (x && typeof x === "object") { Object.values(x).forEach(freeze); Object.freeze(x); } return x; };

test("normalization is immutable, idempotent and equipment is an unordered confirmed set", () => {
  const input = freeze(definition({ equipment: ["snorkel", "fins", "fins"] }));
  const before = JSON.stringify(input), result = normalize(input);
  expect(result.ok).toBe(true);
  expect(result.definition.segment.equipment).toEqual(["fins", "snorkel"]);
  expect(normalize(result.definition)).toEqual(result);
  result.definition.segment.equipment.push("paddles");
  expect(JSON.stringify(input)).toBe(before);
});

test("missing conditions stay unknown and confirmed none is explicit", () => {
  const result = normalize(definition({ equipment: undefined, recovery: undefined, target: undefined, startType: undefined, effort: undefined }));
  expect(result.ok).toBe(true);
  expect(result.definition.segment).toMatchObject({ equipment: null, recovery: null, target: { state: "unknown" }, startType: null, effort: null });
  expect(compare(result.definition, result.definition).classification).toBe("NOT_COMPARABLE");
  const none = definition({ equipment: [], recovery: { mode: "none" }, target: { state: "none" } });
  expect(compare(none, none).classification).toBe("EXACT");
  expect(canonical(none)).not.toBe(canonical(result.definition));
});

test.each(["m", "yd"])("both pool lengths supported for %s", unit => {
  for (const poolLength of [25, 50]) expect(normalize(definition({}, { unit, poolLength })).ok).toBe(true);
});
test.each(["swim", "drill", "kick", "pull", "skill"])("recordable %s is not tied to main_set", task => expect(normalize(definition({ task })).ok).toBe(true));
test.each(["freestyle", "backstroke", "breaststroke", "butterfly", "individual_medley", "choice"])("supports stroke %s", stroke => expect(normalize(definition({ stroke })).ok).toBe(true));
test.each([{ mode: "none" }, { mode: "rest", seconds: 15.5 }, { mode: "send_off", seconds: 90 }])("recovery %p", recovery => expect(normalize(definition({ recovery })).ok).toBe(true));
test.each(["push", "dive", "in_water"])("start %s", startType => expect(normalize(definition({ startType })).ok).toBe(true));

test.each([
  [{}, { schemaVersion: 2 }], [{}, { unit: "yards" }], [{}, { poolLength: 33 }],
  [{ repeatCount: NaN }], [{ repeatCount: Infinity }], [{ repeatCount: 0 }], [{ repeatCount: 1.5 }],
  [{ repeatDistance: -25 }], [{ repeatDistance: NaN }], [{ repeatDistance: Infinity }], [{ repeatDistance: 75 }, { poolLength: 50 }],
  [{ repeatCount: Number.MAX_SAFE_INTEGER }], [{ task: "unknown" }], [{ stroke: "" }], [{ startType: "flying" }],
  [{ effort: "whatever" }], [{ equipment: "none" }], [{ equipment: ["mystery"] }], [{ equipment: [null] }],
  [{ recovery: {} }], [{ recovery: { mode: "none", seconds: 0 } }], [{ recovery: { mode: "rest", seconds: 0 } }],
  [{ recovery: { mode: "send_off", seconds: "90" } }], [{ recovery: { mode: "rest", seconds: NaN } }],
  [{ recovery: { mode: "rest", seconds: Infinity } }], [{ recovery: { mode: "rest", seconds: -1 } }],
  [{ recovery: { mode: "rest", seconds: 1.123 } }], [{ recovery: { mode: "rest", seconds: 10, extraRest: 10 } }],
  [{ target: [] }], [{ target: { state: "range", minSeconds: 70, maxSeconds: 65 } }],
  [{ target: { state: "range", minSeconds: 0, maxSeconds: 65 } }], [{ target: { state: "range", minSeconds: NaN, maxSeconds: Infinity } }],
  [{ target: { state: "none", minSeconds: 65 } }], [{ target: { state: "range", minSeconds: 65.001, maxSeconds: 70 } }],
  [{ rounds: 2 }], [{ strokePhases: ["free", "fly"] }], [{}, { rounds: 2 }],
])("rejects invalid/materially unsupported data %p %p", (segment, top = {}) => {
  const d = definition(segment, top);
  expect(normalize(d).ok).toBe(false);
  expect(canonical(d)).toBeNull();
  expect(compare(d, definition()).classification).toBe("NOT_COMPARABLE");
});

test.each([
  [{}, {}, "EXACT"], [{ repeatCount: 6 }, {}, "SIMILAR"],
  [{ recovery: { mode: "send_off", seconds: 85 } }, {}, "SIMILAR"],
  [{ recovery: { mode: "rest", seconds: 90 } }, {}, "SIMILAR"],
  [{ task: "pull" }, {}, "RELATED"], [{ stroke: "butterfly" }, {}, "RELATED"],
  [{}, { poolLength: 50 }, "RELATED"], [{}, { unit: "yd" }, "NOT_COMPARABLE"],
  [{ repeatDistance: 50 }, {}, "RELATED"], [{ startType: "dive" }, {}, "RELATED"],
  [{ equipment: ["fins"] }, {}, "RELATED"], [{ equipment: undefined }, {}, "NOT_COMPARABLE"],
  [{ recovery: undefined }, {}, "NOT_COMPARABLE"], [{ target: undefined }, {}, "NOT_COMPARABLE"],
  [{ target: { state: "range", minSeconds: 65, maxSeconds: 68 } }, {}, "SIMILAR"],
  [{ effort: "hard" }, {}, "SIMILAR"],
])("classification and symmetric deterministic reasons %p %p -> %s", (segment, top, classification) => {
  const a = definition(), b = definition(segment, top);
  expect(compare(a, b).classification).toBe(classification);
  expect(compare(a, b)).toEqual(compare(b, a));
  expect(compare(a, b)).toEqual(compare(a, b));
  expect(compare(a, b).reasons.length > 0).toBe(classification !== "EXACT");
});

test("canonical identity ignores key order, equipment order and irrelevant metadata", () => {
  const a = definition({ equipment: ["fins", "snorkel"] });
  const b = { ...Object.fromEntries(Object.entries(a).reverse()),
    segment: { ...Object.fromEntries(Object.entries(a.segment).reverse()), equipment: ["snorkel", "fins"], wording: "Different words" },
    context: { goal: "speed", energySystem: "other", level: "elite", sessionRole: "test" },
    athleteId: "another-athlete", athleteName: "Private", date: "tomorrow", sessionId: "other", results: [1], comments: "Comment" };
  expect(canonical(a)).toBe(canonical(b));
  expect(compare(a, b)).toEqual({ classification: "EXACT", matchingVersion: MATCHING_VERSION, reasons: [] });
  expect(canonical(b)).not.toContain("Private");
  expect(canonical(a, 999)).toBeNull();
  expect(JSON.parse(canonical(a)).matchingVersion).toBe(1);
  expect(canonical(a)).not.toBe(canonical(definition({ equipment: ["fins", "snorkel"], repeatCount: 7 })));
});

test("error reasons are order-independent and round semantics cannot be flattened", () => {
  const a = definition({ rounds: 2, repeatCount: 4 }), b = definition({ repeatCount: 4, rounds: 2 });
  expect(compare(a, definition())).toEqual(compare(definition(), b));
  expect(normalize(null).ok).toBe(false);
  expect(normalize({}).ok).toBe(false);
});


test("adversarial definition values return errors rather than throwing", () => {
  for (const d of [definition({ repeatCount: Symbol('bad') }), definition({}, { poolLength: BigInt(25) }),
    Object.create(definition()), definition({ equipment: new Array(2) })]) {
    expect(() => normalize(d)).not.toThrow();
    expect(normalize(d).ok).toBe(false);
  }
});
test.each([{ stroke: "choice" }, { task: "drill" }, { task: "skill" }])("underspecified physical work cannot be EXACT: %p", fields => {
  const d = definition(fields);
  expect(compare(d, d).classification).toBe("NOT_COMPARABLE");
});
test.each(["startType", "effort", "equipment", "recovery", "target"])("individually missing %s cannot be UNKNOWN/UNKNOWN exact", key => {
  const d = definition({ [key]: undefined });
  expect(compare(d, d).classification).toBe("NOT_COMPARABLE");
});


test("oversized equipment and executable records are rejected", () => {
  expect(normalize(definition({ equipment: Array(65).fill("fins") })).ok).toBe(false);
  const d = definition(); Object.defineProperty(d.segment, "stroke", { get() { throw new Error("must not execute"); } });
  expect(normalize(d).ok).toBe(false);
});
test.each([null, undefined, [], "x", 1, NaN, Infinity])("malformed root %p returns structured failure", value => expect(normalize(value).ok).toBe(false));


test.each([
  [{ repeatCount: "8" }], [{ repeatCount: -1 }], [{ repeatCount: -Infinity }], [{ repeatDistance: 0 }],
  [{ repeatDistance: "100" }], [{ recovery: { seconds: 90 } }], [{ recovery: { mode: "interval", seconds: 90 } }],
  [{ recovery: [] }], [{ target: { state: "range", minSeconds: "65", maxSeconds: 68 } }],
  [{}, { poolLength: "25" }], [{}, { poolLength: NaN }], [{}, { poolLength: Infinity }],
  [{}, { segment: [] }],
])("review malformed protocol %p", (segment, top = {}) => expect(normalize(definition(segment, top)).ok).toBe(false));
test("all material differences affect canonical identity", () => {
  const base = canonical(definition());
  for (const [segment, top] of [
    [{ task: "kick" }], [{ stroke: "backstroke" }], [{ repeatCount: 6 }], [{ repeatDistance: 50 }],
    [{ startType: "dive" }], [{ recovery: { mode: "rest", seconds: 15 } }], [{ equipment: ["fins"] }],
    [{ effort: "easy" }], [{ target: { state: "range", minSeconds: 65, maxSeconds: 68 } }],
    [{}, { poolLength: 50 }], [{}, { unit: "yd" }],
  ]) expect(canonical(definition(segment, top))).not.toBe(base);
});
test("two known target ranges differing only in bounds are SIMILAR", () => {
  const a = definition({ target: { state: "range", minSeconds: 65, maxSeconds: 68 } });
  const b = definition({ target: { state: "range", minSeconds: 66, maxSeconds: 69 } });
  expect(compare(a, b)).toEqual(compare(b, a));
  expect(compare(a, b)).toMatchObject({ classification: "SIMILAR", reasons: [{ path: "segment.target", code: "different_condition" }] });
});
