export interface SeedUser {
  id: string;
  username: string;
  displayName: string;
  role: string;
  active: boolean;
  branchId?: string;
  email?: string;
}

export interface SeedBranch {
  id: string;
  name: string;
  code: string;
  email: string;
  active: boolean;
}

export const SEED_BRANCHES: SeedBranch[] = []; // No business records in source control.

export const SEED_USERS: SeedUser[] = []; // No business records in source control.
