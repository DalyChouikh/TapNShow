/** A full page load to `href` (Google's account chooser and consent screen, sign-in). */
export function goTo(href: string): void {
  window.location.assign(href);
}
