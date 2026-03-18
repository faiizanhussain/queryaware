// Simulates NestJS / class-based service with Prisma injected as this.prisma
export class UserService {
  private prisma: any;

  async findUser(id: string) {
    return this.prisma.user.findUnique({ where: { id } });
  }

  async createUser(data: any) {
    return this.prisma.user.create({ data });
  }

  async rawQuery() {
    return this.prisma.$queryRaw`SELECT 1`;
  }
}
