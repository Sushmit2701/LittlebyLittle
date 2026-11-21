// Builds a standard .ics calendar file. Times are "floating" (no time zone),
// so the phone places them at that clock time wherever you are.

const esc = (s) => String(s).replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/([,;])/g, '\\$1');
const stamp = (date, time) => `${date.replace(/-/g, '')}T${time.replace(':', '')}00`;

function endTime(time, minutes) {
  const [h, m] = time.split(':').map(Number);
  const t = Math.min(h * 60 + m + minutes, 23 * 60 + 59);
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
}

/** events: [{ uid, title, description, date: 'YYYY-MM-DD', time: 'HH:MM', minutes }] */
export function buildICS(events, now = new Date()) {
  const dtstamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Daily Chunker//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
  ];
  for (const e of events) {
    lines.push(
      'BEGIN:VEVENT',
      `UID:${e.uid}@daily-chunker`,
      `DTSTAMP:${dtstamp}`,
      `DTSTART:${stamp(e.date, e.time)}`,
      `DTEND:${stamp(e.date, endTime(e.time, e.minutes))}`,
      `SUMMARY:${esc(e.title)}`,
      `DESCRIPTION:${esc(e.description || '')}`,
      'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n') + '\r\n';
}

/**
 * Hands the file to the phone. On iPhone the share sheet can pass it to Calendar;
 * elsewhere it downloads. Returns 'shared' | 'downloaded' | 'failed'.
 */
export async function deliverICS(text, filename) {
  const file = typeof File !== 'undefined' ? new File([text], filename, { type: 'text/calendar' }) : null;
  try {
    if (file && navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: filename });
      return 'shared';
    }
  } catch (err) {
    if (err && err.name === 'AbortError') return 'cancelled';
  }
  try {
    const url = URL.createObjectURL(new Blob([text], { type: 'text/calendar' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    return 'downloaded';
  } catch {
    return 'failed';
  }
}
