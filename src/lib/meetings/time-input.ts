const pad = (value: number) => String(value).padStart(2, "0");

/** Every time of day in `stepMinutes` steps ("00:00" … "23:45" for 15). */
export function timeOptions(stepMinutes: number): string[] {
  const options: string[] = [];
  for (let minutes = 0; minutes < 24 * 60; minutes += stepMinutes) {
    options.push(`${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`);
  }
  return options;
}

const TYPED = /^(\d{1,2})(?:[:.h]?(\d{2}))?\s*(am|pm)?$/i;

/** Reads what people type into the time field ("1830", "18:30", "6:30 pm"); null when not a time. */
export function parseTypedTime(input: string): string | null {
  const match = TYPED.exec(input.trim());
  if (!match) {
    return null;
  }
  const [, rawHours, rawMinutes, meridiem] = match;
  let hours = Number(rawHours);
  const minutes = rawMinutes === undefined ? 0 : Number(rawMinutes);
  if (rawMinutes === undefined && rawHours.length > 2) {
    return null;
  }
  if (meridiem) {
    if (hours < 1 || hours > 12) {
      return null;
    }
    hours = (hours % 12) + (meridiem.toLowerCase() === "pm" ? 12 : 0);
  }
  if (hours > 23 || minutes > 59) {
    return null;
  }
  return `${pad(hours)}:${pad(minutes)}`;
}
