# Peer Review: Lab 4

## My reviewer

The classmate who reviews my pull requests.

| Field | Value |
| :-: | :-: |
| Name | Jakkaphat Chalermphanaphan |
| Student ID | 67070501056 |
| GitHub username | [@gxjakkap](https://github.com/gxjakkap) |
| Repository reviewed | [FakeKase/TokTickIT](https://github.com/FakeKase/TokTickIT) |

Every Lab 4 pull request into `lab4-staging` was reviewed by @gxjakkap. Eight PRs, of which
**five came back with changes requested** once each before approval (#74, #76, #77, #78, #80)
and three were approved first time (#75, #79, #81).

The counts here come from the GitHub reviews API for each PR, not from reading the tables below.

### Pull requests they reviewed for me

"Rounds" is the number of times changes were requested, plus the approval.

| PR | Title | Rounds | Final |
| :-: | :-- | :-: | :-: |
| [#74](https://github.com/FakeKase/TokTickIT/pull/74) | Sprint 4 engineering contract | 2 | Approved |
| [#75](https://github.com/FakeKase/TokTickIT/pull/75) | Actions Taken schema, migration, rollback and seed | 1 | Approved |
| [#76](https://github.com/FakeKase/TokTickIT/pull/76) | Actions Taken API | 2 | Approved |
| [#77](https://github.com/FakeKase/TokTickIT/pull/77) | Actions Taken on Ticket Detail | 2 | Approved |
| [#78](https://github.com/FakeKase/TokTickIT/pull/78) | Ticket workflow, resolution gate and stale updates | 2 | Approved |
| [#79](https://github.com/FakeKase/TokTickIT/pull/79) | Dashboard API and drill-down filters | 1 | Approved |
| [#80](https://github.com/FakeKase/TokTickIT/pull/80) | Requester and IT Staff dashboards, navigation and landing | 2 | Approved |
| [#81](https://github.com/FakeKase/TokTickIT/pull/81) | Final hardening and visual evidence | 1 | Approved |

### Review comments I received, and how I responded

| PR | Their comment | My response |
| :-: | :-- | :-- |
| [#74](https://github.com/FakeKase/TokTickIT/pull/74) | *Changes requested,* three points. BR-05 rejected the form's own default: a `datetime-local` holds minutes, so a Ticket created at 10:00:30 refused the prefilled 10:00:00. The model had no column for `editedAt`, and `@updatedAt` cannot be null before the first edit. The contract locked the Ticket `FOR UPDATE`, which blocks the foreign-key checks of every comment and attachment insert, the lock we had already moved away from in Lab 3. Not blocking: the Part 6 rubric names an assignee and an action status, which my Actions Taken do not have. | All three were right and fixed in one commit. BR-05 compares to the minute in all four documents, with the 10:00:30 boundary in UNIT-01. `ActionTaken` gained `editedById` and `editedAt`, nullable and set together. The lock is `FOR NO KEY UPDATE`, with the reason in §11. On Part 6 I kept the decision and will point to specification §11 under Part 6 in the PDF, as he suggested. |
| [#75](https://github.com/FakeKase/TokTickIT/pull/75) | Approved. | No changes needed. |
| [#76](https://github.com/FakeKase/TokTickIT/pull/76) | *Changes requested:* `actionAt` accepted dates that do not exist and stored a different day. He called the validator directly: 31 February was stored as 3 March, and hour 24 as midnight the next day. | Fixed by checking each part against its own range, the day against the real length of its month, before building the date. His strings are in the unit test with fourteen more, and edge dates that are real are tested as accepted and stored as sent. Five of the new cases failed on the old code. |
| [#77](https://github.com/FakeKase/TokTickIT/pull/77) | *Changes requested:* `Esc` closed the Action Taken dialog while a save was in flight, so a failure had nowhere to appear and reopening minted a new request key. He pointed out it was the same bug fixed on the user dialog in Lab 3 #57, and supplied a test. | Fixed with the same guard as the user dialog. His test went in with more in it: the failure message, the text still there, and the same request key on retry. It fails without the guard. I also fixed his smaller point, an untouched date losing its seconds on edit. |
| [#78](https://github.com/FakeKase/TokTickIT/pull/78) | *Changes requested:* the owner route now locked the Ticket then the User, while deactivating a user locked the User then that user's Tickets, so the two deadlocked. He raced the two real routes 40 times: every run failed one side with a 500, and six times it was the Administrator's deactivation. | This one was mine, introduced by the PR. I reproduced it with his loop before changing anything. The user edit now locks the user's live Tickets before any User row, so both routes take Ticket then User. His loop is in the suite under API-28, and the lock order is written into api-spec §5. |
| [#79](https://github.com/FakeKase/TokTickIT/pull/79) | Approved. | No changes needed. |
| [#80](https://github.com/FakeKase/TokTickIT/pull/80) | *Changes requested:* with the page now in the URL, `/tickets?page=5` for a Requester with three Tickets showed "You haven't created any tickets yet" and hid the toolbar. A reload after Tickets left a filter reaches the same state. | The screen now moves to the last real page and corrects the URL, and decides the Empty and No-Results states on the total rather than on the page's rows. Four tests with a mock that answers the way the route does, each failing without the fix, and E2E-06 asks the real API for page 99. |
| [#81](https://github.com/FakeKase/TokTickIT/pull/81) | Approved. | No changes needed. |

**The pattern across these.** In Lab 3 the findings were mostly tests that could not fail. In
Lab 4 none were: every finding was a behaviour, and four of the five came from running
something, a validator called directly, a test written against my screen, a 40-run race. Two
were bugs I had already fixed once. The `Esc` guard on #77 is the user dialog of Lab 3 #57
again, and the page past the end on #80 is the queue of Lab 3 #55 again, on My Tickets. What
I took from that is that a fix applied to one screen is not a rule the codebase knows. In #81
I went the other way and wrote checks that sweep every screen and every route. They found seven
more problems, four of them older than Lab 4, and none had been noticed by either of us.

## Reviews I gave

Pull requests I reviewed for my partner.

| Field | Value |
| :-: | :-: |
| Author name | Jakkaphat Chalermphanaphan |
| Student ID | 67070501056 |
| GitHub username | [@gxjakkap](https://github.com/gxjakkap) |
| Repository | [gxjakkap/soften-toktickit](https://github.com/gxjakkap/soften-toktickit) |

Seven Lab 4 feature pull requests, of which **four came back with changes requested** before
approval (#72, #77, #80, #82) and three were approved first time (#76, #78, #79). Each review
was written against his own specification documents, not mine; our contracts differ in places.
His other Lab 4 PRs were CI and branch-sync housekeeping and were not reviewed.

The comments I posted were drafted with the coding agent and posted by me after reading them;
`ai-use.md` says how that worked.

| PR | Title | My comment | How they responded |
| :-: | :-- | :-- | :-- |
| [#72](https://github.com/gxjakkap/soften-toktickit/pull/72) | Sprint 4 engineering contract | *Changes requested,* three points. The "not before the Ticket's creation" rule was only in the API spec, and it rejected the form's own default, the same problem he had found in mine. The `resolvedAt` backfill cast a `timestamp` through the session time zone, so on a database set to Asia/Bangkok every value would land seven hours early. And the idempotent replay had no place in the order of checks, so a retry after a colleague resolved the Ticket would get a 409 for work that was saved. Three smaller notes on seed history, a hard-coded date and an inactive assignee. | Fixed all six. The backfill uses `AT TIME ZONE 'UTC'` and MIG-02 now runs under a non-UTC session. The replay is step 4, before every state rule, with my case in API-14. I approved, with one nit about seeded history showing moves the matrix does not allow. |
| [#76](https://github.com/gxjakkap/soften-toktickit/pull/76) | DB migration: Actions Taken and seed | Approved. I checked the backfill test would catch a seven-hour shift and walked the seeded times in order. Two notes: a stray comment, and a warning that both new tables restrict deletion of a Ticket, which would break his test cleanup once history rows were written. | Merged as approved. |
| [#77](https://github.com/gxjakkap/soften-toktickit/pull/77) | Actions Taken API | *Changes requested:* `actionAt` accepted 31 February and hour 24 and stored a different day. It was the same bug he had found in my #76 the day before, so I ran his exact check and gave him the outputs. | Fixed: each part is checked before the date is built, my four strings are in API-07 and a unit test, and he tightened the fraction while there. Approved. |
| [#78](https://github.com/gxjakkap/soften-toktickit/pull/78) | Ticket workflow and resolution gate | Approved, with three notes. The PR had rewritten fifteen Lab 3 screenshots and one was now cut off mid-card. Setting the owner or priority to the value it already had still bumped the version. And a status select that saves on change lets arrow keys fire a transition, including Cancelled. | Merged as approved. |
| [#79](https://github.com/gxjakkap/soften-toktickit/pull/79) | Dashboard APIs | Approved. I checked that the Requester route cannot be widened by any parameter, and that each count and its drill-down share one predicate. Three notes: a performance test timed one call where the others took a median, a preview cut that could split a surrogate pair, and counts read in parallel rather than in one snapshot. | Merged as approved. |
| [#80](https://github.com/gxjakkap/soften-toktickit/pull/80) | Actions Taken UI | *Changes requested:* the form could be closed with Cancel or `Esc` while a save was in flight, losing the text and the request id. The same finding he had made on my #77. Not blocking: crossing 768px remounted an open edit form and lost the typing. | Fixed both: the form cannot close while saving, and the edit form now renders once through a portal that moves between the row and the card. He corrected one part of my note: a browser does not submit a form on Enter when its submit button is disabled, so the second request I described could not happen. He was right, and I said so when approving. |
| [#82](https://github.com/gxjakkap/soften-toktickit/pull/82) | IT Staff Dashboard UI | *Changes requested,* checked by running his screens with a scratch test. A page past the end showed a blank Queue with no table, no empty state and no way back. The search box did not follow the URL, so the nav link could not clear a search: it came back 300 ms later. An unknown filter value showed as "undefined" in its chip. Two asks on his retry backoff commit. | Fixed all of them, with a test for each, and found one I had missed: a bad date in the URL threw from the date formatter and blanked the Queue. Approved. |

**How these reviews were done.** From the first PR of this lab I ran his code rather than only
reading it, which is what I wrote at the end of Lab 3 that I should have been doing. On #77 that
meant calling his validator with the dates that had broken mine; on #82, a throwaway test
against his screens, removed afterwards. Two of my findings were bugs he had found in my PRs a
day or two before, which made them quick to check and quick to explain. One part of one finding
was wrong, the Enter key on #80, and his reply showed why.
