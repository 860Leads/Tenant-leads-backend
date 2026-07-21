const EMPLOYMENT_TENURE_BANDS = new Set([
  'under_6_months',
  '6_months_to_1_year',
  '1_to_2_years',
  '2_plus_years',
  'unsure',
]);

function daysUntil(dateString) {
  const target = new Date(dateString);
  if (Number.isNaN(target.getTime())) return null;
  const now = new Date();
  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.round((target.setHours(0, 0, 0, 0) - now.setHours(0, 0, 0, 0)) / msPerDay);
}

function scoreIncome(monthlyIncome, config) {
  const rent = config.scoring.defaultMonthlyRent;
  if (!monthlyIncome || monthlyIncome <= 0) {
    return { points: 0, max: 2, ratio: null, reason: 'No income provided' };
  }
  const ratio = monthlyIncome / rent;
  const { strong, acceptable } = config.scoring.incomeToRentRatio;
  if (ratio >= strong) {
    return { points: 2, max: 2, ratio, reason: `Income is ${ratio.toFixed(1)}x rent (>= ${strong}x)` };
  }
  if (ratio >= acceptable) {
    return { points: 1, max: 2, ratio, reason: `Income is ${ratio.toFixed(1)}x rent (>= ${acceptable}x)` };
  }
  return { points: 0, max: 2, ratio, reason: `Income is only ${ratio.toFixed(1)}x rent` };
}

function scoreEmploymentTenure(employmentTenure, config) {
  const band = EMPLOYMENT_TENURE_BANDS.has(employmentTenure) ? employmentTenure : 'unsure';
  const points = config.scoring.employmentTenurePoints[band];
  return { points, max: 2, band, reason: `Employment tenure: ${band}` };
}

function scoreTimeline(moveInDate, config) {
  const days = daysUntil(moveInDate);
  const { strong, acceptable } = config.scoring.moveInDaysThreshold;
  if (days === null) {
    return { points: 0, max: 2, days: null, reason: 'No valid move-in date provided' };
  }
  if (days <= strong) {
    return { points: 2, max: 2, days, reason: `Move-in in ${days} day(s) (<= ${strong})` };
  }
  if (days <= acceptable) {
    return { points: 1, max: 2, days, reason: `Move-in in ${days} day(s) (<= ${acceptable})` };
  }
  return { points: 0, max: 2, days, reason: `Move-in is ${days} day(s) out` };
}

/**
 * Scores a tenant lead into GREEN / YELLOW / RED based on income-to-rent
 * ratio, employment tenure (stability signal), and move-in timeline.
 * Credit is checked separately by the landlord through his residential
 * screening portal, so it isn't part of this score.
 */
function scoreTenant(lead, config) {
  const income = scoreIncome(Number(lead.monthlyIncome), config);
  const employment = scoreEmploymentTenure(lead.employmentTenure, config);
  const timeline = scoreTimeline(lead.moveInDate, config);

  const totalPoints = income.points + employment.points + timeline.points;
  const maxPoints = income.max + employment.max + timeline.max;
  const { green, yellow } = config.scoring.bandThresholds;

  let band;
  if (totalPoints >= green) band = 'GREEN';
  else if (totalPoints >= yellow) band = 'YELLOW';
  else band = 'RED';

  return {
    band,
    totalPoints,
    maxPoints,
    breakdown: { income, employment, timeline },
  };
}

module.exports = { scoreTenant };
