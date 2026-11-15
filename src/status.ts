import type { HourBucket, Summary, User } from "./wanikani-endpoints.ts";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

export type ReviewForecast = {
  readonly at: Date;
  readonly count: number;
};

export type Status = {
  readonly username: string;
  readonly level: User["level"];
  readonly lessonsAvailable: number;
  readonly reviewsAvailable: number;
  readonly nextReviewsAt: Date | null;
  readonly upcomingReviews: readonly ReviewForecast[];
};

export type StatusText = {
  readonly summary: string;
  readonly json: string;
};

export function deriveStatus(user: User, summary: Summary, now: Date): Status {
  const nowMs = now.getTime();
  return {
    username: user.username,
    level: user.level,
    lessonsAvailable: countAvailable(summary.lessons, nowMs),
    reviewsAvailable: countAvailable(summary.reviews, nowMs),
    nextReviewsAt: summary.nextReviewsAt,
    upcomingReviews: upcoming(summary.reviews, nowMs),
  };
}

export function renderStatus(status: Status): StatusText {
  return {
    summary: summaryLines(status).join("\n"),
    json: JSON.stringify(status),
  };
}

function summaryLines(status: Status): readonly string[] {
  return [
    `${status.username} is level ${status.level}.`,
    `Lessons available now: ${status.lessonsAvailable}`,
    `Reviews available now: ${status.reviewsAvailable}`,
    `Next reviews: ${formatWhen(status.nextReviewsAt)}`,
    `Upcoming reviews (next 24h): ${formatUpcoming(status.upcomingReviews)}`,
  ];
}

function formatWhen(when: Date | null): string {
  if (when === null) return "none";
  return when.toISOString();
}

function formatUpcoming(rows: readonly ReviewForecast[]): string {
  if (rows.length === 0) return "none";
  return rows.map((row) => `${row.at.toISOString()} ${row.count}`).join(", ");
}

function countAvailable(buckets: readonly HourBucket[], nowMs: number): number {
  return sumCounts(buckets.filter((bucket) => isDue(bucket, nowMs)));
}

function upcoming(
  buckets: readonly HourBucket[],
  nowMs: number,
): readonly ReviewForecast[] {
  const until = nowMs + DAY_MS;
  return buckets
    .map((bucket) => ({
      at: bucket.at,
      count: forecastCount(bucket, nowMs, until),
    }))
    .filter((row) => row.count !== 0)
    .sort((left, right) => left.at.getTime() - right.at.getTime());
}

function sumCounts(buckets: readonly HourBucket[]): number {
  return buckets.reduce((total, bucket) => total + bucket.subjectCount, 0);
}

function isDue(bucket: HourBucket, nowMs: number): boolean {
  return bucket.at.getTime() <= nowMs;
}

function forecastCount(
  bucket: HourBucket,
  nowMs: number,
  until: number,
): number {
  const at = bucket.at.getTime();
  if (at + HOUR_MS <= nowMs) return 0;
  if (at > until) return 0;
  return bucket.subjectCount;
}
