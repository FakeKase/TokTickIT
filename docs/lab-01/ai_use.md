# AI Use and Reflection — Lab 1

I used **Claude Code**, Anthropic's CLI coding agent, running the **Claude Sonnet 5** model at
effort level *Medium*. The agent had shell, file, and `gh` CLI access, so it could scaffold the
project, run the test suites, and drive GitHub directly rather than only emitting code.

The complete, unedited record of every prompt is in [`prompt-log.md`](prompt-log.md).
The table below selects the prompts that shaped the work.

## Selected key prompts

| Prompt Name | Actual Prompt Text |
| --- | --- |
| Read the lab sheet and plan | `อ่าน labSheet แล้วช่วยเช็คหน่อยว่าต้องทำอะไรบ้าง วางแผนมาให้หน่อย`<br>("Read the labSheet and check what needs to be done, then plan it out for me.")<br>**My Reflection:** |
| Ignore agent tooling | `add .agents and .claude and other if necessary to gitignore`<br>**My Reflection:** |
| Approve Phase 0 | `เอาเลย Phase 0`<br>("Go ahead with Phase 0.")<br>**My Reflection:** |
| Rename repo, supply reviewer | `เปลี่ยนชื่อ แล้วก็คู่คือ Jakkaphat Chalermphanaphan ID: 67070501056`<br>("Rename it. And my partner is Jakkaphat Chalermphanaphan, ID 67070501056.")<br>**My Reflection:** |
| Start Phase 1 and log every prompt | `ทำเลย username: gxjakkap ฝากจดหน่อยทุกพรอมท์เลย ถ้ามี subagent ฝากเก็บพรอมท์ที่ตัว manager สั่งด้วย`<br>("Go ahead. Username: gxjakkap. Please record every prompt. If subagents are used, also capture the prompts the manager gives them.")<br>**My Reflection:** |
| Question the need for UI work | `คือตอนนี้มันยังไม่จำเป็นต้องทำใช่มั้ย มีจุดไหนที่ได้แก้ UI อยู่แล้วมั้ย`<br>("So it isn't necessary yet, right? Is there a point where the UI gets changed anyway?")<br>**My Reflection:** |
| Compare against my peer's repo | `ช่วยเช็คอันนี้หน่อย ทำให้เป็นแบบคล้าย ๆ กันแต่ไม่ต้องเหมือนมาก`<br>("Check this one and make mine similar, but it doesn't have to match closely.")<br>**My Reflection:** |

## Reflection on improving my prompts

**What worked.**

**What I had to correct.**

**What I would do differently.**

**On responsibility.**

## Notes for my own reflection

Raw material I can draw on when writing the sections above — facts from the session, not conclusions:

- Asking for a *plan* before any code produced the four-issue dependency graph and an audit of
  my machine, which found PostgreSQL, Docker, and `gh` all missing before time was wasted.
- The agent hit two things the lab sheet does not mention, and only found them because it ran
  the code: Prisma 7 requires an explicit driver adapter (`@prisma/adapter-pg`) instead of
  reading `DATABASE_URL` itself, and `prisma init` wrote several hundred unrelated agent-skill
  files into `server/`.
- Two ambiguities in the lab sheet were resolved by assumption rather than by asking:
  section 8 places `tests/lab-01/` inside `server/` although three of the five required tests
  are React UI tests needing jsdom (see [`tests.md`](tests.md)), and `docs/lab-01/tests.md` is
  required by the grading table but missing from the structure diagram.
- Comparing against my peer's branch showed the same lab sheet read two ways: he colocated
  tests in `src/`, used Docker Compose for PostgreSQL and pnpm, and implemented `/api/health`
  during Issue 1. I adopted his Docker Compose file and `client/.env.example`, and kept my own
  `tests/lab-01/` layout.
- I asked for the `Co-Authored-By: Claude` trailer to be removed from my commit so the work
  shows a single author; AI use is disclosed here instead.
