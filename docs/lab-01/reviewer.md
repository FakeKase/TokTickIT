# Peer Review — Lab 1

## My reviewer

The classmate who reviews my pull requests.

| Field | Person 1 | Person 2 |
| --- | --- | --- |
| Name | Jakkaphat Chalermphanaphan |  Supichaya Limwatanasamut |
| Student ID | 67070501056 | 67070501087 |
| GitHub username | [@gxjakkap](https://github.com/gxjakkap) | [PingSupichaya](https://github.com/PingSupichaya)

### Pull requests they reviewed for me

| PR | Title | Status |
| --- | --- | --- |
| https://github.com/FakeKase/TokTickIT/pull/5 | Issue 1 — Set up the TokTickIT project foundation | Approved |
| https://github.com/FakeKase/TokTickIT/pull/6 | Issue 2 — Implement the API health check | Approved |
| https://github.com/FakeKase/TokTickIT/pull/8 | Issue 3 — Create and seed IT request categories | Approved |
| https://github.com/FakeKase/TokTickIT/pull/9 | Issue 4 — Display the IT request category list | Approved |

### Review comments I received, and how I responded

| PR | Their comment | My response |
| --- | --- | --- |
| https://github.com/FakeKase/TokTickIT/pull/5 | LGTM! This PR satisfies all the acceptance criteria, I've verified that both services start correctly in the dev environment, and the project structure looks correct. | No changes needed — merged as-is. |
| https://github.com/FakeKase/TokTickIT/pull/6 | LGTM kub. I looked through your code, manually verified that the functionality works, and had an agent look at it too. Your changes satisfy every acceptance criteria. (Included a full agent code-review audit confirming the health check shape, Supertest coverage, and error-message handling.) | No changes needed — merged as-is. |
| https://github.com/FakeKase/TokTickIT/pull/7 (closed, superseded by #8) | *Changes requested:* "From my testing, I notice the table is created in database but without createdAt. Could you please double-check your code to ensure it meets the criteria?" | Confirmed the bug: the `createdAt` migration file had been generated locally but never committed. Added the missing migration, then split the PR into a database-only PR (#8) and a UI-only PR (#9) to match the Issue 3 / Issue 4 boundary, closing #7. Replied inline: "I've pushed the version with the createdAt column now! Please review again if it meets all the criteria." |
| https://github.com/FakeKase/TokTickIT/pull/8 | Great job! Now all of the criteria are met, prisma migration is now working and seed added successfully. It will be better if you add more test instructions in README 😆 | Added a "Running the tests" section to the README covering the `prisma migrate deploy` + seed prerequisite and the expected passing output for both suites. |
| https://github.com/FakeKase/TokTickIT/pull/9 | Web page can fetch categories to display. Everything meets criteria. Nice work kub! | No changes needed — merged as-is. |

## Reviews I gave

Pull requests I reviewed for my partner.

| Field | Value |
| --- | --- |
| Author name | Jakkaphat Chalermphanaphan |
| Student ID | 67070501056 |
| GitHub username | [@gxjakkap](https://github.com/gxjakkap) |
| Repository | [gxjakkap/soften-toktickit](https://github.com/gxjakkap/soften-toktickit) |

| PR | Title | My comment | How they responded |
| --- | --- | --- | --- |
| https://github.com/gxjakkap/soften-toktickit/pull/6 | feat: initial project structure | "ตอนนี้มีอย่างเดียวครับที่ยังไม่ผ่าน Acceptance criteria คือข้อที่ 2 ครับ Bootstrap is installed and visible in the frontend; เพราะว่าในหน้าเว็ปยังเป็น boilerplate ของ vite ครับ ไม่ได้ส่งผลอะไรมากแต่ว่าถ้าเปลี่ยนให้ตรงได้จะดีมากครับ" (Approved, with one non-blocking note that Bootstrap wasn't visibly wired into the page yet.) | Fixed and replied "done kub". |
| https://github.com/gxjakkap/soften-toktickit/pull/7 | feat: health check | "Everything looks fine kub. All the acceptance criterias have been met and passed. LGTMMM" (Approved.) | No changes needed. |
| https://github.com/gxjakkap/soften-toktickit/pull/8 | feat: add Category model with migration and idempotent seed | "The prisma model includes all of the required attributes and works successfully, the seed is added correctly with no duplicates. All other criteria have also been met! Approve karbbb" (Approved.) | No changes needed. |
| https://github.com/gxjakkap/soften-toktickit/pull/9 | feat: add categories API route and display list on frontend | "The API shows category info correctly. The UI displays categories without hard-coding. The error states are shown as they should when the DB is not started. Everything looks great and passed all the criteria karb." (Approved.) | No changes needed. |
