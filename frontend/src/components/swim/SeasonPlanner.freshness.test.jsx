import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { toast } from 'sonner';
import SeasonPlanner from './SeasonPlanner';
import * as seasonPlanner from '@/lib/seasonPlanner';

jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));

let root, host, generateSpy, writeText, originalClipboard;

const button = text => [...host.querySelectorAll('button')].find(element => element.textContent.includes(text));
const copyButton = () => button('Copy plan');
const click = id => act(() => host.querySelector(`[data-testid="${id}"]`).click());
const fill = (element, value) => act(() => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(element, value);
  element.dispatchEvent(new Event('input', { bubbles: true }));
});
const dates = () => host.querySelectorAll('input[type="date"]');
const pb = (event = '100m freestyle', course = 'LCM') => host.querySelector(`[aria-label="Official race PB ${event} ${course}"]`);
const goal = () => [...host.querySelectorAll('input')].find(element => element.placeholder === 'e.g. 53.99');
const generate = () => act(() => button('Generate season plan').click());
const latestPlan = () => [...generateSpy.mock.results].reverse().find(result => result.type === 'return').value;
const copy = async () => { await act(async () => copyButton().click()); };
const copyDirectly = async () => {
  // Calling the React handler bypasses the native disabled-button protection.
  const element = copyButton();
  const propsKey = Object.keys(element).find(key => key.startsWith('__reactProps$'));
  await act(async () => element[propsKey].onClick());
};
const expectStale = () => {
  expect(copyButton().disabled).toBe(true);
  const status = host.querySelector('[role="status"]');
  expect(status.textContent).toContain('Settings changed — Regenerate required');
  expect(status.getAttribute('aria-live')).toBe('polite');
  expect(host.querySelector('#season-plan-result').getAttribute('aria-describedby')).toBe(status.id);
};
const expectFresh = () => {
  expect(copyButton().disabled).toBe(false);
  expect(host.querySelector('[role="status"]')?.textContent || '').not.toContain('Regenerate required');
};
const resultText = () => {
  const result = host.querySelector('#season-plan-result').cloneNode(true);
  result.querySelector('[role="status"]')?.remove();
  return result.textContent;
};
const expectCopiedPlan = plan => expect(writeText).toHaveBeenLastCalledWith(seasonPlanner.copySeasonPlanText(plan));

beforeEach(() => {
  jest.useFakeTimers();
  global.IS_REACT_ACT_ENVIRONMENT = true;
  generateSpy = jest.spyOn(seasonPlanner, 'generateSeasonPlan');
  writeText = jest.fn().mockResolvedValue();
  originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root.render(<SeasonPlanner />));
  fill(dates()[0], '2026-10-01');
  fill(dates()[1], '2026-10-25');
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  if (originalClipboard) Object.defineProperty(navigator, 'clipboard', originalClipboard);
  else delete navigator.clipboard;
  generateSpy.mockRestore();
  jest.clearAllTimers();
  jest.useRealTimers();
  jest.clearAllMocks();
});

test.each([
  ['start date', 0, '2026-10-02', 'currentDate'],
  ['meet date', 1, '2026-11-01', 'targetMeetDate'],
])('valid %s edits preserve the prior result and copy only the successfully regenerated plan', async (_, index, value, key) => {
  generate();
  const priorPlan = latestPlan();
  const priorText = resultText();
  await copy();
  expectCopiedPlan(priorPlan);

  fill(dates()[index], value);
  expectStale();
  expect(resultText()).toBe(priorText);
  await copy();
  await copyDirectly();
  expect(writeText).toHaveBeenCalledTimes(1);

  generate();
  const regeneratedPlan = latestPlan();
  expectFresh();
  expect(regeneratedPlan.input[key]).toBe(value);
  await copy();
  expect(writeText).toHaveBeenCalledTimes(2);
  expectCopiedPlan(regeneratedPlan);
  expect(writeText.mock.calls[1][0]).not.toBe(writeText.mock.calls[0][0]);
});

