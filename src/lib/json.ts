/** Any JSON value (log records, Sheets requests). */
export type Json =
  string | number | boolean | null | Json[] | { [key: string]: Json };
