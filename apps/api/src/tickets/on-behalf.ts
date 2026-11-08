import type { CustomerLookup, OnBehalfCustomer, OrganisationMembers } from '@ogs/contracts';
import { conflict } from '../common/domain-error.js';
import {
  MembershipStatus,
  TenantKind,
  TenantStatus,
  UserStatus,
  type Db,
} from '../database/index.js';

export interface ResolvedCustomer {
  readonly customerTenantId: string | null;
  readonly customerUserId: string | null;
  /** The person the record is for: the organisation member, or the person. */
  readonly requesterUserId: string;
  readonly departmentId: string | null;
}

/**
 * Checks the customer staff picked (P8-6, P8-7), in the elevated context: an
 * ACTIVE organisation and one of its ACTIVE members, or an ACTIVE person.
 * Provider companies and the PLATFORM tenant are never customers.
 */
export async function resolveOnBehalf(
  tx: Db,
  customer: OnBehalfCustomer,
): Promise<ResolvedCustomer> {
  if (customer.kind === 'ORGANISATION') {
    const membership = await tx.membership.findFirst({
      where: {
        tenantId: customer.tenantId,
        userId: customer.requesterUserId,
        status: MembershipStatus.ACTIVE,
        tenant: { kind: TenantKind.ORGANISATION, status: TenantStatus.ACTIVE },
        user: { status: UserStatus.ACTIVE },
      },
      select: { departmentId: true },
    });
    if (membership === null) {
      throw conflict('customer_unknown');
    }
    return {
      customerTenantId: customer.tenantId,
      customerUserId: null,
      requesterUserId: customer.requesterUserId,
      departmentId: membership.departmentId,
    };
  }
  const person = await tx.appUser.count({
    where: { id: customer.userId, status: UserStatus.ACTIVE },
  });
  if (person !== 1) {
    throw conflict('customer_unknown');
  }
  return {
    customerTenantId: null,
    customerUserId: customer.userId,
    requesterUserId: customer.userId,
    departmentId: null,
  };
}

/** Organisations by name, people by exact email (no partial email search). */
export async function lookupCustomers(tx: Db, query: string): Promise<CustomerLookup> {
  const q = query.trim();
  if (q.length < 2) {
    return { organisations: [], people: [] };
  }
  const [organisations, people] = await Promise.all([
    tx.tenant.findMany({
      where: {
        kind: TenantKind.ORGANISATION,
        status: TenantStatus.ACTIVE,
        name: { contains: q, mode: 'insensitive' },
      },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
      take: 10,
    }),
    q.includes('@')
      ? tx.appUser.findMany({
          where: { email: q, status: UserStatus.ACTIVE },
          select: { id: true, email: true },
          take: 1,
        })
      : [],
  ]);
  return {
    organisations: organisations.map((o) => ({ tenantId: o.id, name: o.name })),
    people: people.map((p) => ({ id: p.id, email: p.email })),
  };
}

export async function organisationMembers(tx: Db, tenantId: string): Promise<OrganisationMembers> {
  const members = await tx.membership.findMany({
    where: {
      tenantId,
      status: MembershipStatus.ACTIVE,
      tenant: { kind: TenantKind.ORGANISATION },
      user: { status: UserStatus.ACTIVE },
    },
    select: {
      user: { select: { id: true, email: true } },
      department: { select: { name: true } },
    },
    orderBy: { user: { email: 'asc' } },
    take: 500,
  });
  return {
    members: members.map((m) => ({
      id: m.user.id,
      email: m.user.email,
      departmentName: m.department?.name ?? null,
    })),
  };
}
