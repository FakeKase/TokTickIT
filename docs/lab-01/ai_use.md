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


## Selected key prompts

| # | Prompt Name | Actual Prompt Text | My Reflection |
| --- | --- | --- | --- |
| 1 | Specify Lab 1 from the source document | `Read the labSheet, check what needs to be done, and plan it out for me` | Planning before start any project is crucial, it helps me to understand the big picture of the project and know the flow of how to get the work done. |
| 2 | Define version-control hygiene | `add .agents and .claude and other if necessary to gitignore` | Claude added entries for AI-agent tool folders (`.agents/`, `.claude/`) alongside the usual OS/editor ones. These are local to my machine and not part of the project itself, so keeping them out of the repo was the right call. |
| 3 | Execute the environment and workflow setup | `Start phase 0` | After I understand the procedure, I told claude to start the 'setting-up' phase to make sure everything is ready for the project |
| 4 | Challenge scope before accepting work | `Is there a point where the UI gets changed?` | I don't like the style of the UI claude gave me, so I ask it to check the labsheet to see if there is any part where I can change the UI |
| 5 | Verify criteria manually | `How can I check Acceptance criteria for this issue manually?` | When claude finishes implementing each issue, I always ask it to explain the criteria, so I can check them manually in case Claude was hallucinating. |
| 6 | Debug a CORS/port mismatch | `Why is the website now just a blank page, can you help me check what's wrong` | I found the bug where the client site became a blank page, so I ask Claude to check for any bugs. And I found that the API path is mismatched the API is 3002 but the client was looking at 3001 |

## Overall Reflection

Early on, I noticed I was trusting whatever Claude told me was "done" without actually checking it myself, and I wasn't learning anything from the process. Once I noticed that, I started asking Claude to explain how the project actually works and how to debug things manually, and to walk me through diagnosing an error before jumping to a fix. The biggest improvement over the sprint came from that shift: checking the code manually instead of trusting a "done" claim outright, which forced every acceptance criterion to be verified against the running app rather than just against Claude's own report.

