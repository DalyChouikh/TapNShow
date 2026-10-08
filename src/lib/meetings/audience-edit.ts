import type { Audience, AudienceBody } from "@/shared/api/meetings";

/** The `PUT …/audience` body that reproduces this audience. */
export function audienceBodyOf(audience: Audience): AudienceBody {
  return {
    listIds: audience.listIds,
    include: audience.people.filter((p) => p.added).map((p) => p.id),
    exclude: audience.people.filter((p) => p.excluded).map((p) => p.id),
  };
}

/** Adds or removes one list. */
export function toggleList(audience: Audience, listId: string): AudienceBody {
  const body = audienceBodyOf(audience);
  return {
    ...body,
    listIds: body.listIds.includes(listId)
      ? body.listIds.filter((id) => id !== listId)
      : [...body.listIds, listId],
  };
}

/**
 * Ticks or unticks one person: unticking a list member excludes them; unticking someone who is only
 * individually added removes the addition; ticking clears an exclusion.
 */
export function togglePerson(
  audience: Audience,
  personId: string,
  included: boolean,
): AudienceBody {
  const body = audienceBodyOf(audience);
  const person = audience.people.find((p) => p.id === personId);
  if (!person) {
    return body;
  }
  if (included) {
    return { ...body, exclude: body.exclude.filter((id) => id !== personId) };
  }
  if (person.listIds.length === 0) {
    return { ...body, include: body.include.filter((id) => id !== personId) };
  }
  // The database refuses a person in both include and exclude (someone added and also in a list).
  return {
    ...body,
    include: body.include.filter((id) => id !== personId),
    exclude: [...new Set([...body.exclude, personId])],
  };
}
