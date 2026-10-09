// Lab 4 BR-25: calendar days are Asia/Bangkok days.
//
// Bangkok is UTC+7 all year and has had no daylight saving since 1920, so the
// boundary is arithmetic on the instant. Nothing here reads the machine's time
// zone: the answer is the same on a laptop in Bangkok and a server in UTC.

export const DASHBOARD_TIME_ZONE = "Asia/Bangkok";

const OFFSET_MS = 7 * 60 * 60_000;
export const DAY_MS = 24 * 60 * 60_000;

/** 00:00 Bangkok time of the Bangkok day that contains `instant`. */
export function bangkokDayStart(instant: Date): Date {
  const shifted = instant.getTime() + OFFSET_MS;
  return new Date(Math.floor(shifted / DAY_MS) * DAY_MS - OFFSET_MS);
}

/** Today in Bangkok as a half-open range: `from` is in it, `to` is not. */
export function bangkokToday(now: Date): { from: Date; to: Date } {
  const from = bangkokDayStart(now);
  return { from, to: new Date(from.getTime() + DAY_MS) };
}

/**
 * Where "the last `days` days" begins: 00:00 Bangkok time, `days - 1` days
 * before today, so that today is one of the days counted.
 */
export function bangkokLastDaysStart(now: Date, days: number): Date {
  return new Date(bangkokDayStart(now).getTime() - (days - 1) * DAY_MS);
}
