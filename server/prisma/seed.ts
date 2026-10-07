import 'dotenv/config'
import bcrypt from 'bcryptjs'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '../src/generated/prisma/client.js'
import type { CommentVisibility, ItPriority, RequestedPriority, Role, TicketStatus } from '../src/generated/prisma/enums.js'

/**
 * The local development password every seeded account shares. A fixture, not a
 * secret: it is documented in the README precisely so nobody mistakes it for
 * one, and it exists only in a database seeded from this file (BR-39).
 */
const DEV_PASSWORD = 'ChangeMe123!'

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL })
const prisma = new PrismaClient({ adapter })

async function main() {
  const categories = [
    { name: 'Account and Access', description: 'Login, password, permissions, and account management' },
    { name: 'Hardware', description: 'Computer, printer, monitor, and other equipment issues' },
    { name: 'Software', description: 'Application, license, and installation problems' },
    { name: 'Network', description: 'Internet, VPN, WiFi, and connectivity issues' },
  ]

  for (const cat of categories) {
    await prisma.category.upsert({
      where: { name: cat.name },
      update: cat,
      create: cat,
    })
  }

  console.log('Seeded 4 categories')

  const relatedSystems = [
    { name: 'Email' },
    { name: 'Campus Wi-Fi' },
    { name: 'VPN' },
    { name: 'LEB2 App' },
    { name: 'Grade Submission App' },
    { name: 'Printer' },
    { name: 'Corporate Laptop' },
  ]

  for (const system of relatedSystems) {
    await prisma.relatedSystem.upsert({
      where: { name: system.name },
      update: system,
      create: system,
    })
  }

  console.log(`Seeded ${relatedSystems.length} related systems`)

  const passwordHash = await bcrypt.hash(DEV_PASSWORD, 10)

  // handout §5.3: four active Requesters and one inactive, three active IT
  // Staff and one inactive, one Administrator. The five Lab 2 Requesters keep
  // their addresses so the Tickets migrated from Lab 2 stay attached to the
  // same people (BR-40).
  const users: Array<{
    name: string
    email: string
    role: Role
    isActive: boolean
    mustChangePassword?: boolean
  }> = [
    { name: 'Peter Parker', email: 'peter.parker@toktickit.test', role: 'REQUESTER', isActive: true },
    { name: 'Ned Leeds', email: 'ned.leeds@toktickit.test', role: 'REQUESTER', isActive: true },
    { name: 'Michelle Jones', email: 'michelle.jones@toktickit.test', role: 'REQUESTER', isActive: true },
    { name: 'Roronoa Zoro', email: 'roronoa.zoro@toktickit.test', role: 'REQUESTER', isActive: true },
    { name: 'David Kim', email: 'david.kim@toktickit.test', role: 'REQUESTER', isActive: false },

    // Owns nothing, on purpose. My Tickets has to distinguish Empty ("you have
    // no Tickets") from No-Results ("nothing matches these filters") - BR-28 -
    // and the Empty state cannot be demonstrated, screenshotted or tested
    // without an account that genuinely has no Tickets. Every other active
    // Requester below is given some.
    { name: 'Grace Lim', email: 'grace.lim@toktickit.test', role: 'REQUESTER', isActive: true },

    { name: 'Sarah Chen', email: 'sarah.chen@toktickit.test', role: 'IT_STAFF', isActive: true },
    { name: 'Marcus Reed', email: 'marcus.reed@toktickit.test', role: 'IT_STAFF', isActive: true },
    { name: 'Aiko Tanaka', email: 'aiko.tanaka@toktickit.test', role: 'IT_STAFF', isActive: true },
    { name: 'Viktor Hale', email: 'viktor.hale@toktickit.test', role: 'IT_STAFF', isActive: false },

    { name: 'Alex Morgan', email: 'alex.morgan@toktickit.test', role: 'ADMINISTRATOR', isActive: true },

    // Two accounts deliberately left holding an initial password, so the
    // mandatory first-login change (BR-02) is demonstrable without an
    // Administrator having to issue one first. Everybody else is onboarded,
    // because a seed where every account is mid-onboarding cannot be used to
    // demonstrate anything else.
    { name: 'Nora Bennett', email: 'nora.bennett@toktickit.test', role: 'REQUESTER', isActive: true, mustChangePassword: true },
    { name: 'Daniel Okafor', email: 'daniel.okafor@toktickit.test', role: 'IT_STAFF', isActive: true, mustChangePassword: true },
  ]

  for (const user of users) {
    const mustChangePassword = user.mustChangePassword ?? false
    await prisma.user.upsert({
      where: { email: user.email },
      // mustChangePassword is set on both paths on purpose. The migration marks
      // every account it carries over from Lab 2 as holding an initial
      // password, so without this line a machine that ran Lab 2 would end up
      // with Peter Parker gated at first login while a fresh checkout would
      // not - the same seed command, two different applications, and an E2E
      // suite that passes in CI and fails on a developer's laptop. The seed
      // defines the fixture; the migration's behaviour is proved where it
      // belongs, by `npm run db:migration-check`.
      //
      // passwordHash is still never updated: a password somebody has since
      // changed is their data, not scenery.
      update: {
        name: user.name,
        role: user.role,
        isActive: user.isActive,
        mustChangePassword,
      },
      create: { ...user, mustChangePassword, passwordHash },
    })
  }

  console.log(`Seeded ${users.length} users (${users.filter((u) => u.role === 'REQUESTER').length} requesters, ${users.filter((u) => u.role === 'IT_STAFF').length} IT staff, 1 administrator)`)

  await seedTickets()
}

