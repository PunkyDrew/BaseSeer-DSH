// Published rates and calendar are dated facts, not live billing telemetry.
export const deepSeekPricingSource =
  "https://api-docs.deepseek.com/quick_start/pricing/";
export const deepSeekHolidaySource =
  "https://www.gov.cn/zhengce/zhengceku/202511/content_7047091.htm";
export const deepSeekPricingAsOf = "2026-09-23";
const holidays2026 = [
  ["01-01", "01-03"],
  ["02-15", "02-23"],
  ["04-04", "04-06"],
  ["05-01", "05-05"],
  ["06-19", "06-21"],
  ["09-25", "09-27"],
  ["10-01", "10-07"],
];
export const deepSeekRates = [
  {
    model: "deepseek-flash",
    offPeak: [0.003, 0.15, 0.6],
    peak: [0.006, 0.3, 1.2],
  },
  {
    model: "deepseek-v4-pro",
    offPeak: [0.022, 0.66, 1.98],
    peak: [0.044, 1.32, 3.96],
  },
];
export function deepSeekPeriod(now: number): "peak" | "off-peak" | "unknown" {
  if (!Number.isFinite(now)) return "unknown";
  const date = new Date(now),
    day = date.getUTCDay(),
    hour = date.getUTCHours();
  if (
    day === 0 ||
    day === 6 ||
    !((hour >= 1 && hour < 4) || (hour >= 6 && hour < 10))
  )
    return "off-peak";
  // Candidate peak hours are 09:00–18:00 in China, on the same calendar date.
  if (date.getUTCFullYear() !== 2026) return "unknown";
  const md = date.toISOString().slice(5, 10);
  return holidays2026.some(([start, end]) => md >= start && md <= end)
    ? "off-peak"
    : "peak";
}
export function deepSeekPricing(now = Date.now()) {
  const period = deepSeekPeriod(now);
  let nextChange: string | null = null;
  let nextPeriod: string | null = null;
  for (
    let hour = Math.floor(now / 3600000) + 1;
    hour < now / 3600000 + 24 * 15;
    hour++
  ) {
    const next = deepSeekPeriod(hour * 3600000);
    if (next !== period) {
      nextChange = new Date(hour * 3600000).toISOString();
      nextPeriod = next;
      break;
    }
  }
  return {
    period,
    nextChange,
    nextPeriod,
    checkedAt: new Date(now).toISOString(),
    asOf: deepSeekPricingAsOf,
    source: deepSeekPricingSource,
    holidaySource: deepSeekHolidaySource,
    rates: deepSeekRates,
  };
}
