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
      // Deliberately narrow: re-running the seed must not reset a password
      // somebody has since changed, nor clear the flag on a row the migration
      // marked as holding an initial password.
      update: { name: user.name, role: user.role, isActive: user.isActive },
      create: { ...user, mustChangePassword, passwordHash },
    })
  }

  console.log(`Seeded ${users.length} users (${users.filter((u) => u.role === 'REQUESTER').length} requesters, ${users.filter((u) => u.role === 'IT_STAFF').length} IT staff, 1 administrator)`)

  await seedTickets()
}

/**
 * Realistic Tickets spread across statuses, both priority scales, and assigned
 * as well as unassigned ownership, plus example comments and notes.
 *
 * Idempotent through `ticketNumber`, which is the only natural key a Ticket
 * has. Seeded numbers live in the 800000 band so they can never collide with a
 * real Ticket (numbered from its own row id) or with a test fixture (900000).
 */
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

  for (const spec of tickets) {
    const [cat, sys] = await Promise.all([category(spec.category), system(spec.system)])

    const ticket = await prisma.ticket.upsert({
      where: { ticketNumber: spec.number },
      update: {
        ownerId: spec.ownerId,
        itPriority: spec.itPriority,
        currentStatus: spec.currentStatus,
      },
      create: {
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
  }

  const publicCount = await prisma.ticketComment.count({ where: { visibility: 'PUBLIC' } })
  const internalCount = await prisma.ticketComment.count({ where: { visibility: 'INTERNAL' } })
  console.log(`Seeded ${tickets.length} tickets, ${publicCount} public comments, ${internalCount} internal notes`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
