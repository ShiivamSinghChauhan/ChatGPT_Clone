export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

const DAY = 24 * 60 * 60 * 1000;

/** Sidebar bucket for a thread, based on its last activity. */
export function dateGroup(iso: string, now = new Date()): string {
  const t = new Date(iso);
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const time = t.getTime();
  if (Number.isNaN(time) || time >= startOfToday) return "Today";
  if (time >= startOfToday - DAY) return "Yesterday";
  if (time >= startOfToday - 7 * DAY) return "Previous 7 days";
  if (time >= startOfToday - 30 * DAY) return "Previous 30 days";
  return t.toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

export function errorMessage(err: unknown): string {
  return err instanceof Error && err.message ? err.message : "Something went wrong.";
}

export function cn(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(" ");
}
