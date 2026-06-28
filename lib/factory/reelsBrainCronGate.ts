export function reelsBrainTaskForCronTick(date = new Date()): "bulk" | "analyze" | null {
  const minute = date.getUTCMinutes();
  if (minute === 0) return "bulk";
  const slot = minute % 10;
  return slot === 2 || slot === 3 || slot === 6 || slot === 7 ? "analyze" : null;
}