test('manual taper duration edits require successful regeneration before copying the new duration', async () => {
  click('season-taper-tile-10');
  generate();
  const priorPlan = latestPlan();
  await copy();
  expectCopiedPlan(priorPlan);
  click('season-taper-tile-11');
  expectStale();
  await copyDirectly();
  expect(writeText).toHaveBeenCalledTimes(1);
  generate();
  expectFresh();
  expect(latestPlan().input.taperPreference).toBe(11);
  expect(latestPlan().calendar.taperDays).toBe(11);
  await copy();
  expectCopiedPlan(latestPlan());
  expect(priorPlan.calendar.taperDays).toBe(10);
});

test.each([
  ['auto', 0],
  [0, 'auto'],
])('taper mode %s → %s is stale even when both modes produce the same effective duration', async (original, changed) => {
  click(`season-taper-tile-${original}`);
  generate();
  const priorPlan = latestPlan();
  expect(priorPlan.calendar.taperDays).toBe(0);
  click(`season-taper-tile-${changed}`);
  expectStale();
  await copyDirectly();
  expect(writeText).not.toHaveBeenCalled();
  generate();
  expectFresh();
  expect(latestPlan().input.taperPreference).toBe(changed);
  expect(latestPlan().calendar.taperDays).toBe(0);
  await copy();
  expectCopiedPlan(latestPlan());
});

test.each([
  ['empty start date', () => fill(dates()[0], ''), () => fill(dates()[0], '2026-10-01')],
  ['meet before start', () => fill(dates()[1], '2026-09-30'), () => fill(dates()[1], '2026-10-25')],
  ['taper longer than season', () => click('season-taper-tile-28'), () => click('season-taper-tile-auto')],
  ['target-course PB', () => fill(pb(), '1:'), () => fill(pb(), '52.00')],
  ['other-course PB', () => fill(pb('100m freestyle', 'SCM'), '1:'), () => fill(pb('100m freestyle', 'SCM'), '')],
  ['missing event after course change', () => click('season-target-course-tile-scy'), () => {
    click('season-target-course-tile-lcm');
    click('season-event-tile-100-freestyle-m');
  }],
])('failed regeneration with %s retains the original result and snapshot until complete restoration', async (_, change, restore) => {
  fill(pb(), '52.00');
  generate();
  const priorPlan = latestPlan();
  const priorText = resultText();
  await copy();
  expectCopiedPlan(priorPlan);
  change();
  expectStale();
  generate();
  expect(toast.error).toHaveBeenCalled();
  expect(generateSpy.mock.results[1].type).toBe('throw');
  expectStale();
  expect(resultText()).toBe(priorText);
  await copy();
  await copyDirectly();
  expect(writeText).toHaveBeenCalledTimes(1);
  restore();
  expectFresh();
  await copy();
  expect(writeText).toHaveBeenCalledTimes(2);
  expectCopiedPlan(priorPlan);
  expect(writeText.mock.calls[1][0]).toBe(writeText.mock.calls[0][0]);
});

test('PBs for every supported course belong to the snapshot and are copied from the generated plan', async () => {
  fill(pb(), '52.00');
  fill(pb('100m freestyle', 'SCM'), '50.00');
  generate();
  const priorPlan = latestPlan();
  const submitted = generateSpy.mock.calls[0][0];
  const submittedSnapshot = JSON.stringify(submitted);
  fill(pb('100m freestyle', 'SCM'), '49.00');
  expectStale();
  expect(JSON.stringify(submitted)).toBe(submittedSnapshot);
  expect(priorPlan.input.officialPBs['100-freestyle-m'].SCM).toBe('50.00');
  expect(priorPlan.courseContext.currentPBs.SCM).toBe('50.00');
  await copyDirectly();
  expect(writeText).not.toHaveBeenCalled();
  generate();
  expectFresh();
  expect(latestPlan().courseContext.relevantPB).toBe('52.00');
  expect(latestPlan().courseContext.currentPBs.SCM).toBe('49.00');
  await copy();
  expectCopiedPlan(latestPlan());
  expect(writeText.mock.calls[0][0]).toContain('SCM PB: 49.00 / LCM PB: 52.00');
});

