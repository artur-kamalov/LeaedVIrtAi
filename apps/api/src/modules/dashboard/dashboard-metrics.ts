const convertedStatuses = new Set(["BOOKED", "ORDERED"]);

export function dashboardUtcWeekdayTrend(
  leads: readonly { status: string; createdAt: Date; bookedAt: Date | null }[],
  start: Date,
  end: Date,
) {
  return Array.from({ length: 7 }, (_, weekday) => {
    const leadsForDay = leads.filter(
      (lead) =>
        lead.createdAt >= start &&
        lead.createdAt < end &&
        (lead.createdAt.getUTCDay() + 6) % 7 === weekday,
    );
    return {
      weekday,
      leads: leadsForDay.length,
      booked: leadsForDay.filter(
        (lead) => lead.bookedAt !== null || convertedStatuses.has(lead.status),
      ).length,
    };
  });
}
