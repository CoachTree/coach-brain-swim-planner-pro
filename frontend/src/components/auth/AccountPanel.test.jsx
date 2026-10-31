import React, { act } from "react";
import { createRoot } from "react-dom/client";
import AccountPanel from "./AccountPanel";

jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
global.IS_REACT_ACT_ENVIRONMENT = true;
let root, container;
const render = async (overrides = {}) => {
  const access = { configured: true, loading: false, user: { id: "a", email: "a@example.test" }, isPro: false, error: null, refresh: jest.fn(), signOut: jest.fn(), ...overrides };
  await act(async () => root.render(<AccountPanel access={access} openSignal={1} />));
  return access;
};
beforeEach(() => { container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container); });
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });

test("shows complimentary trial and server-provided end time", async () => {
  await render({ isPro: true, accessSource: "founding", foundingExpiresAt: "2030-04-01T12:34:00Z" });
  expect(container.textContent).toContain("Founding Coach · Pro"); expect(container.textContent).toContain("complimentary");
  expect(container.textContent).toContain("2030"); expect(container.textContent).toContain("your local time"); expect(container.textContent).toContain("saved data stays");
});
test.each(["expired", "revoked"])("paid Pro remains paid when invitation is %s", async foundingStatus => {
  await render({ isPro: true, accessSource: "paid", paidActive: true, foundingStatus });
  expect(container.textContent).toContain("paid Pro access is active"); expect(container.textContent).not.toContain("now on the Free plan");
});
test.each([["expired", "has ended"], ["revoked", "was cancelled"]])("%s explains retained data", async (foundingStatus, phrase) => {
  await render({ foundingStatus }); expect(container.textContent).toContain(phrase); expect(container.textContent).toContain("saved data has not been deleted");
});
test("network error is not reported as free/expired and offers retry", async () => {
  const access = await render({ error: "We could not verify your access.", foundingStatus: "expired" });
  expect(container.textContent).toContain("Access check unavailable"); expect(container.querySelector('[role="alert"]').textContent).toContain("could not verify");
  expect(container.textContent).not.toContain("Free plan"); expect(container.textContent).not.toContain("has ended");
  const retry = [...container.querySelectorAll("button")].find(button => button.textContent === "Check access again");
  await act(async () => retry.click()); expect(access.refresh).toHaveBeenCalledTimes(1);
});
test("pending verification avoids asserting the user is free", async () => {
  await render({ loading: true }); expect(container.textContent).toContain("Checking"); expect(container.textContent).not.toContain("on the Free plan");
});

test("failed signout offers an explicit retry while account access and sign-in stay locked", async () => {
  const access = await render({ user: null, logoutPending: true, error: "Sign out could not be confirmed.", signOut: jest.fn().mockResolvedValue() });
  expect(container.textContent).toContain("Sign out pending"); expect(container.querySelector("form")).toBeNull();
  const retry = [...container.querySelectorAll("button")].find(button => button.textContent.includes("Retry sign out"));
  expect(retry.disabled).toBe(false);
  await act(async () => retry.click()); expect(access.signOut).toHaveBeenCalledTimes(1);
});
