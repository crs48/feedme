export const frequencies = ['once', 'monthly', 'yearly'] as const;
export type BillingFrequency = typeof frequencies[number];
export const billingFrequency = (value: unknown): BillingFrequency => {
  if (value === undefined || value === '') return 'once';
  if (!frequencies.includes(value as BillingFrequency)) throw new Error('Choose one-time, monthly, or yearly support.');
  return value as BillingFrequency;
};
export const billingInterval = (frequency?: BillingFrequency) => frequency === 'monthly' ? 'month' : frequency === 'yearly' ? 'year' : undefined;
export const frequencyLabel = (frequency?: BillingFrequency) => frequency === 'monthly' ? 'Monthly' : frequency === 'yearly' ? 'Yearly' : 'One-time';
export const frequencySuffix = (frequency?: BillingFrequency) => frequency === 'monthly' ? ' / month' : frequency === 'yearly' ? ' / year' : '';
