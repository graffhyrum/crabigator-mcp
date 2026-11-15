import { type } from "arktype";
import type { Resource } from "./wanikani-client.ts";

const Level = type("1 <= number.integer <= 60").brand("Level");
export type Level = typeof Level.infer;

export type User = {
  readonly username: string;
  readonly level: Level;
};

export type HourBucket = {
  readonly at: Date;
  readonly subjectCount: number;
};

export type Summary = {
  readonly lessons: readonly HourBucket[];
  readonly reviews: readonly HourBucket[];
  readonly nextReviewsAt: Date | null;
};

const HourBucketWire = type({
  available_at: "string.date.iso.parse",
  subject_ids: "number.integer[]",
}).pipe((wire) => ({
  at: wire.available_at,
  subjectCount: wire.subject_ids.length,
}));

const UserWire = type({
  username: "string",
  level: Level,
}).pipe((wire) => ({
  username: wire.username,
  level: wire.level,
}));

const SummaryWire = type({
  lessons: HourBucketWire.array(),
  reviews: HourBucketWire.array(),
  next_reviews_at: "string.date.iso.parse | null",
}).pipe((wire) => ({
  lessons: wire.lessons,
  reviews: wire.reviews,
  nextReviewsAt: wire.next_reviews_at,
}));

export const userEndpoint = {
  kind: "resource",
  path: "user",
  object: "user",
  data: UserWire,
} satisfies Resource<User>;

export const summaryEndpoint = {
  kind: "resource",
  path: "summary",
  object: "report",
  data: SummaryWire,
} satisfies Resource<Summary>;
