import { generateSeasonPlan, copySeasonPlanText } from './seasonPlanner';
const base = {currentDate:'2026-10-14',targetMeetDate:'2027-01-06'};
const race = p => p.weeklyPlan.find(w => w.phaseKey === 'raceSpecific').keySet;
test.each([['1500-freestyle-m','distance'],['200-IM-m','im'],['400-IM-m','im']])('%s generates correct specialization', (eventId, group) => expect(generateSeasonPlan({...base,eventId}).eventType).toBe(group));
test('50/100/200 fly have distinct race models and stroke specificity', () => {
  const sets = [50,100,200].map(d => race(generateSeasonPlan({...base,eventId:`${d}-butterfly-m`})));
  expect(new Set(sets).size).toBe(3);
  sets.forEach(set => expect(set).toContain('butterfly'));
  expect(sets[0]).toContain('acceleration'); expect(sets[1]).toContain('2x50'); expect(sets[2]).toContain('4x50');
});
test('200 and 400 IM use different leg distances in correct stroke order', () => {
  expect(race(generateSeasonPlan({...base,eventId:'200-IM-m'}))).toContain('4x50m');
  expect(race(generateSeasonPlan({...base,eventId:'400-IM-m'}))).toContain('4x100m');
});
test('official PB changes neither sets nor numeric pace and cannot leak across events/courses', () => {
  const officialPBs = {'100-freestyle-m':{LCM:'52.00'}};
  const p = generateSeasonPlan({...base,officialPBs});
  expect(p.courseContext.relevantPB).toBe('52.00');
  expect(p.weeklyPlan).toEqual(generateSeasonPlan(base).weeklyPlan);
  expect(generateSeasonPlan({...base,officialPBs,eventId:'200-butterfly-m'}).courseContext.relevantPB).toBe('');
  expect(generateSeasonPlan({...base,officialPBs,targetCourse:'SCM'}).courseContext.relevantPB).toBe('');
  expect(generateSeasonPlan({...base,currentPB:'50',currentPBs:{LCM:'51'}}).courseContext.relevantPB).toBe('');
});
test('cap and floor are disclosed in result and copy without changing cap', () => {
  const p = generateSeasonPlan({...base,sessionsPerWeek:14,sessionDuration:240});
  expect(p.volumeEstimate.capped).toBe(true);
  expect(Math.max(...p.weeklyPlan.map(w => w.estimatedWeeklyVolume))).toBe(65000);
  expect(copySeasonPlanText(p)).toContain('capped at 65,000');
  expect(generateSeasonPlan({...base,sessionsPerWeek:1,sessionDuration:60}).volumeEstimate.note).toContain('floored');
});
test('cross-unit training does not convert race rehearsal', () => expect(race(generateSeasonPlan({...base,poolLength:'yards',targetCourse:'LCM'}))).toContain('No distance or time conversion'));
test('generator validates inputs before generation', () => expect(() => generateSeasonPlan({...base,sessionsPerWeek:15})).toThrow());
test('copying a legacy plan does not relabel unverified PBs as official', () => {
  const plan = generateSeasonPlan(base);
  delete plan.courseContext.pbSource;
  plan.courseContext.relevantPB = '55.00';
  expect(copySeasonPlanText(plan)).toContain('Legacy PB (unverified): 55.00');
  expect(copySeasonPlanText(plan)).not.toContain('Coach-entered official race PB:');
});
