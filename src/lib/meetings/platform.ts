/** Meeting apps named on the Join button, by the link's host (the host or any subdomain of it). */
const PLATFORMS: ReadonlyArray<{ name: string; hosts: readonly string[] }> = [
  { name: "Discord", hosts: ["discord.gg", "discord.com", "discordapp.com"] },
  { name: "Google Meet", hosts: ["meet.google.com"] },
  { name: "Zoom", hosts: ["zoom.us"] },
  { name: "Microsoft Teams", hosts: ["teams.microsoft.com", "teams.live.com"] },
];

/**
 * The meeting app behind a link ("Discord", "Google Meet", …), or null when unknown or invalid.
 * @param url - the meeting link (http(s))
 */
export function meetingPlatform(url: string): string | null {
  if (!URL.canParse(url)) {
    return null;
  }
  const host = new URL(url).hostname.toLowerCase();
  return (
    PLATFORMS.find((platform) =>
      platform.hosts.some((h) => host === h || host.endsWith(`.${h}`)),
    )?.name ?? null
  );
}