test('restoring dates alone is insufficient when another snapshot input still differs', async () => {
  fill(pb(), '52.00');
  generate();
  const priorPlan = latestPlan();
  await copy();
  fill(dates()[1], '2026-11-01');
  fill(pb(), '53.00');
  fill(dates()[1], '2026-10-25');
  expectStale();
  await copyDirectly();
  expect(writeText).toHaveBeenCalledTimes(1);
  fill(pb(), '52.00');
  expectFresh();
  expect(generateSpy).toHaveBeenCalledTimes(1);
  await copy();
  expectCopiedPlan(priorPlan);
  expect(writeText.mock.calls[1][0]).toBe(writeText.mock.calls[0][0]);
});

test('metre/yard event and course restoration compares the goal too and preserves hidden invalid PB drafts', async () => {
  fill(pb(), '52.00');
  fill(pb('100m freestyle', 'SCM'), '50.00');
  fill(goal(), '51.50');
  generate();
  const priorPlan = latestPlan();
  const priorText = resultText();
  await copy();
  click('season-target-course-tile-scy');
  expectStale();
  click('season-event-tile-100-freestyle-yd');
  fill(pb('100yd freestyle', 'SCY'), '1:');
  click('season-target-course-tile-lcm');
  click('season-event-tile-100-freestyle-m');
  expect(pb().value).toBe('52.00');
  expect(pb('100m freestyle', 'SCM').value).toBe('50.00');
  expect(goal().value).toBe('');
  expectStale();
  await copyDirectly();
  expect(writeText).toHaveBeenCalledTimes(1);
  fill(goal(), '51.50');
  expectFresh();
  await copy();
  expectCopiedPlan(priorPlan);
  expect(writeText.mock.calls[1][0]).toBe(writeText.mock.calls[0][0]);
  click('season-target-course-tile-scy');
  click('season-event-tile-100-freestyle-yd');
  expect(pb('100yd freestyle', 'SCY').value).toBe('1:');
  generate();
  expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('100yd freestyle (SCY)'));
  expectStale();
  expect(resultText()).toBe(priorText);
  await copyDirectly();
  expect(writeText).toHaveBeenCalledTimes(2);
});

test.each([
  ['level', 'season-level-tile-national', 'national'],
  ['sessionsPerWeek', 'season-sessions-tile-14', 14],
  ['sessionDuration', 'season-duration-tile-210', 210],
  ['poolLength', 'season-pool-tile-yards', 'yards'],
  ['mainLimitation', 'season-limitation-tile-speed', 'speed'],
  ['trainingStyle', 'season-style-tile-sprint-focus', 'sprint focus'],
  ['eventId', 'season-event-tile-200-butterfly-m', '200-butterfly-m'],
  ['targetCourse', 'season-target-course-tile-scm', 'SCM'],
])('%s participates in freshness and copies only its regenerated result', async (key, id, value) => {
  generate();
  const priorText = resultText();
  click(id);
  expectStale();
  expect(resultText()).toBe(priorText);
  await copyDirectly();
  expect(writeText).not.toHaveBeenCalled();
  generate();
  expectFresh();
  expect(latestPlan().input[key]).toBe(value);
  await copy();
  expectCopiedPlan(latestPlan());
});

test.each([
  ['age', () => host.querySelector('input[type="number"]'), '17', 17],
  ['goalTime', goal, '51.00', '51.00'],
])('%s edits require regeneration before copying', async (key, field, value, normalized) => {
  generate();
  fill(field(), value);
  expectStale();
  await copyDirectly();
  expect(writeText).not.toHaveBeenCalled();
  generate();
  expectFresh();
  expect(latestPlan().input[key]).toBe(normalized);
  await copy();
  expectCopiedPlan(latestPlan());
});
