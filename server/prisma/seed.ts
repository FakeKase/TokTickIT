import 'dotenv/config'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '../src/generated/prisma/client.js'

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

  const requesters = [
    { name: 'Jennifer Anderson', email: 'jennifer.anderson@toktickit.test', isActive: true },
    { name: 'Marcus Lee', email: 'marcus.lee@toktickit.test', isActive: true },
    { name: 'Priya Natarajan', email: 'priya.natarajan@toktickit.test', isActive: true },
    { name: 'Somchai Charoenkul', email: 'somchai.charoenkul@toktickit.test', isActive: true },
    { name: 'David Kim', email: 'david.kim@toktickit.test', isActive: false },
  ]

  for (const requester of requesters) {
    await prisma.requester.upsert({
      where: { email: requester.email },
      update: requester,
      create: requester,
    })
  }

  console.log(`Seeded ${requesters.length} requesters`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
