/**
 * WSF singles court, metres. Axes: x across the court (0 = left side wall when
 * facing the front wall), y up, z from the front wall (0) to the back wall.
 */
export const COURT = {
  length: 9.75,
  width: 6.4,
  ceiling: 5.64,
  lineWidth: 0.05,
  /** Lower edge of the out line on the front wall; touching the line is out. */
  frontOut: 4.57,
  backOut: 2.13,
  /** Top edge of the service line on the front wall. */
  serviceLine: 1.78,
  /** Top of the tin; its upper 50 mm is the tin line. */
  tin: 0.48,
  /** Back edge of the short line, measured from the front wall (9.75 - 4.26). */
  shortLine: 5.49,
  serviceBox: 1.6,
  ballRadius: 0.02,
} as const;

/** Height of the side-wall out line at depth z (straight line from front to back). */
export function sideOutHeight(z: number): number {
  const t = Math.min(Math.max(z / COURT.length, 0), 1);
  return COURT.frontOut + (COURT.backOut - COURT.frontOut) * t;
}

export const T_POSITION = { x: COURT.width / 2, z: COURT.shortLine + 0.35 };
