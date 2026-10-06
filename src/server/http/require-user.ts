import "server-only";

/** The slice of the Supabase client `requireUser` needs (structural, so tests pass doubles). */
export type ClaimsClient = {
  auth: {
    getClaims: () => PromiseLike<{
      data: { claims: { sub: string; email?: string } } | null;
      error: { message: string } | null;
    }>;
  };
};

/** Signed-in user as verified from the JWT signature (`getClaims`, never `getSession`). */
export type AuthedUser = { id: string; email: string | null };

/** Returns the verified user, or null when the request has no valid session. */
export async function requireUser(
  client: ClaimsClient,
): Promise<AuthedUser | null> {
  const { data, error } = await client.auth.getClaims();
  if (error || !data) {
    return null;
  }
  return { id: data.claims.sub, email: data.claims.email ?? null };
}
