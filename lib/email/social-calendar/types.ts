// lib/email/social-calendar/types.ts
import type { BlockType, EmailDoc } from "@/lib/email/doc/types";
import type { BuildScope } from "@/lib/email/build-doc";

export type { BuildScope };
export type CalendarDay = "mon" | "tue" | "wed" | "thu" | "fri";

export interface DayTheme {
  day: CalendarDay;
  label: string;
  cardBlocks: BlockType[]; // ordered; never header/footer
  systemAddendum: string;
}

export interface SocialDraft {
  day: CalendarDay;
  theme: string;
  caption: string;
  hashtags: string[]; // 5–8, NO "#" prefix
  card: EmailDoc;
}

export interface WeeklyCalendar {
  scope?: BuildScope;
  weekOf: string; // ISO date of the Monday
  posts: SocialDraft[];
  /** Stale held figures refreshed to a current web-cited value (transparency). */
  webRefreshed?: string[];
  webSources?: { label: string; value: string; url: string }[];
}
