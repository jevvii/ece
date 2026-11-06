const monthDay = new Intl.DateTimeFormat("en-PH", {
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});

export function formatRange(start: string, end: string) {
  return `${monthDay.format(new Date(`${start}T00:00:00Z`))} – ${monthDay.format(
    new Date(`${end}T00:00:00Z`),
  )}`;
}

export function patternLabel(patternCode: string) {
  switch (patternCode) {
    case "26_10":
      return "26–10";
    case "01_15":
      return "1–15";
    default:
      return "custom";
  }
}
