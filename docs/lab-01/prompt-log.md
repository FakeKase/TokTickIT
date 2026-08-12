# Raw Prompt Log — Lab 1

Every prompt given to the AI coding agent during Lab 1, recorded verbatim and in order.
This is the complete working record. [`ai_use.md`](ai_use.md) is the curated submission
that selects the key prompts from this log.

**Agent:** Claude Code (CLI) — model Claude Sonnet 5, effort level Medium.

## Conventions

- `P##` — a prompt typed by me to the agent.
- `S##` — a prompt the agent (acting as manager) passed to a subagent.
- `!` — a shell command I ran myself in the agent session rather than a prompt.

---

## Session 1 — 12 August 2026

### P01 — Install Vercel agent skills

```
npx skills add vercel-labs/agent-skills
```

Environment setup, before any lab work.

### P02 — Ignore agent tooling

```
add .agents and .claude and other if necessary to gitignore
```

### P03 — Read the lab sheet and plan

```
อ่าน labSheet แล้วช่วยเช็คหน่อยว่าต้องทำอะไรบ้าง วางแผนมาให้หน่อย
```

(EN: "Read the labSheet and check what needs to be done, then plan it out for me.")

### P04 — Approve Phase 0

```
เอาเลย Phase 0
```

(EN: "Go ahead with Phase 0.")

### ! Shell commands I ran during Phase 0

```bash
gh auth login                                                     # failed: gh not on Git Bash PATH yet
"/c/Program Files/GitHub CLI/gh.exe" auth login                   # succeeded
"/c/Program Files/GitHub CLI/gh.exe" auth refresh -s project      # failed: --hostname required
"/c/Program Files/GitHub CLI/gh.exe" auth refresh --FakeKase github.com -s project   # failed: my mistake, --hostname is a literal flag name
"/c/Program Files/GitHub CLI/gh.exe" auth refresh --hostname github.com -s project   # succeeded
```

### P05 — Rename repo, supply reviewer

```
เปลี่ยนชื่อ แล้วก็คู่คือ Jakkaphat Chalermphanaphan ID: 67070501056
```

(EN: "Rename it. And my partner is Jakkaphat Chalermphanaphan, ID 67070501056.")

### P06 — Start Phase 1, log all prompts

```
ทำเลย username: gxjakkap  ฝากจดหน่อยทุกพรอมท์เลย ถ้ามี subagent ฝากเก็บพรอมท์ที่ตัว manager สั่งด้วย
```

(EN: "Go ahead. Username: gxjakkap. Please record every prompt. If subagents are used,
also capture the prompts the manager gives them.")

### P07 — One issue at a time; can I see the page; must I wait for review

```
.ในชีทมันผิดอยู่ ต้องทำ issur ทีละอย่าง แล้วก็ตอนนี้สามาถเข้าไปดูหน้าเว็ปได้มั้ย แล้วต้องรอรีวิวปะ
```

(EN: "The sheet is wrong — issues must be done one at a time. Also, can I view the web page
now? And do I have to wait for the review?")

### P08 — Make the page look good

```
แก้หน้าเว็ปให้สวย ๆ น่าใช้หน่อยได้มั้ย ถามรายละเอียดได้
```

(EN: "Can you make the web page look nicer and more usable? You can ask me for details.")

### P09 — Is UI work needed yet

```
คือตอนนี้มันยังไม่จำเป็นต้องทำใช่มั้ย มีจุดไหนที่ได้แก้ UI อยู่แล้วมั้ย
```

(EN: "So it isn't necessary yet, right? Is there a point where the UI gets changed anyway?")

### P10 — Contributors

```
ถ้า contributor ให้เหลือแค่กุ (FakeKase) ได้มั้ย
```

(EN: "Can the contributors be just me (FakeKase)?")

### P11 — Claude shown as co-author

```
ตอนนี้มันเป็น claude
FakeKase
and
claude
Set up the TokTickIT project foundation
```

(EN: reporting that GitHub displayed the commit as authored by "FakeKase and claude".)

### P12 — Clarifying the concern

```
คือมีแค่ไม่อยากให้ขึ้น claude เฉย ๆ
```

(EN: "I just don't want claude showing up, that's all.")

### P13 — Compare against peer repo, blank the reflections, redo the commit

```
https://github.com/gxjakkap/soften-toktickit/tree/feature/1-project-foundation ช่วยเช็คอันนี้หน่อย ทำให้เป็นแบบคล้าย ๆ กันแต่ไม่ต้องเหมือนมาก ตรงไฟล์ MD ที่เป็น reflection ให้เว้นว่างไว้เดี๋ยวเขียนเอง ให้ลบ commit เก่าแล้วเอาใหม่
```

(EN: "Check this repo and make mine similar, but not too identical. For the MD file that is
reflection, leave it blank — I'll write it myself. Delete the old commit and make a new one.")

---

## Subagent prompts

No subagents were dispatched during Lab 1 so far. All work was performed directly by the
main agent. If a subagent is used later, the exact prompt the manager agent sends it will
be recorded here as `S01`, `S02`, and so on.
