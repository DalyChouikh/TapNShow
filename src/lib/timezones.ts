/** IANA timezones known to this browser, sorted (`Intl.supportedValuesOf`, all supported browsers). */
export function listTimezones(): string[] {
  return [...Intl.supportedValuesOf("timeZone")].sort();
}

/** The device's timezone, used to pre-fill new workspaces (spec §7.1). */
export function browserTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}
