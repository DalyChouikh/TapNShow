/** Sign-in URL that returns to `currentPath` afterwards. */
export function loginPathFor(currentPath: string): string {
  return `/login?next=${encodeURIComponent(currentPath)}`;
}

/** Full navigation to sign-in (clears client state), keeping the current location as `next`. */
export function redirectToLogin(): void {
  window.location.assign(
    loginPathFor(`${window.location.pathname}${window.location.search}`),
  );
}
