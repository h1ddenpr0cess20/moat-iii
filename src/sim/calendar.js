import { MONTHS, SEASONS, WEEKS_PER_MONTH, WEEKS_PER_YEAR } from '../config.js';

/** The date of a week: week 0 is the first of March, and a year is forty-eight weeks. */
export function calendar(week) {
  const year = Math.floor(week / WEEKS_PER_YEAR) + 1;
  const inYear = week % WEEKS_PER_YEAR;
  const month = Math.floor(inYear / WEEKS_PER_MONTH);
  const season = Math.floor(month / 3);
  return {
    week, year, inYear, month, monthName: MONTHS[month], season, seasonName: SEASONS[season],
    weekInMonth: inYear % WEEKS_PER_MONTH, weekInSeason: inYear % (WEEKS_PER_MONTH * 3),
    /** How far through the year, 0 up to 1. */
    t: inYear / WEEKS_PER_YEAR,
  };
}

/** How cold it is for the hearth: 1 in the winter months, half in November and March, 0 otherwise. */
export function coldness(week) {
  const { month } = calendar(week);
  if (month >= 9) return 1;
  if (month === 8 || month === 0) return 0.5;
  return 0;
}

export const dateText = (week) => {
  const c = calendar(week);
  return `${c.monthName}, Year ${c.year}`;
};

