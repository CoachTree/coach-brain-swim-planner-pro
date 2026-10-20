import { COMPETITION_EVENTS, normalizeSeasonInput } from './seasonPlannerInput';

test('catalog is unique and has explicit competition course boundaries', () => {
  expect(new Set(COMPETITION_EVENTS.map(e => e.id)).size).toBe(36);
  expect(COMPETITION_EVENTS.filter(e => e.courses.includes('LCM'))).toHaveLength(17);
  expect(COMPETITION_EVENTS.filter(e => e.courses.includes('SCM'))).toHaveLength(18);
  expect(COMPETITION_EVENTS.filter(e => e.courses.includes('SCY'))).toHaveLength(18);
});
test.each(COMPETITION_EVENTS)('$label is validated without name parsing', event => {
  expect(normalizeSeasonInput({eventId:event.id,targetCourse:event.courses[0]}).event).toEqual(event);
});
test.each(['distance','IM','stroke','1500 freestyle extra','not 50 free'])('ambiguous/unknown legacy event %s fails', mainEvent => {
  expect(() => normalizeSeasonInput({mainEvent})).toThrow();
});
test('defaults and explicit legacy events remain supported', () => {
  expect(normalizeSeasonInput()).toMatchObject({mainEvent:'100m freestyle',sessionsPerWeek:5,sessionDuration:90,age:16});
  expect(normalizeSeasonInput({mainEvent:'1500 free'}).event.group).toBe('distance');
  expect(normalizeSeasonInput({mainEvent:'200 IM'}).event.group).toBe('im');
  expect(normalizeSeasonInput({mainEvent:'400 IM'}).event.group).toBe('im');
});
test.each([0,15,1.5,'',null,NaN,Infinity])('rejects session count %s', sessionsPerWeek => expect(() => normalizeSeasonInput({sessionsPerWeek})).toThrow());
test.each([59,241,90.5,'',null,NaN])('rejects duration %s', sessionDuration => expect(() => normalizeSeasonInput({sessionDuration})).toThrow());
test.each([1,12,14])('supports %s sessions and 210 minutes', sessionsPerWeek => expect(normalizeSeasonInput({sessionsPerWeek,sessionDuration:210}).sessionDuration).toBe(210));
test.each([{eventId:'100-IM-m'}, {eventId:'100-freestyle-yd'}, {level:'elite'}, {age:7}, {poolLength:'30m'}, {taperPreference:'29'}, {trainingStyle:'unknown'}, {mainLimitation:'unknown'}, {currentDate:'2026-02-30'}, {targetMeetDate:'2000-01-01'}, {goalTime:'1:99'}])('rejects invalid input %j', input => expect(() => normalizeSeasonInput(input)).toThrow());
test('official PBs remain bound to event and course; unknown is empty', () => {
  const officialPBs = {'100-freestyle-m':{SCM:'50.12',LCM:'52.00'},'200-butterfly-m':{LCM:'2:03.45'}};
  const result = normalizeSeasonInput({officialPBs});
  expect(result.officialPBs).toEqual(officialPBs);
  officialPBs['100-freestyle-m'].LCM = '99';
  expect(result.officialPBs['100-freestyle-m'].LCM).toBe('52.00');
  expect(normalizeSeasonInput().officialPBs).toEqual({});
});
test.each([{'100-IM-m':{LCM:'60'}},{'100-freestyle-m':{SCY:'50'}},{'100-freestyle-m':{LCM:'training 50'}},{'100-freestyle-m':{LCM:'0'}},{unknown:{LCM:'50'}}])('invalid PB association/value fails', officialPBs => expect(() => normalizeSeasonInput({officialPBs})).toThrow());
test('submitted invalid PBs still fail strict validation with event/course field metadata', () => {
  try {
    normalizeSeasonInput({eventId:'200-butterfly-m', officialPBs:{'100-freestyle-m':{LCM:'1:'}}});
    throw new Error('Expected PB validation to fail');
  } catch (error) {
    expect(error.pbField).toEqual({eventId:'100-freestyle-m',course:'LCM'});
    expect(error.message).toContain('100m freestyle (LCM)');
  }
});
