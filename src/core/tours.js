export const DEFAULT_TOUR_DURATION_MINUTES = 60;
export const DEFAULT_TOUR_REMINDER_MINUTES = 120;

export function normalizeTour(input = {}, preferences = {}) {
  const start = input.startsAt || input.start || input.showingAt || null;
  const startDate = start ? new Date(start) : null;
  const durationMinutes = Math.max(15, Number(input.durationMinutes || preferences.defaultTourDurationMinutes || DEFAULT_TOUR_DURATION_MINUTES));
  const explicitEnd = input.endsAt || input.end || null;
  const endsAt = explicitEnd
    ? new Date(explicitEnd)
    : startDate && !Number.isNaN(startDate.getTime())
      ? new Date(startDate.getTime() + durationMinutes * 60000)
      : null;
  const reminderMinutes = Math.max(0, Number(input.reminderMinutes ?? preferences.defaultTourReminderMinutes ?? DEFAULT_TOUR_REMINDER_MINUTES));
  return {
    id: input.id || input.calendarEventId || null,
    propertyId: input.propertyId || null,
    startsAt: startDate && !Number.isNaN(startDate.getTime()) ? startDate.toISOString() : null,
    endsAt: endsAt && !Number.isNaN(endsAt.getTime()) ? endsAt.toISOString() : null,
    durationMinutes,
    reminderMinutes,
    status: input.status || "confirmed",
    confidence: input.confidence || "confirmed",
    source: input.source || "manual",
    sourceMessageId: input.sourceMessageId || input.messageId || null,
    sourceThreadId: input.sourceThreadId || input.threadId || null,
    calendarEventId: input.calendarEventId || input.id || null,
    calendarUrl: input.calendarUrl || null,
    updatedAt: input.updatedAt || new Date().toISOString()
  };
}

export function tourForProperty(property = {}, preferences = {}) {
  const stored = property.metadata?.tour;
  if (stored?.startsAt) return normalizeTour({ ...stored, propertyId: property.id }, preferences);
  if (property.showingAt) return normalizeTour({ propertyId: property.id, startsAt: property.showingAt, source:"legacy" }, preferences);
  return null;
}

export function tourState(tour, now = new Date()) {
  if (!tour?.startsAt || ["cancelled","canceled"].includes(String(tour.status).toLowerCase())) return "none";
  const start = new Date(tour.startsAt);
  const end = new Date(tour.endsAt || start.getTime() + Number(tour.durationMinutes || 60) * 60000);
  const t = now instanceof Date ? now.getTime() : new Date(now).getTime();
  if (Number.isNaN(start.getTime()) || Number.isNaN(t)) return "none";
  if (t > end.getTime()) return "past";
  if (start.getTime() - t <= 24 * 60 * 60 * 1000) return "soon";
  return "upcoming";
}

export function tourLabel(tour, now = new Date()) {
  if (!tour?.startsAt) return "";
  const start = new Date(tour.startsAt);
  if (Number.isNaN(start.getTime())) return "";
  const today = new Date(now); today.setHours(0,0,0,0);
  const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate()+1);
  const tourDay = new Date(start); tourDay.setHours(0,0,0,0);
  const day = tourDay.getTime() === today.getTime() ? "Today"
    : tourDay.getTime() === tomorrow.getTime() ? "Tomorrow"
    : start.toLocaleDateString([], { weekday:"short", month:"short", day:"numeric" });
  return `${day} · ${start.toLocaleTimeString([], { hour:"numeric", minute:"2-digit" })}`;
}

export function upcomingTours(properties = [], preferences = {}, now = new Date()) {
  return properties.map(property => ({ property, tour: tourForProperty(property, preferences) }))
    .filter(item => item.tour && ["upcoming","soon"].includes(tourState(item.tour, now)))
    .sort((a,b) => new Date(a.tour.startsAt) - new Date(b.tour.startsAt));
}

export function applyTour(property = {}, tourInput = {}, preferences = {}) {
  const tour = normalizeTour({ ...tourInput, propertyId: property.id }, preferences);
  return {
    ...property,
    showingAt: tour.startsAt,
    status: tour.status === "cancelled" ? property.status : "showing-scheduled",
    contactOutcome: tour.status === "cancelled" ? "showing-cancelled" : "showing-scheduled",
    metadata: { ...(property.metadata || {}), tour }
  };
}
