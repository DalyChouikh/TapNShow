/** A legal page's content (spec §7.18): the date, five plain bullets, numbered sections. */
export type LegalDocument = {
  title: string;
  /** ISO date (YYYY-MM-DD) of the last change; shown as "Last updated …". */
  updated: string;
  summary: readonly string[];
  sections: ReadonlyArray<{ id: string; title: string; body: string }>;
};
