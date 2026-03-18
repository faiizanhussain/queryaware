// Tests prisma.$queryRaw`...` tagged template literal form
// and this.prisma.$queryRaw`...` (DI variant)
export async function runReport(prisma: any) {
  const rows = await prisma.$queryRaw`SELECT id FROM "User" LIMIT 10`;
  return rows;
}

export class ReportService {
  private prisma: any;

  async getStats() {
    return this.prisma.$executeRaw`DELETE FROM "Session" WHERE expired = true`;
  }
}
