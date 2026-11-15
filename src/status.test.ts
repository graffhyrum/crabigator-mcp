import { expect, test } from "bun:test";
import { type } from "arktype";
import { summaryEndpoint, userEndpoint } from "./wanikani-endpoints.ts";
import { deriveStatus, renderStatus } from "./status.ts";

const NOW = Date.parse("2018-04-11T21:30:00.000Z");
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

test("deriveStatus counts what is available now and lists the next 24 hours", () => {
  const now = new Date(NOW);
  const status = deriveStatus(
    user("example_user", 5),
    summary({
      lessons: [bucket(NOW - 30 * 60 * 1000, [25, 26])],
      reviews: [
        bucket(NOW + 2 * HOUR, [4]),
        bucket(NOW, [21, 23, 24]),
        bucket(NOW + HOUR, []),
        bucket(NOW - 90 * 60 * 1000, [9]),
        bucket(NOW - 30 * 60 * 1000, [11]),
        bucket(NOW - HOUR, [6]),
        bucket(NOW + DAY, [7]),
        bucket(NOW + DAY + 1, [8]),
      ],
      nextReviewsAt: "2018-04-11T22:00:00.000Z",
    }),
    now,
  );
  expect(status.username).toBe("example_user");
  expect(`${status.level}`).toBe("5");
  expect(Object.is(status.lessonsAvailable, 2)).toBe(true);
  expect(status.reviewsAvailable).toBe(6);
  expect(status.nextReviewsAt?.toISOString()).toBe("2018-04-11T22:00:00.000Z");
  expect(
    status.upcomingReviews.map((row) => [row.at.toISOString(), row.count]),
  ).toEqual([
    ["2018-04-11T21:00:00.000Z", 1],
    ["2018-04-11T21:30:00.000Z", 3],
    ["2018-04-11T23:30:00.000Z", 1],
    ["2018-04-12T21:30:00.000Z", 1],
  ]);
});

test("an empty summary reports zero and no next review", () => {
  const status = deriveStatus(
    user("example_user", 1),
    summary({ lessons: [], reviews: [], nextReviewsAt: null }),
    new Date(NOW),
  );
  expect(Object.is(status.lessonsAvailable, 0)).toBe(true);
  expect(Object.is(status.reviewsAvailable, 0)).toBe(true);
  expect(status.nextReviewsAt).toBeNull();
  expect(status.upcomingReviews).toEqual([]);
  const text = renderStatus(status);
  expect(text.summary).toBe(
    [
      "example_user is level 1.",
      "Lessons available now: 0",
      "Reviews available now: 0",
      "Next reviews: none",
      "Upcoming reviews (next 24h): none",
    ].join("\n"),
  );
  expect(JSON.parse(text.json)).toMatchObject({
    username: "example_user",
    level: 1,
    nextReviewsAt: null,
    upcomingReviews: [],
  });
});

test("renderStatus prints counts and omits subject ids", () => {
  const status = deriveStatus(
    user("example_user", 5),
    summary({
      lessons: [bucket(NOW, [25, 26])],
      reviews: [bucket(NOW, [21, 23, 24]), bucket(NOW + HOUR, [4])],
      nextReviewsAt: "2018-04-11T22:30:00.000Z",
    }),
    new Date(NOW),
  );
  const text = renderStatus(status);
  expect(text.summary).toBe(
    [
      "example_user is level 5.",
      "Lessons available now: 2",
      "Reviews available now: 3",
      "Next reviews: 2018-04-11T22:30:00.000Z",
      "Upcoming reviews (next 24h): 2018-04-11T21:30:00.000Z 3, 2018-04-11T22:30:00.000Z 1",
    ].join("\n"),
  );
  expect(text.summary.includes("25")).toBe(false);
  expect(text.json.includes('"count":3')).toBe(true);
});

test("a review that becomes available one millisecond from now is not available yet", () => {
  const status = deriveStatus(
    user("example_user", 5),
    summary({
      lessons: [],
      reviews: [bucket(NOW + 1, [1])],
      nextReviewsAt: null,
    }),
    new Date(NOW),
  );
  expect(Object.is(status.reviewsAvailable, 0)).toBe(true);
  expect(status.upcomingReviews).toHaveLength(1);
});

function user(username: string, level: number) {
  const parsed = userEndpoint.data({ username, level });
  if (parsed instanceof type.errors) throw new Error(parsed.summary);
  return parsed;
}

function summary(input: {
  readonly lessons: readonly ReturnType<typeof bucket>[];
  readonly reviews: readonly ReturnType<typeof bucket>[];
  readonly nextReviewsAt: string | null;
}) {
  const parsed = summaryEndpoint.data({
    lessons: input.lessons,
    reviews: input.reviews,
    next_reviews_at: input.nextReviewsAt,
  });
  if (parsed instanceof type.errors) throw new Error(parsed.summary);
  return parsed;
}

function bucket(at: number, subjectIds: readonly number[]) {
  return {
    available_at: new Date(at).toISOString(),
    subject_ids: [...subjectIds],
  };
}
