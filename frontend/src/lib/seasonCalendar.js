// UTC is used only as an ordinal representation of date-only calendar values.
// No local-midnight elapsed-time arithmetic or timezone conversion is involved.
const DAY = 86400000;
export const dateOrdinal = value => Date.parse(`${value}T00:00:00Z`) / DAY;
export const ordinalDate = value => new Date(value * DAY).toISOString().slice(0, 10);
export function localToday() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
export const addCalendarDays = (date, days) => ordinalDate(dateOrdinal(date) + days);

export function seasonCalendar(input) {
  const start = dateOrdinal(input.currentDate);
  const meet = dateOrdinal(input.targetMeetDate);
  const days = meet - start;
  if (!Number.isInteger(days) || days < 1 || days > 168) throw new Error('Season must contain 1–168 pre-meet calendar days (at most 24 training blocks).');
  const weeks = Math.ceil(days / 7);
  const auto = input.taperPreference === 'auto';
  const proposed = auto ? (weeks <= 4 ? 0 : weeks <= 8 ? 7 : weeks <= 12 ? (input.level === 'national' ? 14 : 7) : weeks <= 18 ? 14 : 21) : Number(input.taperPreference);
  if (!Number.isInteger(proposed) || proposed < 0 || proposed > 28) throw new Error('Taper must be auto or an integer from 0 to 28 calendar days.');
  if (!auto && proposed > days) throw new Error(`Taper of ${proposed} days exceeds the ${days} available pre-meet days. Choose ${days} days or fewer.`);
  const taperDays = Math.min(proposed, days);
  const taperStart = meet - taperDays;
  const nonTaperDays = days - taperDays;
  const names = weeks <= 4 ? ['build'] : weeks <= 8 ? ['build','intensive','raceSpecific'] : ['preparation','build','intensive','raceSpecific'];
  const weights = weeks <= 4 ? [1] : weeks <= 8 ? [.45,.30,.25] : weeks <= 12 ? [.20,.35,.25,.20] : [.22,.34,.24,.20];
  // Allocate available blocks without minimums that can overflow short calendars.
  const available = Math.ceil(nonTaperDays / 7);
  const counts = weights.map(w => Math.floor(w * available));
  const order = weights.map((w,i) => ({i, remainder:w * available - counts[i]})).sort((a,b) => b.remainder - a.remainder || a.i-b.i);
  let remaining = available - counts.reduce((a,b) => a+b,0);
  for (const item of order) {
    if (remaining === 0) break;
    counts[item.i]++;
    remaining--;
  }
  const segments = [];
  let cursor = start;
  names.forEach((phaseKey,i) => {
    const end = Math.min(taperStart, cursor + counts[i]*7);
    if (end > cursor) segments.push({phaseKey,start:cursor,end:end-1});
    cursor = end;
  });
  if (taperDays) segments.push({phaseKey:'taper',start:taperStart,end:meet-1});
  const interval = (a,b) => ({startDate:ordinalDate(a),endDate:ordinalDate(b),dayCount:b-a+1});
  const phasePlan = segments.map(s => ({phaseKey:s.phaseKey,...interval(s.start,s.end)}));
  const raceStart = Math.max(start,meet-7);
  const blocks = Array.from({length:weeks}, (_,i) => {
    const a = start+i*7, b = Math.min(meet-1,a+6);
    const phases = segments.filter(s => s.start <= b && s.end >= a).map(s => ({phaseKey:s.phaseKey,...interval(Math.max(a,s.start),Math.min(b,s.end))}));
    const taperCount = taperDays ? Math.max(0,b-Math.max(a,taperStart)+1) : 0;
    return {week:i+1,...interval(a,b),partial:b-a+1<7,phases,taperDays:taperCount,partialTaper:taperCount>0 && taperCount<b-a+1,raceWeekDays:Math.max(0,b-Math.max(a,raceStart)+1)};
  });
  const omitted = names.filter((name,i) => counts[i] === 0);
  const allocationNote = omitted.length ? `Available pre-taper time cannot fit every phase; omitted: ${omitted.join(', ')}. No phase extends the season.` : null;
  return {allocationNote,days,weeks,meetDate:input.targetMeetDate,trainingStart:input.currentDate,trainingEnd:ordinalDate(meet-1),taperDays,taper: taperDays ? interval(taperStart,meet-1) : null,raceWeek:interval(raceStart,meet-1),autoAdjustment:proposed !== taperDays ? `Auto taper shortened from ${proposed} to ${taperDays} available days.` : null,phasePlan,blocks};
}
