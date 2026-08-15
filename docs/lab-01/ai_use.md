# AI Use and Reflection — Lab 1

## Tooling

| | |
| --- | --- |
| Agent | Claude Code (CLI) |
| Model | Claude Sonnet 5 |
| Effort level | Medium |
| Capabilities used | Shell execution, file read/write, `gh` CLI |

Because the agent could run commands rather than only emit code, it scaffolded both
workspaces, executed the test suites, and verified PostgreSQL connectivity itself. Every
claim in the Issue 1 pull request is backed by terminal output the agent produced and I
reviewed.

## Method

I worked in two stages rather than prompting per file.

**Stage 1 — specification.** One long prompt asked the agent to read the lab sheet and produce
a plan with no code: the four-issue dependency order, required outputs, and required tests.
It also audited my machine and reported that PostgreSQL, Docker, and `gh` were all missing.

**Stage 2 — execution.** Because the plan was agreed and named its phases, later prompts could
be short and still land correctly. Prompts such as `เอาเลย Phase 0` are two words because the
plan they refer to was already reviewed and approved by me — the shared context carries the
detail that a one-shot prompt would otherwise have to spell out.

The prompts below are reproduced exactly as typed, in the mix of Thai and English I actually
used. The full unedited record of all thirteen prompts is in [`prompt-log.md`](prompt-log.md).

## Selected key prompts

| # | Prompt Name | Actual Prompt Text | What it produced |
| --- | --- | --- | --- |
| 1 | Specify Lab 1 from the source document | `อ่าน labSheet แล้วช่วยเช็คหน่อยว่าต้องทำอะไรบ้าง วางแผนมาให้หน่อย`<br><br>*"Read the labSheet, check what needs to be done, and plan it out for me."* | Four-issue dependency graph, phase plan, and an environment audit that found three missing prerequisites before any code was written. |
| 2 | Define version-control hygiene | `add .agents and .claude and other if necessary to gitignore` | Root `.gitignore`. The open-ended clause produced OS and editor entries I had not considered; the agent declined to guess build-artifact entries for a stack that did not exist yet. |
| 3 | Execute the environment and workflow setup | `เอาเลย Phase 0`<br><br>*"Go ahead with Phase 0."* | PostgreSQL 17 installed, `toktickit_dev` created, GitHub CLI installed, `lab1-staging` pushed, Project board created with the six required statuses, four Issues filed in Backlog. |
| 4 | Register the peer reviewer and correct the repository name | `เปลี่ยนชื่อ แล้วก็คู่คือ Jakkaphat Chalermphanaphan ID: 67070501056`<br><br>*"Rename it. My partner is Jakkaphat Chalermphanaphan, ID 67070501056."* | Repository renamed `TocktikIT` → `TokTickIT`, remote URL updated, `reviewer.md` scaffolded. The agent flagged that the GitHub username was still missing rather than inventing one. |
| 5 | Build the project foundation with a full prompt audit trail | `ทำเลย username: gxjakkap ฝากจดหน่อยทุกพรอมท์เลย ถ้ามี subagent ฝากเก็บพรอมท์ที่ตัว manager สั่งด้วย`<br><br>*"Go ahead. Username: gxjakkap. Record every prompt. If subagents are used, capture the prompts the manager gives them too."* | Issue 1 implemented end to end: both workspaces, Prisma, tests, README, and PR #5. `prompt-log.md` was written during the work rather than reconstructed afterwards. |
| 6 | Challenge scope before accepting work | `คือตอนนี้มันยังไม่จำเป็นต้องทำใช่มั้ย มีจุดไหนที่ได้แก้ UI อยู่แล้วมั้ย`<br><br>*"It isn't necessary yet, right? Is there a point where the UI gets changed anyway?"* | Cancelled a UI task I had asked for one message earlier, after confirming Issues 2 and 4 already require rewriting the same components. |
| 7 | Benchmark against a peer implementation | `ช่วยเช็คอันนี้หน่อย ทำให้เป็นแบบคล้าย ๆ กันแต่ไม่ต้องเหมือนมาก`<br><br>*"Check this repo and make mine similar, but it doesn't have to match closely."* | Reviewed @gxjakkap's branch. Adopted his `docker-compose.yaml` and `client/.env.example`; deliberately kept my own `tests/lab-01/` layout and `tests.md`, with reasons recorded. |
| 8 | Enforce sole authorship on commits | `คือมีแค่ไม่อยากให้ขึ้น claude เฉย ๆ`<br><br>*"I just don't want claude showing up, that's all."* | Removed the `Co-Authored-By: Claude` trailer and rewrote the commit so the individual sprint shows a single author. AI use is disclosed here instead. |

## Reflection

**What worked.**

**What I had to correct.**

**What I would do differently.**

**On responsibility.**

---

## Working notes (delete before submission)

Raw material for the reflection sections above. Facts from the session, not conclusions.

- Separating *plan* from *build* was the highest-leverage decision. The plan prompt cost one
  message and prevented a wasted afternoon on a machine with no database.
- Two problems appeared that the lab sheet does not mention, and were only found because the
  agent ran the code rather than just writing it:
  - Prisma 7 no longer reads `DATABASE_URL` itself. `new PrismaClient()` throws
    `PrismaClientInitializationError`; it requires an explicit `@prisma/adapter-pg` driver
    adapter passed to the constructor.
  - `prisma init` wrote several hundred unrelated agent-skill files into `server/`.
- Two ambiguities in the lab sheet were resolved by assumption rather than by asking a TA:
  - Section 8 places `tests/lab-01/` under `server/`, but three of the five required tests are
    React tests needing jsdom. Split across both workspaces, documented in [`tests.md`](tests.md).
  - `docs/lab-01/tests.md` is required by the Part 2 grading table but absent from the
    structure diagram in section 8.
- Reviewing @gxjakkap's PR taught me something the lab sheet does not state: I approved his PR
  while simultaneously writing that one acceptance criterion had failed. Approve and "this does
  not pass" are contradictory signals, and approving early removes the partner's reason to
  respond — which the grading rubric explicitly asks for.
- The agent twice declined to act without confirmation: before renaming the repository and
  before inviting a collaborator. Both were the right call; both were outward-facing and hard
  to reverse.
