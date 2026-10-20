import { seasonCalendar, addCalendarDays, localToday } from './seasonCalendar';
import { generateSeasonPlan, copySeasonPlanText } from './seasonPlanner';
const plan = (days,taperPreference=0,start='2026-10-01') => generateSeasonPlan({currentDate:start,targetMeetDate:addCalendarDays(start,days),taperPreference});
test('approved acceptance calendar, taper, race annotation and meet milestone', () => {
  const p = plan(24,10);
  expect(p.weeklyPlan.map(w => [w.startDate,w.endDate,w.dayCount])).toEqual([
    ['2026-10-01','2026-10-07',7],['2026-10-08','2026-10-14',7],['2026-10-15','2026-10-21',7],['2026-10-22','2026-10-24',3],
  ]);
  expect(p.calendar.taper).toEqual({startDate:'2026-10-15',endDate:'2026-10-24',dayCount:10});
  expect(p.calendar.raceWeek.startDate).toBe('2026-10-18');
  expect(p.calendar.meetDate).toBe('2026-10-25');
  expect(p.weeklyPlan[3].estimatedWeeklyVolume).toBeNull();
  const text = copySeasonPlanText(p);
  ['2026-10-15 – 2026-10-24','2026-10-18 – 2026-10-24','Meet milestone: 2026-10-25','2026-10-22 – 2026-10-24 (3 days) · Partial week'].forEach(s => expect(text).toContain(s));
});
test.each([1,3,5,9,24])('%s-week horizon cannot overflow', weeks => {
  const p=plan(weeks*7,'auto');
  expect(p.weeklyPlan).toHaveLength(weeks);
  expect(p.phasePlan.reduce((n,p)=>n+p.dayCount,0)).toBe(weeks*7);
});
test.each(Array.from({length:29},(_,i)=>i))('manual taper %s ends immediately before meet', taper => {
  const p=plan(35,taper);
  expect(p.calendar.taperDays).toBe(taper);
  expect(p.weeklyPlan.reduce((n,w)=>n+w.taperDays,0)).toBe(taper);
  expect(p.calendar.taper?.endDate || null).toBe(taper ? '2026-11-04':null);
});
test.each([-1,29,1.5,'',null,'bad'])('rejects invalid taper %s', taper => expect(()=>plan(35,taper)).toThrow());
test('rejects impossible manual taper and excessive horizon',()=>{
  expect(()=>plan(1,2)).toThrow('available'); expect(()=>plan(169)).toThrow('168');
  expect(plan(1,1).phasePlan.map(p=>p.phaseKey)).toEqual(['taper']);
  expect(plan(1,0).weeklyPlan).toHaveLength(1);
});
test('partial taper exposes both phases without prorating volume',()=>{
  const p=plan(24,9); const w=p.weeklyPlan[2];
  expect(w.partialTaper).toBe(true); expect(w.taperDays).toBe(6);
  expect(w.phases.map(p=>p.phaseKey)).toEqual(['build','taper']);
  expect(w.estimatedWeeklyVolume).toBeNull();
  expect(copySeasonPlanText(p)).toContain('Partial-week taper');
});
test.each([
 ['2026-12-29',7,'2027-01-05'],['2028-02-27',3,'2028-03-01'],
 ['2027-02-27',3,'2027-03-02'],['2026-03-07',7,'2026-03-14'],
 ['2026-10-31',7,'2026-11-07'],['2026-10-03',7,'2026-10-10'],
])('date-only boundary %s + %s', (start,days,meet)=>{
 expect(addCalendarDays(start,days)).toBe(meet);
 const p=plan(days,0,start); expect(p.calendar.days).toBe(days);
 expect(p.weeklyPlan.reduce((n,w)=>n+w.dayCount,0)).toBe(days);
});
test('all valid horizons and taper intervals cover every date once',()=>{
 for(let days=1;days<=168;days++) for(let taper=0;taper<=Math.min(28,days);taper++) {
  const c=seasonCalendar({currentDate:'2026-01-01',targetMeetDate:addCalendarDays('2026-01-01',days),taperPreference:taper,level:'competitive'});
  expect(c.phasePlan.reduce((n,p)=>n+p.dayCount,0)).toBe(days);
  for(let i=1;i<c.phasePlan.length;i++) expect(c.phasePlan[i].startDate).toBe(addCalendarDays(c.phasePlan[i-1].endDate,1));
  expect(c.blocks).toHaveLength(Math.ceil(days/7));
 }
});
test('today uses local calendar components rather than UTC ISO',()=>{
 const spy=jest.spyOn(global,'Date').mockImplementation(()=>({getFullYear:()=>2026,getMonth:()=>9,getDate:()=>17,toISOString:()=> '2026-10-16T14:30:00.000Z'}));
 expect(localToday()).toBe('2026-10-17'); spy.mockRestore();
});
test('calendar output is identical across DST timezones in separate processes',()=>{
 const fs=require('fs'),path=require('path'),{execFileSync}=require('child_process');
 const source=fs.readFileSync(path.join(__dirname,'seasonCalendar.js'),'utf8').replace(/export /g,'');
 const script=source+`; console.log(JSON.stringify(['2026-03-07','2026-10-03','2026-10-31'].map(start=>seasonCalendar({currentDate:start,targetMeetDate:addCalendarDays(start,35),taperPreference:10,level:'competitive'}))));`;
 const results=['UTC','America/New_York','Australia/Sydney','Australia/Brisbane'].map(TZ=>execFileSync(process.execPath,['-e',script],{env:{...process.env,TZ},encoding:'utf8'}));
 results.forEach(result=>expect(result).toBe(results[0]));
});
test.each([1,21,35,63,168])('auto policy for %s days stays bounded and separate from race annotation',days=>{
 const p=plan(days,'auto');
 expect(p.calendar.taperDays).toBeLessThanOrEqual(days);
 expect(p.calendar.raceWeek.dayCount).toBe(Math.min(7,days));
 expect(p.phasePlan.some(p=>p.phaseKey==='raceWeek')).toBe(false);
});
