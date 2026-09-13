export type WeeklyHours = Record<string, Array<{ open: string; close: string }>>;

const dayKeys = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;

function minutes(value: unknown) {
  if (typeof value !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) return undefined;
  const [hours, mins] = value.split(':').map(Number);
  return hours * 60 + mins;
}

function localParts(now: Date, timeZone = 'America/Mexico_City') {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now);
  const weekday = parts.find((part) => part.type === 'weekday')?.value.slice(0, 3).toLowerCase();
  const hour = Number(parts.find((part) => part.type === 'hour')?.value);
  const minute = Number(parts.find((part) => part.type === 'minute')?.value);
  return { day: dayKeys.indexOf(weekday as typeof dayKeys[number]) === -1 ? undefined : weekday, current: hour * 60 + minute };
}

function intervalIsOpen(interval: { open: string; close: string }, current: number, includeAfterMidnight: boolean) {
  const open = minutes(interval.open);
  const close = minutes(interval.close);
  if (open === undefined || close === undefined || open === close) return false;
  if (close > open) return current >= open && current <= close;
  return includeAfterMidnight ? current <= close : current >= open;
}

/**
 * Weekly hours are authoritative when present. The legacy openUntil fallback
 * keeps the demo catalog usable until every row has been imported with hours.
 */
export function isOpenNow(openUntil: string, now = new Date(), weeklyHours?: WeeklyHours, hoursKnown?: boolean) {
  const parts = localParts(now);
  if (parts.day && weeklyHours && Array.isArray(weeklyHours[parts.day])) {
    const dayIndex = dayKeys.indexOf(parts.day as typeof dayKeys[number]);
    const previousDay = dayKeys[(dayIndex + dayKeys.length - 1) % dayKeys.length];
    const today = weeklyHours[parts.day] ?? [];
    const previous = weeklyHours[previousDay] ?? [];
    if (today.some((interval) => intervalIsOpen(interval, parts.current, false))) return true;
    if (previous.some((interval) => {
      const open = minutes(interval.open);
      const close = minutes(interval.close);
      return open !== undefined && close !== undefined && close < open && parts.current <= close;
    })) return true;
    return false;
  }

  // Do not infer opening hours for a real catalog source that has no schedule.
  // The legacy fallback is kept for demo/local fixtures and older rows.
  if (hoursKnown === false) return false;

  const closing = minutes(openUntil);
  if (closing === undefined) return false;
  const overnight = closing < 6 * 60;
  const opening = overnight ? 18 * 60 : 6 * 60;
  return overnight ? parts.current >= opening || parts.current <= closing : parts.current >= opening && parts.current <= closing;
}
