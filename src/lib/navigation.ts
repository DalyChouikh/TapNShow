/** A full page load to `href` (Google's account chooser and consent screen, sign-in). */
export function goTo(href: string): void {
  window.location.assign(href);
}

/**
 * A full page load to `href` that leaves no history entry, so Back from the answer page returns to
 * `/invites` instead of the page that redirected.
 */
export function replaceWith(href: string): void {
  window.location.replace(href);
}
