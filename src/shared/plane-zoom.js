const ZOOM_PERCENT_SCALE = 100;

// Browser-like zoom policy for all panes. Values are stored as percentages so
// the bounds explain their UX intent instead of hiding decimals in callers.
const PLANE_ZOOM_DEFAULT_PERCENT = 100;
const PLANE_ZOOM_MIN_PERCENT = 67;
const PLANE_ZOOM_MAX_PERCENT = 180;
const PLANE_ZOOM_STEP_PERCENT = 10;

const PLANE_ZOOM_DEFAULT = PLANE_ZOOM_DEFAULT_PERCENT / ZOOM_PERCENT_SCALE;
const PLANE_ZOOM_MIN = PLANE_ZOOM_MIN_PERCENT / ZOOM_PERCENT_SCALE;
const PLANE_ZOOM_MAX = PLANE_ZOOM_MAX_PERCENT / ZOOM_PERCENT_SCALE;
const PLANE_ZOOM_STEP = PLANE_ZOOM_STEP_PERCENT / ZOOM_PERCENT_SCALE;

const PLANE_ZOOM_POLICY = Object.freeze({
  PLANE_ZOOM_DEFAULT,
  PLANE_ZOOM_MIN,
  PLANE_ZOOM_MAX,
  PLANE_ZOOM_STEP,
  PLANE_ZOOM_DEFAULT_PERCENT,
  PLANE_ZOOM_MIN_PERCENT,
  PLANE_ZOOM_MAX_PERCENT,
  PLANE_ZOOM_STEP_PERCENT,
});

function clampZoomFactor(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return PLANE_ZOOM_DEFAULT;
  return Math.min(PLANE_ZOOM_MAX, Math.max(PLANE_ZOOM_MIN, number));
}

function zoomDeltaForDirection(direction) {
  if (direction === "in" || Number(direction) > 0) return PLANE_ZOOM_STEP;
  if (direction === "out" || Number(direction) < 0) return -PLANE_ZOOM_STEP;
  return 0;
}

module.exports = {
  PLANE_ZOOM_DEFAULT,
  PLANE_ZOOM_MAX,
  PLANE_ZOOM_MIN,
  PLANE_ZOOM_POLICY,
  PLANE_ZOOM_STEP,
  clampZoomFactor,
  zoomDeltaForDirection,
};
