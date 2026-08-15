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
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
