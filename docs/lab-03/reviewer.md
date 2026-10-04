# Peer Review: Lab 3

## My reviewer

The classmate who reviews my pull requests.

| Field | Value |
| :-: | :-: |
| Name | Jakkaphat Chalermphanaphan |
| Student ID | 67070501056 |
| GitHub username | [@gxjakkap](https://github.com/gxjakkap) |
| Repository reviewed | [FakeKase/TokTickIT](https://github.com/FakeKase/TokTickIT) |

Every Lab 3 pull request was reviewed by @gxjakkap. Eleven PRs, of which **eight came back
with changes requested** before approval and three were approved first time (#56, #58,
#59). The eight took thirteen rounds of requested changes between them.

Counts in this document were produced by querying the GitHub reviews API for each PR, not
by reading the tables below and estimating.

### Pull requests they reviewed for me

"Rounds" is the number of times changes were requested, plus the approval.

| PR | Title | Rounds | Final |
| :-: | :-- | :-: | :-: |
| [#49](https://github.com/FakeKase/TokTickIT/pull/49) | Sprint 3 engineering contract (spec, UI spec, API spec, test plan) | 2 | Approved |
| [#50](https://github.com/FakeKase/TokTickIT/pull/50) | User model, session store, migration, and seed | 3 | Approved |
| [#51](https://github.com/FakeKase/TokTickIT/pull/51) | Authentication API and authorization middleware | 3 | Approved |
| [#52](https://github.com/FakeKase/TokTickIT/pull/52) | Login, mandatory password change, and authenticated app shell | 2 | Approved |
| [#53](https://github.com/FakeKase/TokTickIT/pull/53) | Requester regression on the authenticated identity | 3 | Approved |
| [#54](https://github.com/FakeKase/TokTickIT/pull/54) | Public Comments and Problem Appears Resolved | 4 | Approved |
| [#55](https://github.com/FakeKase/TokTickIT/pull/55) | IT Staff Ticket Queue | 2 | Approved |
| [#56](https://github.com/FakeKase/TokTickIT/pull/56) | IT Staff Ticket Detail | 1 | Approved |
| [#57](https://github.com/FakeKase/TokTickIT/pull/57) | Administrator user management | 2 | Approved |
| [#58](https://github.com/FakeKase/TokTickIT/pull/58) | End-to-end suite and submission evidence | 1 | Approved |
| [#59](https://github.com/FakeKase/TokTickIT/pull/59) | Responsive and visual QA | 1 | Approved |

### Review comments I received, and how I responded

| PR | Their comment | My response |
| :-: | :-- | :-- |
| [#49](https://github.com/FakeKase/TokTickIT/pull/49) | *Changes requested:* `api-spec.md` said every attachment endpoint was Requester-only, while the authorization matrix gave IT Staff and Administrators "Read any". Nothing in the API actually served an attachment to staff. | The two documents described different systems. Resolved in favour of the matrix, since the IT Staff Ticket Detail screen has to show the Requester's attachments. Split the seven endpoints in `api-spec.md` §5 into five Requester-only and two that also serve staff reads, and split the matrix row the same way. |
| [#50](https://github.com/FakeKase/TokTickIT/pull/50) | *Changes requested, twice.* A migrated database and a fresh one disagreed on `mustChangePassword` for the same accounts. The migration check's assertions were weak: it counted a constraint by name, so a dropped and re-added foreign key still passed; it checked a hash's prefix rather than comparing it; and its container guard never fired. He also recommended storing a hash of the session token rather than the token. Second round: two documents still called the token the primary key. | Reproduced the divergence on my own machine before fixing it. The seed is now authoritative for the flag and never rewrites a password. The check compares the constraint's oid, runs `bcrypt.compareSync` on every migrated row, and applies the file in one transaction as Prisma does. `Session` now stores sha256 of the token. Recorded the migration's known password hash as a deliberate decision with its cost stated. |
| [#51](https://github.com/FakeKase/TokTickIT/pull/51) | *Changes requested, twice.* A database failure inside `requireAuth` returned Express's HTML error page with a stack trace and file paths. Nothing tested that a password change ends the user's other sessions. The 72-character password limit should be 72 bytes. Second round: my new error handler turned a malformed JSON body into a 500, and the bytes change had not reached five other documents. | Reproduced the leak, then added a JSON error handler. He was right that I had regressed it: `{bad` now answers 400, an oversized body 413, and a response already streaming is handed back to Express. Added the two-session test. The bytes point was the best catch of the review: `"ก".repeat(72)` has length 72 and is 216 bytes, so it passed a limit that exists to stop exactly that. |
| [#52](https://github.com/FakeKase/TokTickIT/pull/52) | *Changes requested:* dead selector code left in `api.ts`; an expired session on Change Password showed "That is not your current password" under a password typed correctly; and the remembered destination was followed for any role, so a second person signing in on the same machine could land on the first person's Ticket. | Fixed all of them. Writing the test for the last one found a real bug behind it: signing in re-rendered the Login page with a user, and its "already signed in" redirect overrode the destination the submit handler had chosen, so the resume path had never worked. One shared function decides the destination now. |
| [#53](https://github.com/FakeKase/TokTickIT/pull/53) | *Changes requested, twice.* The test for the rule the whole PR existed for could not fail: it compared two lists that were both empty. Another listed two of the seven routes it claimed to cover. The migration regression test ran its download check inside an `if` that was false on any seeded database. And a new test passed with the code it tested removed. | All correct. Gave both Requesters real data, then proved the first test could fail by putting the bug back and watching it go red. The download check now uploads its own attachment. I confirmed his claim about the vacuous test before deleting it, and pointed the coverage at the test that does catch it. |
| [#54](https://github.com/FakeKase/TokTickIT/pull/54) | *Changes requested, three times.* The "appears resolved" signal could be sent twice, overwriting the first timestamp and posting a duplicate comment. Second round: my fix had moved the update out of its transaction and reopened the gap. Third round: the client treated a 409 as a temporary failure and offered a Retry that could only fail again. | The second round was my own mistake and he supplied the correct form: one transaction, with both conditions in the `WHERE`. For the third, a 409 now reloads the Ticket rather than offering a Retry. He also found the PR body and `tests.md` disagreed on the test count; the run behind the PR body had 3 failures, which I had reported as a pass. |
| [#55](https://github.com/FakeKase/TokTickIT/pull/55) | *Changes requested:* search text typed but not submitted stayed in the box while a filter change ran without it; choosing a sort key from the select kept the previous key's direction; and the URL kept a page number the server had clamped. | Wrote a failing test for each, then fixed them. Unsubmitted search text now goes along with every change. For the URL I dropped the clamped response and let the corrected address fetch again, which he noted was cleaner than what he had suggested. |
| [#56](https://github.com/FakeKase/TokTickIT/pull/56) | Approved, with four follow-ups. The main one: lock the target user's row with `SELECT ... FOR SHARE` instead of running the owner check at `SERIALIZABLE`, so deactivation would not have to remember to use the same isolation level. | He was right, and it removed code. Adopted in the next PR, and `lib/serializable.ts` was deleted. Unassign is now disabled with a reason on a Resolved or Closed Ticket rather than offered and refused. |
| [#57](https://github.com/FakeKase/TokTickIT/pull/57) | *Changes requested:* the user edit locked rows `FOR UPDATE`, which blocks the foreign-key check Postgres runs on any insert referencing that row; an Administrator editing their own account left the header and navigation stale; and `Esc` closed the dialog during a save, so a failure had nowhere to appear. | Confirmed the first before changing it: with the edit's transaction held open, a comment by a locked Administrator written from a second connection was blocked. It is `FOR NO KEY UPDATE` now, with that as a test. The session is re-read after a self-edit, and `Esc` is ignored until the request settles. |
| [#58](https://github.com/FakeKase/TokTickIT/pull/58) | Approved. | No changes needed. |
| [#59](https://github.com/FakeKase/TokTickIT/pull/59) | Approved, after recomputing the four contrast ratios from the hex values. One nit: a helper returned early when an element was missing, so the check could pass without testing anything. | The helper now asserts both elements are visible before comparing them. Fixed in the following PR. |

**The pattern across these.** In Lab 2 two thirds of the findings were tests that could
not fail for the reason they claimed. That happened again here, on #53, three times in one
PR, so it was not a lesson I had finished learning. From #55 onward I changed how I
checked my own work: after the tests passed, I broke the code on purpose, one behaviour at
a time, and reran them. A change that left every test green was a test that was not
testing it. That found weak assertions in every PR it was applied to, before review rather
than during it, and the PRs from #56 on needed one round of changes between them.

The other thing his reviews kept doing was run the code. The vacuous tests, the stack
trace, the blocked insert and the test count were all found by executing something, not by
reading the diff.

## Reviews I gave

Pull requests I reviewed for my partner.

| Field | Value |
| :-: | :-: |
| Author name | Jakkaphat Chalermphanaphan |
| Student ID | 67070501056 |
| GitHub username | [@gxjakkap](https://github.com/gxjakkap) |
| Repository | [gxjakkap/soften-toktickit](https://github.com/gxjakkap/soften-toktickit) |

Ten pull requests, of which **six came back with changes requested** before approval
(#46, #48, #49, #50, #52, #55) and four were approved first time (#47, #51, #53, #54).
Each review was written against his own specification documents, not mine. Our specs
differ in places, and a finding is only worth raising if it contradicts the contract he
wrote.

The review comments I posted were drafted with the coding agent and posted by me after
reading them; `ai-use.md` says how that worked.

| PR | Title | My comment | How they responded |
| :-: | :-- | :-- | :-- |
| [#46](https://github.com/gxjakkap/soften-toktickit/pull/46) | Sprint 3 engineering contract | *Changes requested,* three points. No endpoint could return an Internal Note to an Administrator, although BR-04 and AC-12 said they could read one. BR-19 said claiming someone else's Ticket is rejected, while the API section had one endpoint that allowed it. And the migration appended `REOPENED` after `CANCELLED`, the opposite of the declared enum order, which Postgres sorts by. | Fixed all three. He split Claim and Reassign into two endpoints, which was a better answer than the 409 I had suggested. |
| [#47](https://github.com/gxjakkap/soften-toktickit/pull/47) | DB migration: users and auth model | Approved. He had noted he could only test on Postgres 14, so I ran his migration on 17 against a Lab 2 database with data in it and reported the result: no row lost, enum order as specified, `ADD VALUE` legal inside the transaction. Raised one point to settle about a `CHECK` on lower-cased email. | No changes needed. |
| [#48](https://github.com/gxjakkap/soften-toktickit/pull/48) | Auth API | *Changes requested:* the mandatory password change could be satisfied by typing the same password again, since nothing required the new one to differ. Also noted the session cookie was set inside the transaction, so a failed commit would still send a cookie for a row that was rolled back. | Fixed both, with a test that fails the commit and checks no cookie goes out. |
| [#49](https://github.com/gxjakkap/soften-toktickit/pull/49) | Authorization middleware | *Changes requested:* the error handler turned a malformed JSON body into a 500. This was the same bug he had blocked my #51 on, one layer further out, so I could give him the reproduction. Also no `headersSent` check. | Fixed both, and extracted the handler into a unit-testable function, which was better than what I suggested. |
| [#50](https://github.com/gxjakkap/soften-toktickit/pull/50) | Requester regression and public comments | *Changes requested:* posting a comment with no body returned 500. Express 5 no longer defaults `req.body` to `{}`, which I verified on express 5.2.1 before raising it. Also the Lab 3 run was overwriting the Lab 2 evidence screenshots. | Fixed both, audited the rest of the file for the same shape, and found it in `POST /api/tickets` as well. |
| [#51](https://github.com/gxjakkap/soften-toktickit/pull/51) | IT Staff ticket queue | Approved, with one finding he had understated: making the navigation role-scoped left an Administrator with no reachable screen at all after signing in. | Addressed in the following PR. |
| [#52](https://github.com/gxjakkap/soften-toktickit/pull/52) | IT Staff ticket detail | *Changes requested:* Claim ran in a serializable transaction and Reassign did not, so a Reassign landing between Claim's read and write could not be noticed and would be silently overwritten. | Wrapped Reassign in the same transaction, with the read moved inside it. |
| [#53](https://github.com/gxjakkap/soften-toktickit/pull/53) | Admin User Management | Approved. Listed what I had checked in the safety rules, since "looks good" is not worth much on a PR like this, and raised one question: an Administrator resetting their own password is signed out by it. | No changes needed. |
| [#54](https://github.com/gxjakkap/soften-toktickit/pull/54) | Auth UI Shell | Approved, with three notes. His spec asked for a disabled control with a tooltip, and a disabled button shows no tooltip and cannot be reached by keyboard, so the fix belonged in the spec. There was no way to sign out of the Change Password screen. | Merged as approved. |
| [#55](https://github.com/gxjakkap/soften-toktickit/pull/55) | Test Coverage | *Changes requested, twice.* I ran the branch and changed his guards to see what his authorization matrix would catch. It asserted only the refusals: restricting two endpoints to the wrong role left all 334 server tests passing. The committed User Management screenshot contained seven users created by his own tests. Second round: one fixture user remained, and another screenshot showed 325 Tickets. | Fixed the matrix so each allowed role is asserted too, and added cleanup before, after and within the run. I approved the third version and reported a bug in the new cleanup script, which deleted attachments by comparing their ids to Ticket ids. |

**How these reviews were done.** Until #54 I read his diffs and his specification. That
found contract contradictions and races, which are visible on the page. It did not find
what his reviews of my work kept finding, because those came from running the code. On
#55 I checked out his branch, built a throwaway database, ran his suites, and changed his
guards one at a time to see whether his tests noticed. That is where both findings on
that PR came from, and it is how I should have been reviewing from the start.

One finding changed character when I checked further. On #54 a tooltip that could not
work looked like grounds to request changes, until I read his UI spec and found the
implementation did exactly what it asked. The fault was in the spec, so I approved with a
note rather than block a PR that met its contract.
