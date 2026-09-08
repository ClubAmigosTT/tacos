/**
 * Decide whether a branch is open at a given local time when the catalog only
 * stores its closing hour. Night businesses (closing before 06:00) are
 * treated as opening at 18:00; daytime businesses open at 06:00. Keeping the
 * default here makes the map filter deterministic on web and native.
 */
export function isOpenNow(openUntil: string, now = new Date()) {
  const [hours, minutes] = openUntil.split(':').map(Number);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes) || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return false;
  const closing = hours * 60 + minutes;
  const current = now.getHours() * 60 + now.getMinutes();
  const overnight = closing < 6 * 60;
  const opening = overnight ? 18 * 60 : 6 * 60;
  return overnight ? current >= opening || current <= closing : current >= opening && current <= closing;
}
