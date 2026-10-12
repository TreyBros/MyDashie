/** Dashboard topic icons. Each maps to a generated image at dash://brand/topic-<key>.png. */
export const TOPICS = [
  "revenue",
  "sales",
  "meetings",
  "tasks",
  "marketing",
  "traffic",
  "product",
  "support",
  "engineering",
  "finance",
  "people",
  "operations",
  "world",
  "calendar",
  "email",
  "general",
] as const;

export type Topic = (typeof TOPICS)[number];

export function asTopic(v: unknown): Topic {
  return (TOPICS as readonly string[]).includes(String(v)) ? (v as Topic) : "general";
}
