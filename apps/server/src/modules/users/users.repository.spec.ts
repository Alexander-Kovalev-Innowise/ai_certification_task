import { UsersRepository } from './users.repository';

// Task 2.9 — no Testcontainers section named in the plan for this task;
// unit-tested against a mocked PrismaService (the soft-delete/findUnique
// behaviors this repository leans on are already Testcontainers-proven by
// Task 1.5's own extension spec and Task 2.4's guard e2e spec).
describe('UsersRepository (Task 2.9)', () => {
  function makePrismaMock() {
    return {
      extended: {
        user: {
          findFirst: jest.fn(),
        },
      },
      user: {
        create: jest.fn(),
        update: jest.fn(),
      },
    };
  }

  it('findByEmail uses the extended (soft-delete-respecting) client via findFirst', async () => {
    const prisma = makePrismaMock();
    prisma.extended.user.findFirst.mockResolvedValue({ id: 'u1' });
    const repo = new UsersRepository(prisma as never);

    const result = await repo.findByEmail('a@b.com');

    expect(prisma.extended.user.findFirst).toHaveBeenCalledWith({ where: { email: 'a@b.com' } });
    expect(result).toEqual({ id: 'u1' });
  });

  it('findById uses findFirst (never findUnique) on the extended client', async () => {
    const prisma = makePrismaMock();
    prisma.extended.user.findFirst.mockResolvedValue({ id: 'u1' });
    const repo = new UsersRepository(prisma as never);

    await repo.findById('u1');

    expect(prisma.extended.user.findFirst).toHaveBeenCalledWith({ where: { id: 'u1' } });
  });

  it('create delegates to prisma.user.create', async () => {
    const prisma = makePrismaMock();
    prisma.user.create.mockResolvedValue({ id: 'u1' });
    const repo = new UsersRepository(prisma as never);

    const data = { email: 'a@b.com' } as never;
    await repo.create(data);

    expect(prisma.user.create).toHaveBeenCalledWith({ data });
  });

  it('update delegates to prisma.user.update scoped by id', async () => {
    const prisma = makePrismaMock();
    prisma.user.update.mockResolvedValue({ id: 'u1' });
    const repo = new UsersRepository(prisma as never);

    const data = { firstName: 'New' } as never;
    await repo.update('u1', data);

    expect(prisma.user.update).toHaveBeenCalledWith({ where: { id: 'u1' }, data });
  });

  it('uses the provided tx client instead of the injected PrismaService when given', async () => {
    const prisma = makePrismaMock();
    const tx = { user: { findFirst: jest.fn().mockResolvedValue({ id: 'tx-user' }) } };
    const repo = new UsersRepository(prisma as never);

    const result = await repo.findById('u1', tx as never);

    expect(tx.user.findFirst).toHaveBeenCalledWith({ where: { id: 'u1' } });
    expect(prisma.extended.user.findFirst).not.toHaveBeenCalled();
    expect(result).toEqual({ id: 'tx-user' });
  });
});
