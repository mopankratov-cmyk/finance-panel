export function createLatestRequestGuard() {
  let generation = 0;
  return {
    begin(): number {
      generation += 1;
      return generation;
    },
    isCurrent(requestGeneration: number): boolean {
      return requestGeneration === generation;
    },
    invalidate(requestGeneration: number): void {
      if (requestGeneration === generation) generation += 1;
    },
  };
}
