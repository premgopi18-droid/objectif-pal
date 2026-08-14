import { describe, expect, it } from "vitest";
import { createTaskQueue } from "./repair-queue";

/**
 * La file de réparation (#177) : jamais plus de N tâches en vol, ordre FIFO,
 * et une tâche qui échoue libère quand même son créneau.
 */
describe("createTaskQueue", () => {
  it("borne la concurrence à N et exécute tout, dans l'ordre d'arrivée", async () => {
    const run = createTaskQueue(2);
    let inFlight = 0;
    let peak = 0;
    const started: number[] = [];
    const gates: (() => void)[] = [];

    const tasks = [0, 1, 2, 3, 4].map((index) =>
      run(async () => {
        inFlight++;
        peak = Math.max(peak, inFlight);
        started.push(index);
        await new Promise<void>((resolve) => gates.push(resolve));
        inFlight--;
        return index;
      }),
    );

    // Deux tâches démarrent, pas plus — les suivantes attendent leur créneau.
    await Promise.resolve();
    expect(started).toEqual([0, 1]);
    while (gates.length > 0 || started.length < 5) {
      gates.shift()?.();
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    expect(await Promise.all(tasks)).toEqual([0, 1, 2, 3, 4]);
    expect(peak).toBe(2);
    expect(started).toEqual([0, 1, 2, 3, 4]);
  });

  it("une tâche qui jette libère son créneau", async () => {
    const run = createTaskQueue(1);
    await expect(run(async () => Promise.reject(new Error("boum")))).rejects.toThrow("boum");
    expect(await run(async () => "après")).toBe("après");
  });
});
