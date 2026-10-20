import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import SeasonPlanner from './SeasonPlanner';
import { toast } from 'sonner';
jest.mock('sonner', () => ({toast:{success:jest.fn(),error:jest.fn()}}));
let root, host;
beforeEach(() => { jest.useFakeTimers(); global.IS_REACT_ACT_ENVIRONMENT = true; host=document.createElement('div'); document.body.appendChild(host); root=createRoot(host); act(() => root.render(<SeasonPlanner/>)); });
afterEach(() => { act(() => root.unmount()); host.remove(); jest.clearAllTimers(); jest.useRealTimers(); jest.clearAllMocks(); });
const click = id => act(() => host.querySelector(`[data-testid="${id}"]`).click());
const fill = (el,value) => act(() => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,value); el.dispatchEvent(new Event('input',{bubbles:true})); });
test('official PB survives event switching only within its bound event and course', () => {
  fill(host.querySelector('[aria-label="Official race PB 100m freestyle LCM"]'),'52.00');
  click('season-event-tile-200-butterfly-m');
  expect(host.querySelector('[aria-label="Official race PB 200m butterfly LCM"]').value).toBe('');
  click('season-event-tile-100-freestyle-m');
  expect(host.querySelector('[aria-label="Official race PB 100m freestyle LCM"]').value).toBe('52.00');
  expect(host.querySelector('[aria-label="Official race PB 100m freestyle SCM"]').value).toBe('');
  click('season-target-course-tile-scy');
  expect(host.querySelector('[aria-label^="Official race PB"]')).toBeNull();
  click('season-event-tile-100-freestyle-yd');
  expect(host.querySelector('[aria-label="Official race PB 100yd freestyle SCY"]').value).toBe('');
});
test('expanded presets, duration semantics and heuristic capped summary', () => {
  click('season-sessions-tile-14');
  click('season-duration-tile-210');
  const generate = [...host.querySelectorAll('button')].find(b => b.textContent.includes('Generate'));
  act(() => generate.click());
  expect(toast.error).not.toHaveBeenCalled();
  expect(host.textContent).toContain('capped at 65,000');
  expect(host.textContent).toContain('excluding separate dryland');
});
test('invalid official PB blocks generation with actionable error', () => {
  fill(host.querySelector('[aria-label="Official race PB 100m freestyle LCM"]'),'training best');
  act(() => [...host.querySelectorAll('button')].find(b => b.textContent.includes('Generate')).click());
  expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('Official race PB'));
  expect(host.querySelector('#season-plan-result')).toBeNull();
});
test('generated plan retains its units after training-pool edits', () => {
  act(() => [...host.querySelectorAll('button')].find(b => b.textContent.includes('Generate')).click());
  const summary = host.querySelector('#season-plan-result').textContent;
  click('season-pool-tile-yards');
  expect(host.querySelector('#season-plan-result').textContent).toContain(summary);
  expect(host.querySelector('[role="status"]').textContent).toContain('Regenerate required');
});

const generate = () => act(() => [...host.querySelectorAll('button')].find(b => b.textContent.includes('Generate')).click());
const pb = (event, course) => host.querySelector(`[aria-label="Official race PB ${event} ${course}"]`);
test('unfinished hidden event draft does not block blank active PB, remains intact and fails when active', () => {
  fill(pb('100m freestyle', 'LCM'), '1:');
  click('season-event-tile-200-butterfly-m');
  expect(pb('200m butterfly', 'LCM').value).toBe('');
  generate();
  expect(toast.error).not.toHaveBeenCalled();
  expect(toast.success).toHaveBeenCalledWith('Season plan ready');
  expect(host.querySelector('#season-plan-result').textContent).toContain('Coach-entered official race PB: Not entered');
  click('season-event-tile-100-freestyle-m');
  expect(pb('100m freestyle', 'LCM').value).toBe('1:');
  toast.success.mockClear();
  generate();
  expect(toast.success).not.toHaveBeenCalled();
  expect(pb('100m freestyle', 'LCM').getAttribute('aria-invalid')).toBe('true');
  expect(document.getElementById(pb('100m freestyle', 'LCM').getAttribute('aria-describedby')).textContent).toContain('100m freestyle (LCM)');
  fill(pb('100m freestyle', 'LCM'), '');
  expect(host.querySelector('[role="alert"]')).toBeNull();
  generate();
  expect(toast.success).toHaveBeenCalledWith('Season plan ready');
});
test('course switching preserves independent metre and yard drafts without PB reuse', () => {
  fill(pb('100m freestyle', 'LCM'), '52.00');
  fill(pb('100m freestyle', 'SCM'), '50.00');
  click('season-target-course-tile-scm');
  generate();
  expect(host.querySelector('#season-plan-result').textContent).toContain('Coach-entered official race PB: 50.00');
  click('season-target-course-tile-scy');
  click('season-event-tile-100-freestyle-yd');
  generate();
  expect(host.querySelector('#season-plan-result').textContent).toContain('Coach-entered official race PB: Not entered');
  fill(pb('100yd freestyle', 'SCY'), '0:');
  click('season-target-course-tile-lcm');
  click('season-event-tile-100-freestyle-m');
  expect(pb('100m freestyle', 'LCM').value).toBe('52.00');
  expect(pb('100m freestyle', 'SCM').value).toBe('50.00');
  generate();
  expect(host.querySelector('#season-plan-result').textContent).toContain('Coach-entered official race PB: 52.00');
  expect(toast.error).not.toHaveBeenCalled();
  click('season-target-course-tile-scy');
  click('season-event-tile-100-freestyle-yd');
  expect(pb('100yd freestyle', 'SCY').value).toBe('0:');
  generate();
  expect(host.querySelector('[role="alert"]').textContent).toContain('100yd freestyle (SCY)');
});
test('approved calendar example displays date bounds, partial block and copied milestone', async () => {
  const dates = host.querySelectorAll('input[type="date"]');
  fill(dates[0],'2026-10-01'); fill(dates[1],'2026-10-25');
  click('season-taper-tile-10');
  generate();
  const text=host.querySelector('#season-plan-result').textContent;
  expect(text).toContain('4 training blocks');
  expect(text).toContain('2026-10-22 – 2026-10-24 (3 days) · Partial week');
  expect(text).toContain('Taper: 2026-10-15 – 2026-10-24 (10 days)');
  expect(text).toContain('Race Week annotation: 2026-10-18 – 2026-10-24');
  const writeText=jest.fn().mockResolvedValue();
  const original=Object.getOwnPropertyDescriptor(navigator,'clipboard');
  Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText}});
  try {
    await act(async()=>[...host.querySelectorAll('button')].find(b=>b.textContent.includes('Copy plan')).click());
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('Meet milestone: 2026-10-25'));
    expect(writeText.mock.calls[0][0]).not.toContain('Week 5 ·');
  } finally {
    if(original) Object.defineProperty(navigator,'clipboard',original); else delete navigator.clipboard;
  }
});
test('manual taper longer than short season shows actionable error',()=>{
  const dates=host.querySelectorAll('input[type="date"]');
  fill(dates[0],'2026-10-01');fill(dates[1],'2026-10-08');click('season-taper-tile-8');generate();
  expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('Choose 7 days or fewer'));
  expect(host.querySelector('#season-plan-result')).toBeNull();
});

