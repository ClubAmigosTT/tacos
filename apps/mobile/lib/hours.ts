export type WeeklyHours = Record<string, Array<{ open: string; close: string }>>;

const dayKeys = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;

function minutes(value: unknown) {
  if (typeof value !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) return undefined;
  const [hours, mins] = value.split(':').map(Number);
  return hours * 60 + mins;
}

function localParts(now: Date, timeZone = 'America/Mexico_City') {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(now);
  const weekday = parts.find((part) => part.type === 'weekday')?.value.slice(0, 3).toLowerCase();
  const hour = Number(parts.find((part) => part.type === 'hour')?.value);
  const minute = Number(parts.find((part) => part.type === 'minute')?.value);
  return {
    day: dayKeys.includes(weekday as typeof dayKeys[number]) ? weekday as typeof dayKeys[number] : undefined,
    current: hour * 60 + minute
  };
}

function intervalIsOpen(interval: { open: string; close: string }, current: number) {
  const open = minutes(interval.open);
  const close = minutes(interval.close);
  if (open === undefined || close === undefined || open === close) return false;
  return close > open ? current >= open && current <= close : current >= open;
}

/** Weekly hours are authoritative when present; openUntil is the legacy fallback. */
export function isOpenNow(openUntil: string, now = new Date(), weeklyHours?: WeeklyHours, hoursKnown?: boolean) {
  const parts = localParts(now);
  if (parts.day && weeklyHours && Array.isArray(weeklyHours[parts.day])) {
    const dayIndex = dayKeys.indexOf(parts.day);
    const previousDay = dayKeys[(dayIndex + dayKeys.length - 1) % dayKeys.length];
    const today = weeklyHours[parts.day] ?? [];
    const previous = weeklyHours[previousDay] ?? [];
    if (today.some((interval) => intervalIsOpen(interval, parts.current))) return true;
    return previous.some((interval) => {
      const open = minutes(interval.open);
      const close = minutes(interval.close);
      return open !== undefined && close !== undefined && close < open && parts.current <= close;
    });
  }

  // Never present a guessed opening state for a real catalog row with no
  // published schedule. The legacy fallback remains for local/demo fixtures.
  if (hoursKnown === false) return false;

  const closing = minutes(openUntil);
  if (closing === undefined) return false;
  const overnight = closing < 6 * 60;
  const opening = overnight ? 18 * 60 : 6 * 60;
  return overnight ? parts.current >= opening || parts.current <= closing : parts.current >= opening && parts.current <= closing;
}
