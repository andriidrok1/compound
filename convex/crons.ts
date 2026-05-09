import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Evening check-in: 22:00 user-local (UTC-7 for SF) → 05:00 UTC
crons.daily(
  "evening check-in",
  { hourUTC: 5, minuteUTC: 0 },
  internal.agent.eveningCheckIn,
);

// Overnight research: 03:00 SF (UTC-7) → 10:00 UTC
crons.daily(
  "overnight research run 1",
  { hourUTC: 10, minuteUTC: 0 },
  internal.agent.overnightResearch,
);

// Second overnight pass: 06:00 SF → 13:00 UTC
crons.daily(
  "overnight research run 2",
  { hourUTC: 13, minuteUTC: 0 },
  internal.agent.overnightResearch,
);

// Morning recap: 07:30 SF → 14:30 UTC
crons.daily(
  "morning recap",
  { hourUTC: 14, minuteUTC: 30 },
  internal.agent.morningRecap,
);

export default crons;
