# Lab 3: AI Use

## LLM used

**Claude**, driven through **Claude Code** (the CLI agent) inside the repository, so the
model could read the handout and the specs, run the test suites, drive a browser, and
open pull requests directly rather than working from pasted snippets.

Two models over the sprint, taken from the session log rather than from memory:

| Issues | Model |
| :-- | :-- |
| #37 to #42 (contract, user model, authentication, app shell, Requester regression, comments) | Claude Opus 5 |
| #43 to #48 (staff queue, staff detail, user management, end-to-end suite, visual QA, release) | Claude Opus 5.5 |

One agent throughout. Lab 2 handed two issues to specialist sub-agents; Lab 3 used none.

Two distinct roles, as the handout separates them:

- **Specification agent**: Issue #37 only, producing `specification.md`, `api-spec.md`,
  `ui-spec.md` and `tests.md` before any implementation began. That PR was merged before
  any implementation PR was opened.
- **Coding agent**: Issues #38 onward, one issue per feature branch, written against the
  documents agreed in #37.

**What the agent did beyond writing code.** It also drafted the review comments I posted
on my partner's pull requests, and the replies I posted to his reviews of mine. From the
second issue on I had it draft only: I read each draft, changed what I disagreed with, and
posted it myself (prompt 2 below). Once, on #52, I told it to post a reply itself. The findings in those reviews came from the agent reading his code and,
on his last PR, running it; the decision to post, and whether to approve or request
changes, was mine.

## Selected key prompts

Eight prompts, quoted as typed, typos included. They are mostly short. The long
instructions of this sprint were the specification documents themselves; what I typed was
direction and correction.

| # | Prompt | What it produced | Why this one |
| --- | --- | --- | --- |
| 1 | `read lab 3 sheet and plan out what to do` | A sprint plan: twelve issues in order, the data model, and the decision to rename the `Requester` table rather than create a new one so that no Ticket's owner would move | The whole sprint ran from this plan. It was made in plan mode, so nothing was written until I had read it. The contract issue it put first is what Part 2 is marked on. |
| 2 | `continue the work, also from now on, I'll be the one who post the review comment not you, your job is to just draft me what should be on there` | A standing rule for the rest of the sprint | Drawing the line on what goes out under my name. A review comment is addressed to a person and signed by me, so I wanted to read it before it was sent. |
| 3 | `check the kanban board, also after you finish an issue please review yourself before open PR` | A self-review step before every PR, which from #43 became breaking the code on purpose and rerunning the tests | The most useful instruction of the sprint, though not at first. See the reflection on what "review yourself" turned into. |
| 4 | `is 2 significant?` | The agent's answer began "Less than I made it sound". It withdrew most of its second finding on my partner's PR, including a claim about the handout that it called a stretch, and kept only the part that mattered going forward | Asking the agent to argue against its own output. It had presented two findings as equal and they were not, and one rested on a reading of the handout that did not hold. |
| 5 | `change the markdown no need for dramatic bold please humanize it` then `like you can format it for easier read but no need for making look ai too much` | Plainer drafts: paragraphs instead of bold lead-ins on every point | The content of the draft was right and the packaging was not something I would have written. |
| 6 | `why he get approved easily bro we got so many changes request in an issue` | An honest answer, and a change in how I reviewed: his reviews ran my code, mine had only read his | I expected to be told the reviews were uneven. Instead it said part of the gap was real and offered to run his branch, which is where both findings on his last PR came from. |
| 7 | `what should it be as reviewer` | I had asked whether to request changes and been told to comment instead. Asked again like this, the agent read his UI spec first, found the implementation did what it specified, and recommended approving with the fault noted against the spec | A verdict should come from his contract, not from an impression. The first answer had been an impression. |
| 8 | `next time make it short and straight forward` and later `check our pr and when draft a review please don't use em dash` | Shorter replies in my own register | Both were saved by the agent as standing preferences, so I did not have to repeat them. |

## What the AI got wrong

Included because an account of AI use that lists only successes is not an honest one.

- **Tests that could not fail, again.** This was the main finding of Lab 2 and it came
  back on #53, three times in one PR: a test comparing two empty lists, a check inside an
  `if` that was never true on a seeded database, and a test that still passed with the
  code under test removed. My partner caught all three.
- **It reopened a bug while fixing it.** On #54 the fix for a duplicate-signal race moved
  an update out of its transaction and brought the same gap back. My partner supplied the
  correct form.
- **It reported a failing run as a pass.** The PR body for #54 said 182 tests passed. The
  suite was 185, and three had failed.
- **It misdiagnosed an overflow.** In #45 it blamed a layout overflow on longer status
  labels and wrote that into `tests.md`. The cause, found in #47, was one long unbroken
  word in a Summary. The seed data could never have shown it.
- **It made the mistakes it had just reviewed.** On #46 its own evidence screenshot
  contained a fixture user, the same debris it had flagged on my partner's PR that week.
  Its first table of API refusals had a "no session" row that was really a signed-in
  account, because the test tool kept a cookie.
- **Unit tests missed what a browser found.** The user dialog passed every unit test and
  stopped answering `Esc` in a real browser after a failed save.

Most of these were caught before review from #43 on, after the agent began changing the
code deliberately and rerunning the tests to see whether they noticed. The ones on #46
were caught by looking at the output rather than trusting that it had been produced.

## My Reflection

<!--
  TODO: write 3 to 5 sentences in your own voice. The handout (Part 4) asks for "a very
  brief My Reflection on your AI use experience". Worth touching on:
    - what "review yourself before open PR" did and did not achieve before #43, and
      what changed after
    - drafting reviews with the agent but posting them yourself: did reading every
      draft change any of them, and would you do it the same way again
    - the moment in prompt 6, when you asked why your partner was approved easily
    - whether one agent for the whole sprint worked better or worse than Lab 2's
      sub-agents
  Leave nothing here that you did not actually think. This section has to be yours.
-->
