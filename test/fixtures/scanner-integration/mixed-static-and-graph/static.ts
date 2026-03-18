export async function loadUsers(ids: string[]) {
  for (const id of ids) {
    await prisma.user.findUnique({ where: { id } });
  }
}
