import { Prisma } from '@prisma/client';

// Task 1.5 (arch §11.1). Merges `deletedAt: null` into `where` on
// `findMany`/`findFirst`/`count`/`aggregate` for models that carry a
// `deletedAt` column, unless the caller passes `withDeleted: true`.
//
// Deliberate exception (this is exactly what Task 2.4's JwtAuthGuard depends
// on): `findUnique` is NOT filtered here. Prisma restricts `findUnique`'s
// `where` to unique fields, and silently returning null for a known id
// causes more bugs than it prevents. Repositories that must exclude
// soft-deleted rows by id use `findFirst` instead of `findUnique`.
//
// Deviation from the plan's task description: Task 1.5 names three models
// "with deletedAt" — User, PlayerProfile, PlayerTrainerAssociation — but the
// Task 1.1 schema (reproduced verbatim from the plan) only gives `deletedAt`
// to User and PlayerProfile. PlayerTrainerAssociation models
// connect/disconnect via `status: AssociationStatus` + `disconnectedAt`
// instead, matching architecture §2's "removal-with-cascade" description for
// the associations module — there is no `deletedAt` column on that model to
// filter on. This extension therefore covers only User and PlayerProfile.

type WhereArgs = Record<string, unknown> | undefined;
type SoftDeleteArgs = { where?: WhereArgs; withDeleted?: boolean } & Record<string, unknown>;

function withoutDeleted(args: SoftDeleteArgs | undefined): Record<string, unknown> {
  const { withDeleted, where, ...rest } = args ?? {};
  if (withDeleted) {
    return { ...rest, where };
  }
  return { ...rest, where: { ...where, deletedAt: null } };
}

function softDeleteModelQueries() {
  return {
    findMany({ args, query }: { args: SoftDeleteArgs; query: (args: unknown) => Promise<unknown> }) {
      return query(withoutDeleted(args));
    },
    findFirst({ args, query }: { args: SoftDeleteArgs; query: (args: unknown) => Promise<unknown> }) {
      return query(withoutDeleted(args));
    },
    count({ args, query }: { args: SoftDeleteArgs; query: (args: unknown) => Promise<unknown> }) {
      return query(withoutDeleted(args));
    },
    aggregate({ args, query }: { args: SoftDeleteArgs; query: (args: unknown) => Promise<unknown> }) {
      return query(withoutDeleted(args));
    },
  };
}

export const softDeleteExtension = Prisma.defineExtension({
  name: 'soft-delete',
  query: {
    user: softDeleteModelQueries(),
    playerProfile: softDeleteModelQueries(),
  },
});