const copyButton = () => [...host.querySelectorAll('button')].find(b=>b.textContent.includes('Copy plan'));
const stale = () => {
  expect(copyButton().disabled).toBe(true);
  expect(host.querySelector('[role="status"]').textContent).toContain('Settings changed — Regenerate required');
};
test.each([0,1])('changing date field %s marks old results stale and exact restoration restores freshness', index=>{
  const fields=host.querySelectorAll('input[type="date"]');
  fill(fields[0],'2026-10-01');fill(fields[1],'2026-10-25');
  const original=fields[index].value;
  generate();
  fill(fields[index], index === 0 ? '2026-01-01' : '2027-12-31');
  stale(); generate(); // Invalid horizon must not refresh the previous snapshot.
  stale();
  fill(fields[index],original);
  expect(copyButton().disabled).toBe(false);
});
test('manual duration and auto transition require regeneration or full restoration',()=>{
  click('season-taper-tile-10');generate();
  click('season-taper-tile-11');stale();
  click('season-taper-tile-auto');stale();
  click('season-taper-tile-10');expect(copyButton().disabled).toBe(false);
});
test('event, course and PB edits compare the entire active snapshot without mutating drafts',()=>{
  fill(pb('100m freestyle','LCM'),'52.00');generate();
  fill(pb('100m freestyle','LCM'),'1:');stale();generate();stale();
  click('season-event-tile-200-butterfly-m');stale();
  click('season-event-tile-100-freestyle-m');expect(pb('100m freestyle','LCM').value).toBe('1:');stale();
  fill(pb('100m freestyle','LCM'),'52.00');expect(copyButton().disabled).toBe(false);
  click('season-target-course-tile-scm');stale();
  fill(pb('100m freestyle','SCM'),'50');
  click('season-target-course-tile-lcm');stale(); // Restoring course alone is insufficient.
  fill(pb('100m freestyle','SCM'),'');expect(copyButton().disabled).toBe(false);
});
test.each(['season-level-tile-national','season-sessions-tile-14','season-duration-tile-210','season-pool-tile-yards','season-limitation-tile-speed','season-style-tile-sprint-focus'])('other generation input %s invalidates freshness',id=>{
  generate();click(id);stale();
});
test('copy handler refuses stale input even when invoked directly; regeneration copies new snapshot',async()=>{
  const fields=host.querySelectorAll('input[type="date"]');fill(fields[0],'2026-10-01');fill(fields[1],'2026-10-25');generate();
  const original=Object.getOwnPropertyDescriptor(navigator,'clipboard');
  const writeText=jest.fn().mockResolvedValue();Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText}});
  try {
    await act(async()=>copyButton().click());
    const oldCopy=writeText.mock.calls[0][0];
    fill(fields[1],'2026-11-01');stale();
    // Exercise the handler independently of the native disabled button guard.
    const button=copyButton();const key=Object.keys(button).find(k=>k.startsWith('__reactProps$'));
    await act(async()=>button[key].onClick());expect(writeText).toHaveBeenCalledTimes(1);
    generate();expect(copyButton().disabled).toBe(false);
    await act(async()=>copyButton().click());
    expect(oldCopy).toContain('Meet milestone: 2026-10-25');
    expect(writeText.mock.calls[1][0]).toContain('Meet milestone: 2026-11-01');
  } finally { if(original) Object.defineProperty(navigator,'clipboard',original);else delete navigator.clipboard; }
});
test('age and goal time participate in the full snapshot',()=>{
  generate();
  const age=host.querySelector('input[type="number"]');fill(age,'17');stale();fill(age,'16');expect(copyButton().disabled).toBe(false);
  const goal=[...host.querySelectorAll('input')].find(e=>e.placeholder==='e.g. 53.99');
  fill(goal,'51.00');stale();fill(goal,'');expect(copyButton().disabled).toBe(false);
});