/**
 * Realistic Tickets spread across statuses, both priority scales, and assigned
 * as well as unassigned ownership, plus example comments, notes and Actions
 * Taken.
 *
 * Idempotent through `ticketNumber`, which is the only natural key a Ticket
 * has. Seeded numbers live in the 800000 band so they can never collide with a
 * real Ticket (numbered from its own row id) or with a test fixture (900000).
 */
const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/** One seeded Action Taken. Follow-up is required exactly when a note is
 *  given, which is the rule the table itself enforces (BR-07). */
interface SeedAction {
  performedById: number
  /** Hours after the Ticket was created that the work was done. */
  afterHours: number
  description: string
  result: string
  followUpNote?: string
  attachmentNotes?: string
}

async function seedTickets() {
  const user = async (email: string) =>
    prisma.user.findUniqueOrThrow({ where: { email } })
  const category = async (name: string) =>
    prisma.category.findUniqueOrThrow({ where: { name } })
  const system = async (name: string) =>
    prisma.relatedSystem.findUniqueOrThrow({ where: { name } })

  const [peter, ned, michelle, zoro, sarah, marcus] = await Promise.all([
    user('peter.parker@toktickit.test'),
    user('ned.leeds@toktickit.test'),
    user('michelle.jones@toktickit.test'),
    user('roronoa.zoro@toktickit.test'),
    user('sarah.chen@toktickit.test'),
    user('marcus.reed@toktickit.test'),
  ])

  const tickets: Array<{
    number: string
    requesterId: number
    ownerId: number | null
    category: string
    system: string
    summary: string
    description: string
    requestedPriority: RequestedPriority
    itPriority: ItPriority
    currentStatus: TicketStatus
    comments?: Array<{ authorId: number; visibility: CommentVisibility; body: string }>
    /** Hours after the Ticket was created that it was resolved. Only for a
     *  Ticket seeded as Resolved or Closed (Lab 4 BR-18). */
    resolvedAfterHours?: number
    actions?: SeedAction[]
  }> = [
    {
      number: 'TKT-2026-800001',
      requesterId: peter.id,
      ownerId: null,
      category: 'Hardware',
      system: 'Corporate Laptop',
      summary: 'Laptop fan runs constantly and the case is hot',
      description: 'The fan has been at full speed since Monday even with nothing open, and the underside is too hot to rest on my lap.',
      requestedPriority: 'MEDIUM',
      itPriority: 'MEDIUM',
      currentStatus: 'NEW',
    },
    {
      number: 'TKT-2026-800002',
      requesterId: ned.id,
      ownerId: sarah.id,
      category: 'Network',
      system: 'VPN',
      summary: 'VPN disconnects every few minutes from home',
      description: 'The VPN drops roughly every five minutes and I have to reconnect manually. It is fine on campus Wi-Fi.',
      requestedPriority: 'HIGH',
      itPriority: 'URGENT',
      currentStatus: 'IN_PROGRESS',
      comments: [
        { authorId: sarah.id, visibility: 'PUBLIC', body: 'Thanks for reporting this. Could you tell me which internet provider you are on at home?' },
        { authorId: sarah.id, visibility: 'INTERNAL', body: 'Third VPN drop report from the same building this week. Checking whether the concentrator rolled back to the old firmware.' },
      ],
      // Three actions by two people, one of whom does not own the Ticket
      // (BR-02), and the latest still needing follow-up: this is the Ticket
      // the resolution gate refuses (BR-13).
      actions: [
        {
          performedById: sarah.id,
          afterHours: 2,
          description: 'Checked the VPN concentrator logs for the sessions from the home address range.',
          result: 'The sessions are ended by the idle timeout, which last week\'s firmware rollback reset to 5 minutes.',
          attachmentNotes: 'Concentrator log extract: vpn-drops-ned.txt',
        },
        {
          performedById: marcus.id,
          afterHours: 26,
          description: 'Raised the idle timeout to 8 hours on the test profile and moved the Requester onto it.',
          result: 'No disconnects during a 40 minute test session.',
        },
        {
          performedById: sarah.id,
          afterHours: 50,
          description: 'Asked the network team to apply the same timeout to the production profile.',
          result: 'The change is scheduled. The Requester stays on the test profile until it is applied.',
          followUpNote: 'Confirm the production profile has the 8 hour timeout, then move the Requester back to it.',
        },
      ],
    },
    {
      number: 'TKT-2026-800003',
      requesterId: michelle.id,
      ownerId: marcus.id,
      category: 'Account and Access',
      system: 'LEB2 App',
      summary: 'Cannot open the grade submission page',
      description: 'Clicking Grade Submission returns a permission error even though I am listed as the course instructor.',
      requestedPriority: 'HIGH',
      itPriority: 'HIGH',
      currentStatus: 'WAITING_FOR_REQUESTER',
      comments: [
        { authorId: marcus.id, visibility: 'PUBLIC', body: 'I have requested the instructor role for you. Could you sign out and back in, then tell me whether the page opens?' },
        { authorId: michelle.id, visibility: 'PUBLIC', body: 'Signed out and back in, still the same error.' },
        { authorId: marcus.id, visibility: 'INTERNAL', body: 'Role exists in the directory but has not synced. Raising with the LEB2 team rather than re-issuing.' },
      ],
      actions: [
        {
          performedById: marcus.id,
          afterHours: 3,
          description: 'Requested the course instructor role in the directory and asked the LEB2 team to run the sync.',
          result: 'The role is present in the directory. LEB2 confirmed the sync has run.',
        },
      ],
    },
    {
      number: 'TKT-2026-800004',
      requesterId: zoro.id,
      ownerId: sarah.id,
      category: 'Software',
      system: 'Email',
      summary: 'Outlook asks for my password in a loop',
      description: 'Outlook keeps prompting for my password and rejects it, but webmail works with the same one.',
      requestedPriority: 'MEDIUM',
      itPriority: 'HIGH',
      currentStatus: 'RESOLVED',
      comments: [
        { authorId: sarah.id, visibility: 'PUBLIC', body: 'Cleared the cached credential on your profile. Please try Outlook again and let me know.' },
        { authorId: zoro.id, visibility: 'PUBLIC', body: 'Working now, thank you.' },
      ],
      resolvedAfterHours: 48,
      actions: [
        {
          performedById: sarah.id,
          afterHours: 1,
          description: 'Cleared the cached Outlook credential on the Requester\'s profile.',
          result: 'Outlook signed in on the first prompt and stopped asking.',
        },
        {
          performedById: marcus.id,
          afterHours: 25,
          description: 'Checked with the Requester the next day.',
          result: 'Outlook has stayed signed in for 24 hours.',
        },
      ],
    },
    {
      number: 'TKT-2026-800005',
      requesterId: peter.id,
      ownerId: marcus.id,
      category: 'Hardware',
      system: 'Printer',
      summary: 'Third floor printer jams on every duplex job',
      description: 'Single sided prints are fine. Anything double sided jams in the same place.',
      requestedPriority: 'LOW',
      itPriority: 'MEDIUM',
      currentStatus: 'CLOSED',
      comments: [
        { authorId: marcus.id, visibility: 'INTERNAL', body: 'Duplex unit replaced under warranty. Serial recorded in the asset sheet.' },
      ],
      resolvedAfterHours: 24,
      actions: [
        {
          performedById: marcus.id,
          afterHours: 4,
          description: 'Replaced the duplex unit under warranty.',
          result: 'Printed 20 double sided test pages with no jam.',
          attachmentNotes: 'Warranty claim form: printer-3f-duplex-claim.pdf',
        },
      ],
    },
    {
      number: 'TKT-2026-800006',
      requesterId: ned.id,
      ownerId: null,
      category: 'Network',
      system: 'Campus Wi-Fi',
      summary: 'Wi-Fi drops in the west stairwell',
      description: 'Signal disappears completely between the second and third floors of the west stairwell.',
      requestedPriority: 'LOW',
      itPriority: 'LOW',
      currentStatus: 'OPEN',
    },
    {
      number: 'TKT-2026-800007',
      requesterId: michelle.id,
      ownerId: null,
      category: 'Software',
      system: 'Grade Submission App',
      summary: 'Grade import rejects a valid CSV file',
      description: 'The importer reports a malformed file for a CSV exported straight out of the template.',
      requestedPriority: 'MEDIUM',
      itPriority: 'MEDIUM',
      currentStatus: 'CANCELLED',
    },
    {
      number: 'TKT-2026-800008',
      requesterId: zoro.id,
      ownerId: sarah.id,
      category: 'Account and Access',
      system: 'Email',
      summary: 'Shared mailbox access was removed',
      description: 'I lost access to the shared support mailbox after the account review last week.',
      requestedPriority: 'HIGH',
      itPriority: 'HIGH',
      currentStatus: 'REOPENED',
      comments: [
        { authorId: sarah.id, visibility: 'PUBLIC', body: 'Access restored. Reopening because the permission did not stick overnight.' },
        { authorId: sarah.id, visibility: 'INTERNAL', body: 'Suspect the review job re-runs nightly and strips it again. Do not close until it survives two nights.' },
      ],
    },
  ]

  // The seeded Tickets are given a past, six days back and a minute apart in
  // the order they are listed, so that the work recorded on them can be dated
  // after they were created and before now (BR-05), and the resolved ones
  // fall inside the dashboard's seven days.
  //
  // An existing row keeps the creation time it has, unless it is younger than
  // the latest thing the seed dates from it: a database seeded an hour ago
  // under Lab 3 would otherwise get work recorded two days in the future.
  // Such a row is moved back once and is then old enough to be left alone.
  const firstCreatedAt = Date.now() - 6 * DAY
  const youngestUsable = Date.now() - 3 * DAY
  let actionCount = 0

  for (const [index, spec] of tickets.entries()) {
    const [cat, sys] = await Promise.all([category(spec.category), system(spec.system)])
    const existingTicket = await prisma.ticket.findUnique({
      where: { ticketNumber: spec.number },
      select: { createdAt: true },
    })
    const createdAt =
      existingTicket && existingTicket.createdAt.getTime() <= youngestUsable
        ? existingTicket.createdAt
        : new Date(firstCreatedAt + index * MINUTE)
    // Derived from the creation time, which never changes, so every run
    // writes the same value. Null for a Ticket that is not resolved, which
    // also undoes a resolution somebody made while demonstrating.
    const resolvedAt =
      spec.resolvedAfterHours === undefined
        ? null
        : new Date(createdAt.getTime() + spec.resolvedAfterHours * HOUR)

    // Unlike the user upsert above, this one does restore the demo state on
    // every run. A password someone changed is their data; a seeded Ticket
    // someone dragged through three statuses while demonstrating the queue is
    // scenery, and the next demo wants it back where it started.
    const ticket = await prisma.ticket.upsert({
      where: { ticketNumber: spec.number },
      update: {
        ownerId: spec.ownerId,
        itPriority: spec.itPriority,
        currentStatus: spec.currentStatus,
        createdAt,
        resolvedAt,
      },
      create: {
        createdAt,
        resolvedAt,
        ticketNumber: spec.number,
        requesterId: spec.requesterId,
        categoryId: cat.id,
        relatedSystemId: sys.id,
        summary: spec.summary,
        description: spec.description,
        requestedPriority: spec.requestedPriority,
        itPriority: spec.itPriority,
        currentStatus: spec.currentStatus,
        ownerId: spec.ownerId,
      },
    })

    // Comments have no natural key, so they are written once and left alone
    // afterwards. Deleting and recreating them on every run would churn ids and
    // timestamps for no benefit.
    const existing = await prisma.ticketComment.count({ where: { ticketId: ticket.id } })
    if (existing === 0 && spec.comments?.length) {
      await prisma.ticketComment.createMany({
        data: spec.comments.map((comment) => ({ ...comment, ticketId: ticket.id })),
      })
    }

    // Actions Taken do have a natural key: the request key (BR-20), which the
    // seed fills with one only it writes. Written once and then left alone,
    // like the comments, so an edit made during a demo is not undone here.
    for (const [n, action] of (spec.actions ?? []).entries()) {
      const { afterHours, followUpNote, attachmentNotes, ...fields } = action
      await prisma.actionTaken.upsert({
        where: { requestKey: `seed:${spec.number.slice(-6)}:${n + 1}` },
        update: {},
        create: {
          ...fields,
          ticketId: ticket.id,
          requestKey: `seed:${spec.number.slice(-6)}:${n + 1}`,
          actionAt: new Date(createdAt.getTime() + afterHours * HOUR),
          // Recorded a few minutes after the work, as a person would.
          createdAt: new Date(createdAt.getTime() + afterHours * HOUR + 10 * MINUTE),
          followUpRequired: followUpNote !== undefined,
          followUpNote: followUpNote ?? null,
          attachmentNotes: attachmentNotes ?? null,
        },
      })
      actionCount += 1
    }
  }

  // Counted from what this file defines, not from the table: a database that
  // has been used has comments the seed never wrote, and a summary line that
  // quietly includes them is a summary line nobody can trust.
  const defined = tickets.flatMap((spec) => spec.comments ?? [])
  const publicCount = defined.filter((comment) => comment.visibility === 'PUBLIC').length
  const internalCount = defined.length - publicCount
  console.log(`Seeded ${tickets.length} tickets, ${publicCount} public comments, ${internalCount} internal notes, ${actionCount} actions taken`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
