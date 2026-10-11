# Men’s D1 lacrosse Reddit thread bot — starter

Working, dependency-free policy engine and fictional Markdown previews. This is not an installed Reddit app. It makes no Reddit calls. Live data ingestion, Reddit/Devvit handlers, and production storage still need implementation and validation.

## Agreed behavior

- NCAA men’s Division I only.
- Automatically open a game thread when BOTH teams appear at ranks 1–20 in the Inside Lacrosse KANE men’s DI media poll.
- Otherwise users request a game through a weekly index (`!thread GAME_ID`).
- Requested threads open 30 minutes before faceoff; requests during a live game open on the next pass. Early requests queue the game rather than publishing immediately.
- Postgame threads follow every game that has a published bot game thread. They do not depend on later rankings or require a second request.
- Final score must be unchanged across two distinct, fresh observations at least two minutes apart. A correction restarts confirmation.
- Canceled/postponed games do not open threads. Existing threads need an adapter update when a game is postponed.
- Poll older than ten days disables automatic selection; explicit requests still work. Thread ranks freeze when the game thread publishes.

## Run locally

Node 22 or newer. No dependency install needed.

```sh
npm test
npm run preview
```

Preview files use FICTIONAL games, rankings, records and results. They are not historical data. The sample Reddit links are placeholders.

## Ranking source and weekly index

Use the Inside Lacrosse KANE men’s DI media Top 20. Both teams must be ranked 1–20; receiving votes does not qualify. Keep publication dates and canonical team IDs in the poll snapshot. Do not substitute NCAA RPI or invent ranks 21–25.

Publish one weekly index on Saturday at 8:00 AM America/New_York (configurable hour), listing all games from that Saturday through the following Friday, inclusive. Keep the same post available for requests and update its thread links throughout the week. Do not create daily indexes or create a missed index on Sunday. A separate moderator action may explicitly recover a missed index.

`weeklyWindow` uses local calendar dates so daylight-saving changes cannot shift the range. `planWeeklyIndex` proposes creation only on Saturdays after the configured hour, unless that week's ID is already stored. Store the resulting Reddit ID under the Saturday date after successful publication. As with game posts, the integration must reconcile uncertain writes to avoid duplicates. `weeklyIndex` renders the current week's index on any day for edits.

## Normalized inputs

See `examples/preview.mjs`. Games require a stable provider game ID, `sport: lacrosse-men`, `division: d1`, canonical home/away team IDs, names, status, and provider snapshot timestamp `observedAt`. `startTime` must be ISO 8601 with timezone. Unknown times use null and need moderator confirmation. Optional venue, records, watch/stats/box-score links and overtime count may be absent. Scores are nonnegative integers; a final cannot be tied.

Use actual provider observation timestamps or cache metadata where available; do not give an unchanged cached payload a fresh timestamp and claim independent confirmation. Providers lacking freshness evidence need a stronger confirmation method.

Poll shape: `{source, publishedAt, ranks: {canonicalTeamId: integerRank}}`. Keep the provider adapter separate from policy. Team aliases belong in ingestion, never fuzzy-match them while publishing.

## Reddit integration plan: Devvit

Build a Devvit app rather than assuming a new standalone PRAW/script credential. Reddit’s September 30, 2026 migration announcement says new public API requests stop October 31, 2026. An authorized moderator must install the app in each destination community. Being a moderator of CollegeBasketball does not grant installation authority in lacrosse communities.

Suggested handlers:

1. A recurring job every five minutes reads the entire Saturday–Friday schedule plus yesterday’s tracked games, the selected poll, and per-game state from Devvit Redis. Yesterday’s games cover midnight/overtime and delayed final updates. Weekly index creation uses `planWeeklyIndex`, storing one post ID per Saturday. Refresh the same index all week, including added/rescheduled games.
2. Validate and normalize the source payload before calling `planGame`. Persist its updated observation/confirmation state even when there is no post action.
3. In preview mode, store/log proposed posts only. Never call `recordPost` for preview actions as though they were published.
4. For live writes, serialize each game using a durable reservation, reconcile already published posts using the hidden game marker, submit via Devvit’s Reddit client, then call `recordPost` with the returned post ID and persist state. `planGame` prevents duplicates after recorded success; it does NOT alone guarantee exactly-once publishing. Network timeout after submission is ambiguous: reconcile, rather than blindly retry. Do not delete a newer worker’s lock; include an ownership token.
5. Update the index with thread links, and edit the game thread body to link its postgame thread. Apply configured Game Thread and Post Game Thread flair IDs. These writes are adapter work, not implemented in the engine.
6. A comment-create handler accepts `parseRequest` ONLY inside an active bot weekly index in the installation’s subreddit, excludes bots/deleted users, looks up a known game ID, rate-limits each requester, and calls `requestGame`. Acknowledge the existing thread or queued request. Never treat arbitrary comments across Reddit as commands. Other users can request the same game without creating another thread.
7. Add moderator-only pause/resume, preview, manual request, poll update, and retry/reconciliation controls. Pause should stop scheduled publishing and requests without deleting stored tracking data.

Persist state by subreddit ID + provider + season + game ID. Index IDs are scoped by subreddit + week-start Saturday. Expire old data after the season; do not expire active locks/tracking prematurely. A production adapter must apply request quotas, title-length constraints and Markdown escaping to provider text. Validate all configuration ranges before use.

## Data validation before launch

Candidate: henrygd/ncaa-api, an unofficial open-source NCAA.com data wrapper supporting `lacrosse-men`. Its maintainer recommends self-hosting for long-term reliability. Endpoint/coverage has NOT been successfully validated for live lacrosse in this starter.

Test a representative regular-season Saturday, neutral-site game, overtime game, postponement and tournament day against school schedules/box scores. Verify all men’s D1 games are present, provider IDs remain stable, times include correct timezone, final flags arrive promptly, and rankings map to the same team IDs. Do not add unsupported broadcast/ranking fields or infer a final from elapsed time. Handle missing data by withholding posts and surfacing a moderator-visible diagnostic.

Devvit external fetch domains require approval. Keep the source behind an adapter so it can change without rewriting the posting policy. No paid feed or hosting provider is selected yet.

## Rollout

1. Agree with the destination moderators on IL Top-20 poll, request method, title/flair format and scheduling.
2. Implement and test ingestion and Devvit storage/handlers in a private test subreddit.
3. Replay recorded real data without posting; review generated Markdown and selection decisions.
4. Test live posting, duplicate reconciliation, requests and restart recovery in that test community.
5. Destination moderators install and enable the approved app. No lacrosse moderators have been contacted and no posts have been published by this project.

## References

- https://developers.reddit.com/docs/
- https://developers.reddit.com/docs/capabilities/server/scheduler
- https://developers.reddit.com/docs/capabilities/server/redis
- https://developers.reddit.com/docs/capabilities/http-fetch
- https://developers.reddit.com/docs/api/public-api/classes/RedditClient
- https://github.com/henrygd/ncaa-api
- https://beta.insidelacrosse.com/ncaa/m/1/2026/polls
- https://www.reddit.com/r/redditdev/comments/1wubcvf/moving_data_api_apps_to_the_developer_platform/
