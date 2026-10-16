import { parsePerformanceTime } from "./performanceTime";

// Competition distances: USMS Events 101. Meet/age eligibility remains coach-reviewed.
// https://www.usms.org/fitness-and-training/guides/swimming-101/events-101
export const COMPETITION_EVENTS = Object.freeze(['m', 'yd'].flatMap(unit =>
  ['freestyle', 'backstroke', 'breaststroke', 'butterfly', 'IM'].flatMap(stroke => {
    const distances = stroke === 'freestyle' ? (unit === 'm' ? [50,100,200,400,800,1500] : [50,100,200,500,1000,1650]) : stroke === 'IM' ? [100,200,400] : [50,100,200];
    return distances.map(distance => Object.freeze({
      id: `${distance}-${stroke}-${unit}`, stroke, distance, unit,
      label: `${distance}${unit} ${stroke}`,
      courses: Object.freeze(unit === 'yd' ? ['SCY'] : stroke === 'IM' && distance === 100 ? ['SCM'] : ['LCM','SCM']),
      group: stroke === 'IM' ? 'im' : distance <= 100 ? 'sprint' : distance === 200 ? 'middle' : 'distance',
    }));
  })
));

function choice(value, fallback, choices, name) {
  const result = value === undefined ? fallback : value;
  if (!choices.includes(result)) throw new Error(`Select a valid ${name}.`);
  return result;
}
function integer(value, fallback, min, max, name) {
  const result = value === undefined ? fallback : value;
  if (!/^[0-9]+$/.test(String(result)) || !Number.isInteger(Number(result)) || Number(result) < min || Number(result) > max) throw new Error(`${name} must be an integer from ${min} to ${max}.`);
  return Number(result);
}
function time(value, name) {
  if (value === undefined || value === '') return '';
  if (typeof value !== 'string' || !parsePerformanceTime(value).ok) throw new Error(`${name}: enter a positive time in seconds or m:ss, with up to two decimals.`);
  return value.trim();
}
function date(value, fallback, name) {
  const result = value === undefined ? fallback : value;
  if (typeof result !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(result) || !Number.isFinite(Date.parse(result)) || new Date(result).toISOString().slice(0,10) !== result) throw new Error(`Enter a valid ${name}.`);
  return result;
}
export function normalizeSeasonInput(raw = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Season inputs must be an object.');
  const poolLength = choice(raw.poolLength, '50m', ['25m','50m','yards'], 'pool length');
  const targetCourse = choice(raw.targetCourse, poolLength === 'yards' ? 'SCY' : poolLength === '25m' ? 'SCM' : 'LCM', ['LCM','SCM','SCY'], 'competition course');
  // Only exact legacy aliases are accepted. Ambiguous old categories require selection.
  const unit = targetCourse === 'SCY' ? 'yd' : 'm';
  const aliases = Object.fromEntries(COMPETITION_EVENTS.filter(e => e.unit === unit).flatMap(e => [[`${e.distance} ${e.stroke === 'freestyle' ? 'free' : e.stroke}`, e.id], [e.label, e.id]]));
  const eventId = raw.eventId === undefined ? (raw.mainEvent === undefined ? `100-freestyle-${unit}` : aliases[raw.mainEvent]) : raw.eventId;
  const event = COMPETITION_EVENTS.find(e => e.id === eventId);
  if (!event || !event.courses.includes(targetCourse)) throw new Error('Select one valid distance and stroke for the competition course.');
  const currentDate = date(raw.currentDate, new Date().toISOString().slice(0,10), 'current date');
  const targetMeetDate = date(raw.targetMeetDate, new Date(Date.parse(currentDate) + 84 * 86400000).toISOString().slice(0,10), 'meet date');
  if (targetMeetDate <= currentDate) throw new Error('Meet date must be after the current date.');
  const officialPBs = {};
  if (raw.officialPBs !== undefined && (!raw.officialPBs || typeof raw.officialPBs !== 'object' || Array.isArray(raw.officialPBs))) throw new Error('Invalid official PB entries.');
  Object.entries(raw.officialPBs || {}).forEach(([id, entries]) => {
    const pbEvent = COMPETITION_EVENTS.find(e => e.id === id);
    if (!pbEvent || !entries || typeof entries !== 'object' || Array.isArray(entries)) throw new Error('Invalid official PB event.');
    officialPBs[id] = {};
    Object.entries(entries).forEach(([course, value]) => {
      if (!pbEvent.courses.includes(course)) throw new Error('Official PB course does not support this event.');
      try {
        officialPBs[id][course] = time(value, `Official race PB for ${pbEvent.label} (${course})`);
      } catch (error) {
        error.pbField = { eventId: id, course };
        throw error;
      }
    });
  });
  return {
    currentDate, targetMeetDate, poolLength, targetCourse, eventId, event, mainEvent: event.label, officialPBs,
    // Historical unbound PB fields never become official PBs automatically.
    legacyPBUnverified: Boolean(raw.currentPB || Object.values(raw.currentPBs || {}).some(Boolean)),
    goalTime: time(raw.goalTime, 'Goal time'),
    age: integer(raw.age,16,8,99,'Age'),
    sessionsPerWeek: integer(raw.sessionsPerWeek,5,1,14,'Sessions per week'),
    sessionDuration: integer(raw.sessionDuration,90,60,240,'Pool-session minutes'),
    level: choice(raw.level,'competitive',['beginner','intermediate','competitive','national'],'level'),
    mainLimitation: choice(raw.mainLimitation,'race pace',['speed','endurance','back half','technique','starts/turns','race pace'],'limitation'),
    taperPreference: choice(raw.taperPreference,'auto',['auto','1','2','3'],'taper preference'),
    trainingStyle: choice(raw.trainingStyle,'balanced modern',['balanced modern','sprint focus','endurance focus','race pace focus','technique rebuild','junior development','national level preparation'],'training style'),
  };
}
