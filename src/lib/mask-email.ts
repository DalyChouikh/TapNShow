/**
 * An address shown partly: the first letter, `•••@`, the domain. TS twin of `private.mask_email`
 * (`20261006082336_m2_invites.sql`); the owner script and the admin area use it.
 */
export function maskEmail(email: string): string {
  const [local, domain = ""] = email.split("@");
  return `${local.slice(0, 1)}•••@${domain}`;
}
