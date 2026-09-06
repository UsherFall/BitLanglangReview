/** Formats a Date as a Shanghai-time ISO string with +08:00, matching the
 * Source Workbook review-time convention used across the review queue and
 * charts. Move-only from `src/server/trade-import.ts`; output is unchanged. */
export function formatShanghai(date: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '00';
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}:${get('second')}.000+08:00`;
}

export function epochMsToShanghaiIso(epochMs: number): string {
  return formatShanghai(new Date(epochMs));
}
