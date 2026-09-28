import React, { act } from "react";
import { createRoot } from "react-dom/client";
import SwimPlanner from "@/pages/SwimPlanner";
import { toast } from "sonner";
import { GENERATE_STORAGE_KEY, trackGenerateSession } from "./generateAnalytics";

jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
jest.mock("jspdf", () => ({ jsPDF: jest.fn() }));
jest.mock("@/hooks/useCoachAccess", () => ({ useCoachAccess: () => ({ isPro: false, user: null, configured: false }) }));
jest.mock("@/lib/supabaseClient", () => ({ supabase: null }));
global.IS_REACT_ACT_ENVIRONMENT = true;
const parameters = { stroke: "freestyle", goal: "endurance", level: "intermediate", distance: 3000, intensity: "easy", pool_type: "50m" };
const start = Date.parse("2026-01-01T03:00:00Z");
const payload = () => window.gtag.mock.calls.at(-1)[2];

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(start);
  localStorage.clear();
  jest.clearAllMocks();
  window.gtag = jest.fn();
});
afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
  delete window.gtag;
});

test("first Generate preserves existing parameters and sends once with first_observed / 0", () => {
  trackGenerateSession({ ...parameters, email: "not-sent@example.com", user_id: "not-sent" });
  expect(window.gtag).toHaveBeenCalledTimes(1);
  expect(window.gtag).toHaveBeenCalledWith("event", "generate_session", { ...parameters, generate_type: "first_observed", days_since_first_generate: 0 });
  expect(JSON.parse(localStorage.getItem(GENERATE_STORAGE_KEY))).toEqual({ firstGenerateAt: start });
});

test.each([0, 1, 7, 30])("Generate %i calendar days after first", (days) => {
  trackGenerateSession(parameters);
  jest.setSystemTime(start + days * 86400000 + 1000);
  trackGenerateSession(parameters);
  expect(payload()).toEqual({ ...parameters, generate_type: days === 0 ? "same_day_repeat" : "later_day_repeat", days_since_first_generate: days });
  expect(JSON.parse(localStorage.getItem(GENERATE_STORAGE_KEY)).firstGenerateAt).toBe(start);
});

test("Brisbane midnight counts as the next calendar day even after one second", () => {
  jest.setSystemTime(Date.parse("2026-01-01T13:59:59Z"));
  trackGenerateSession(parameters);
  jest.setSystemTime(Date.parse("2026-01-01T14:00:00Z"));
  trackGenerateSession(parameters);
  expect(payload().days_since_first_generate).toBe(1);
  trackGenerateSession(parameters);
  expect(payload().generate_type).toBe("later_day_repeat");
});

test.each(["getItem", "setItem"])("unavailable localStorage %s sends unknown without throwing", (method) => {
  jest.spyOn(Storage.prototype, method).mockImplementation(() => { throw new Error("Storage unavailable"); });
  expect(() => trackGenerateSession(parameters)).not.toThrow();
  expect(payload()).toEqual({ ...parameters, generate_type: "unknown" });
});

test("blocked localStorage getter is safe", () => {
  jest.spyOn(window, "localStorage", "get").mockImplementation(() => { throw new Error("Denied"); });
  expect(() => trackGenerateSession(parameters)).not.toThrow();
  expect(payload().generate_type).toBe("unknown");
});

test.each(["{broken", "null", "{}", '{"firstGenerateAt":"yesterday"}', '{"firstGenerateAt":-1}'])("corrupted storage is preserved: %s", (raw) => {
  localStorage.setItem(GENERATE_STORAGE_KEY, raw);
  trackGenerateSession(parameters);
  expect(payload()).toEqual({ ...parameters, generate_type: "unknown" });
  expect(localStorage.getItem(GENERATE_STORAGE_KEY)).toBe(raw);
});

test("clock moving backwards produces unknown without negative days", () => {
  trackGenerateSession(parameters);
  jest.setSystemTime(start - 86400000);
  trackGenerateSession(parameters);
  expect(payload()).toEqual({ ...parameters, generate_type: "unknown" });
});

test("GA4 unavailable still records observed Generate without throwing", () => {
  delete window.gtag;
  expect(() => trackGenerateSession(parameters)).not.toThrow();
  expect(JSON.parse(localStorage.getItem(GENERATE_STORAGE_KEY)).firstGenerateAt).toBe(start);
});

test("GA4 throws without breaking generation", () => {
  window.gtag.mockImplementation(() => { throw new Error("Analytics failed"); });
  expect(() => trackGenerateSession(parameters)).not.toThrow();
});

test("only the analytics key is read or written", () => {
  localStorage.setItem("swim:v1:coach_id", "existing-coach");
  localStorage.setItem("swim:v1:sessions", "existing-sessions");
  const read = jest.spyOn(Storage.prototype, "getItem");
  const write = jest.spyOn(Storage.prototype, "setItem");
  trackGenerateSession(parameters);
  expect(read.mock.calls).toEqual([[GENERATE_STORAGE_KEY]]);
  expect(write.mock.calls).toEqual([[GENERATE_STORAGE_KEY, JSON.stringify({ firstGenerateAt: start })]]);
});

test.each([false, true])("one real Generate click sends once and shows a result (analytics throws: %s)", async (throws) => {
  if (throws) window.gtag.mockImplementation(() => { throw new Error("Analytics failed"); });
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(<React.StrictMode><SwimPlanner /></React.StrictMode>));
    const button = container.querySelector('[data-testid="generate-button"]');
    await act(async () => button.click());
    expect(button.disabled).toBe(true);
    await act(async () => jest.advanceTimersByTime(60));
    expect(window.gtag).toHaveBeenCalledTimes(1);
    expect(window.gtag.mock.calls[0][1]).toBe("generate_session");
    expect(container.querySelector("#session-result").textContent).toContain("Session output");
    expect(toast.success).toHaveBeenCalledWith("Session ready");
    expect(toast.error).not.toHaveBeenCalled();
    expect(button.disabled).toBe(false);
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});
