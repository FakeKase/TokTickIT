# Lab 4: AI Use

## LLM used

**Claude Opus 5.5**, driven through **Claude Code** (the CLI agent) inside the repository, for
the whole sprint. The model is taken from the session log, where every response in Lab 4 names
it, not from memory. Working in the repository let the agent read the handout and the specs,
run the three test suites and a browser, query the GitHub API, and open pull requests.

Two roles, as the handout separates them:

- **Specification agent**: Issue #65 only, producing `specification.md`, `api-spec.md`,
  `ui-spec.md` and `tests.md`. That PR (#74) was reviewed and merged before any implementation
  PR was opened, and every later PR was written against it.
- **Coding agent**: Issues #66 to #73, one issue per feature branch, one pull request at a time
  into `lab4-staging`.

One sub-agent was used, once: the planning step at the start of the sprint ran as a separate
read-only planning agent that read the handout and the code and returned a plan. Everything
after that was the one agent.

**What the agent did beyond writing code.** As in Lab 3 it drafted the review comments I posted
on my partner's pull requests and the replies I posted to his reviews of mine. I read every
draft and posted it myself; it posted nothing under my name. It also kept the GitHub Project
board in step with the work.

## Selected key prompts

Eight prompts, quoted as typed, typos included. Most are short because the long instructions of
this sprint were the plan and the specification documents; what I typed was direction.

| # | Prompt | What it produced | Why this one |
| --- | --- | --- | --- |
| 1 | `/plan read SE lab 04.pdf in labsheet an use the planning agent to plan it out` | A plan of ten issues in order, made in plan mode so nothing was written until I approved it. The planning agent read the whole handout first and found that it contradicts itself: the Actions Taken field list has no assignee or status, while the Part 6 rubric asks to see actions assigned, completed and cancelled | The sprint ran from this plan. Finding the contradiction before any code was the most valuable thing the planning step did. |
| 2 | My three answers to the questions the plan raised: `Work log, 7 fields (Recommended)`, `Keep as admin-only status page`, `About 8 PRs` | The three decisions the contract is built on: Actions Taken as a work log with the handout's seven fields, the Lab 1 Check System page kept as System Status for Administrators, and fewer, larger PRs than Lab 3 | These were choices only I could make. The first is the riskiest decision of the lab, so it is written down in specification §11 with its reasoning, and the report points to it under Part 6. |
| 3 | `check pr I got request chnges` | On #74, three contract fixes in one commit and a reply to each point, including agreeing to the Part 6 note | The contract was reviewed against the code before anything was built on it. All three findings would have been bugs later. |
| 4 | `just the text no need to quote` | Review drafts as plain text I could paste, not in a quote block | Small, but it set how every later draft came back to me. |
| 5 | `review https://github.com/gxjakkap/soften-toktickit/pull/80` | A review of his Actions Taken UI that found the form could be closed during a save, the same bug he had found in mine | One of its points was wrong: it said pressing Enter could send a second request, and a browser does not submit a form whose submit button is disabled. He corrected it, and the approval said so. |
| 6 | `check their review` | On #80, his finding reproduced first, then fixed, with four tests that each failed without the fix | The same bug he had reported on my Lab 3 queue, now on My Tickets. It is why the next issue swept every screen instead of fixing one at a time. |
| 7 | `continue` (starting #72, hardening and evidence) | A regression sweep of every screen for every role, a visual check per checklist line, and the captures. They found seven problems, four of them older than Lab 4 | The handout asks for console errors, broken links and unfinished controls to be removed. Writing checks for that found things neither of us had seen in three labs of review. |
| 8 | `closed finished issue and update kanban` | Seven issues closed with a link to the PR that finished each | It found that no issue had closed by itself all sprint: GitHub closes an issue from a PR only when the PR merges into the default branch, and every PR here merged into `lab4-staging`. |

## What the AI got wrong

Included because an account of AI use that lists only successes is not an honest one. Each of
these reached a pull request, or would have.

- **The contract had three errors** (#74): its date rule refused the form's own default, its
  data model had no column for a field the API returned, and it specified the lock Lab 3 had
  already moved away from.
- **It stored a date that was never sent** (#76): 31 February was saved as 3 March.
- **It made a Lab 3 mistake again, twice.** On #77 the Action Taken dialog closed during a save,
  the user dialog bug of Lab 3 #57. On #80 a page past the end showed the wrong empty state,
  the queue bug of Lab 3 #55. Both had been fixed on one screen and the rule had not carried.
- **It introduced a deadlock** (#78). Locking the Ticket first in the owner route put it in the
  opposite order to deactivating a user. My partner raced the two 40 times and every run failed
  one side.
- **A review point of its own was wrong** (prompt 5).
- **Its own hardening checks found more of its own work.** Links had been Bootstrap's blue since
  Lab 2 against a spec that said green; an id past the range of the column answered 500 on
  every route since Lab 2; and the offset check it wrote in #76 still accepted `+14:30`.

What changed from Lab 3: none of these was a test that could not fail. The agent had been
breaking its own code on purpose before each PR since Lab 3, and that held. What it could not
do was remember a fix from one screen when building the next, and what found that was review
and, at the end, checks that cover every screen at once.

## My Reflection

<!--
  TODO: write 3 to 5 sentences in your own voice. The handout (Part 4) asks for "a brief
  My Reflection on specification-agent and coding-agent use". Things you might touch on:
    - the planning agent finding the Actions Taken contradiction, and choosing the work log
    - fewer, larger PRs this time (prompt 2): did it help with review round trips
    - the same bugs coming back (Esc during save, page past the end), and what you think
      that says about working with an agent
    - drafting reviews with the agent and posting them yourself, now a second lab of it
  Leave nothing here that you did not actually think. This section has to be yours.
-->
