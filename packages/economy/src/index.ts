import type { PackId } from "@helm/entity-graph";

export interface PackRevenueState {
  activeCustomers: number;
  averageMonthlyRevenue: number;
}

export interface EconomySnapshot {
  perPack: Record<PackId, PackRevenueState>;
  payroll: number;
  compute: number;
  compliance: number;
  marketing: number;
}

export const calculateMonthlyRevenue = (perPack: Record<PackId, PackRevenueState>) =>
  Object.values(perPack).reduce((sum, pack) => sum + pack.activeCustomers * pack.averageMonthlyRevenue, 0);

export const calculateBurnRate = (snapshot: EconomySnapshot) =>
  snapshot.payroll + snapshot.compute + snapshot.compliance + snapshot.marketing;

export const calculateValuation = (arr: number, trust: number, enterpriseMix: number) => {
  const arrMultiple = 8 + 17 * enterpriseMix;
  const trustMultiplier = 0.5 + Math.max(0, Math.min(1, trust / 100));
  return Number((arr * arrMultiple * trustMultiplier).toFixed(2));
};
