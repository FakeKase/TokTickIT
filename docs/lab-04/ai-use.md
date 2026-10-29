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

Six prompts, in the order they were given. Five are mine: prompts 1, 4, 5 and 6 are quoted exactly
as I typed them, typos included, and prompt 2 is the three answers I chose when the plan asked me
to decide. Prompt 3 was written by the coding agent, not by me. It is included because it is what
the specification agent was actually told.

Most of my prompts are only a few words. The detailed instructions this sprint were the approved
plan and the specification documents, so what I typed was direction: start the next issue, check a
review, close the finished work. The "What it produced" column is where the substance is.

| # | Prompt | What it produced | Why this one |
| --- | --- | --- | --- |
| 1 | `/plan read SE lab 04.pdf in labsheet an use the planning agent to plan it out` | A plan of ten issues in order, made in plan mode so nothing was written until I approved it. The planning agent read the whole handout first and found that it contradicts itself: the Actions Taken field list has no assignee or status, while the Part 6 rubric asks to see actions assigned, completed and cancelled | The sprint ran from this plan, and finding the contradiction before any code was written was the most useful thing the planning step did. |
| 2 | My three answers to the questions the plan raised: `Work log, 7 fields (Recommended)`, `Keep as admin-only status page`, `About 8 PRs` | The three decisions the specification is built on: Actions Taken as a work log with the handout's seven fields, the Lab 1 Check System page kept as System Status for Administrators, and fewer, larger PRs than Lab 3 | These were choices only I could make. The first is the riskiest decision of the lab, so the specification explains it in §11 and the report points to it under Part 6. |
| 3 | *Written by the coding agent for the planning agent, about 1,200 words.* It opens: `Design an implementation plan for Lab 4 of TokTickIT ... You are read-only; return the plan as your final message. ... Read it in full first.` It goes on to summarise what Lab 4 asks, list the required files, and tell the planning agent to read the current code wherever it needs detail | The plan behind prompt 1, with the handout's contradictions listed first and a recommended reading for each | Part 4 asks about specification-agent use, and this is what the specification agent worked from: read the whole handout before anything else, change nothing, and look at the code that exists instead of assuming it. |
| 4 | `check pr` | My reviewer had found a deadlock on #78 that the agent introduced: changing a Ticket's owner and deactivating that same user locked the database in opposite orders, so one of them failed. The agent reproduced the failure with my reviewer's 40-run test before changing anything, fixed the lock order, and added the test to the suite | The most serious bug of the lab, and the agent's own. I could trust the fix because the failure was seen first and the same test then passed. |
| 5 | `continue` (starting #72, hardening and evidence) | A check that opens every screen as every role and watches for console errors, failed requests and dead links, plus a visual check for each line of the ui-spec checklist and all the screenshots. Together they found seven problems, four of them older than Lab 4 | The handout asks for console errors, broken links and unfinished controls to be removed. Writing checks for that found problems that three labs of review had not. |
| 6 | `closed finished issue and update kanban` | Seven finished issues closed, each with a comment linking the PR that completed it, and the board moved to match | It showed why no issue had closed by itself all sprint: GitHub only closes an issue from a PR merged into the default branch, and every PR here merged into `lab4-staging`. |

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
- **A review point of its own was wrong.** In its review of my partner's #80 it said pressing Enter
  could send a second request; a browser does not submit a form whose submit button is disabled.
- **Its own hardening checks found more of its own work.** Links had been Bootstrap's blue since
  Lab 2 against a spec that said green; an id past the range of the column answered 500 on
  every route since Lab 2; and the offset check it wrote in #76 still accepted `+14:30`.

What changed from Lab 3: none of these was a test that could not fail. The agent had been
breaking its own code on purpose before each PR since Lab 3, and that held. What it could not
do was remember a fix from one screen when building the next, and what found that was review
and, at the end, checks that cover every screen at once.

## My Reflection

In this lab I used the planning agent first to read the handout and plan the sprint, and it found that the Actions Taken fields in the handout did not match the Part 6 rubric before any code was written, so I could decide early to keep it as a work log. I asked for fewer but bigger PRs than Lab 3, and each PR needed only one round of changes at most, which made the review cycle with my partner faster. The thing I noticed most is that the coding agent repeated bugs that were already fixed in Lab 3, like closing a dialog while saving and a page past the end, because a fix on one screen did not carry to the next one. That is why in the hardening issue I had it write checks that cover every screen at once, and they found problems neither of us had seen before.
