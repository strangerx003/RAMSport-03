/** Fault-tree gate arithmetic. */

export type FtaGateType = "gate and" | "gate or" | "gate xor" | "gate not" | "gate vote";

function clamp01(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/** Q(t) = 1 - e^(-λt) for a constant failure rate. */
export function basicEventProbability(lambda: number, missionTime: number) {
  const rate = Math.max(0, lambda);
  const time = Math.max(0, missionTime);
  return clamp01(1 - Math.exp(-rate * time));
}

/** Probability that at least k of the independent inputs occur. */
export function atLeastK(probabilities: number[], k: number) {
  const n = probabilities.length;
  if (k <= 0) return 1;
  if (k > n) return 0;
  let dp = new Array<number>(n + 1).fill(0);
  dp[0] = 1;
  for (const raw of probabilities) {
    const p = clamp01(raw);
    const next = new Array<number>(n + 1).fill(0);
    for (let i = 0; i <= n; i += 1) {
      if (!dp[i]) continue;
      next[i] += dp[i] * (1 - p);
      if (i + 1 <= n) next[i + 1] += dp[i] * p;
    }
    dp = next;
  }
  let sum = 0;
  for (let i = Math.max(0, Math.trunc(k)); i <= n; i += 1) sum += dp[i];
  return clamp01(sum);
}

export function evaluateGate(type: FtaGateType | string, inputs: number[], k?: number) {
  const probabilities = inputs.map(clamp01);
  if (!probabilities.length) return 0;
  if (type === "gate and") return probabilities.reduce((result, value) => result * value, 1);
  if (type === "gate xor") {
    return probabilities.reduce(
      (total, value, index) =>
        total +
        value *
          probabilities.reduce((other, candidate, otherIndex) => other * (index === otherIndex ? 1 : 1 - candidate), 1),
      0,
    );
  }
  if (type === "gate not") return 1 - probabilities[0];
  if (type === "gate vote") return atLeastK(probabilities, k ?? Math.ceil(probabilities.length / 2));
  return 1 - probabilities.reduce((result, value) => result * (1 - value), 1);
}

export function gateFormula(type?: FtaGateType | string, k?: number) {
  if (!type) return "Q(t) = 1 - e^(-λt)";
  if (type === "gate and") return "AND: Q = Π Qi";
  if (type === "gate xor") return "XOR: Q = Σ[Qi Π(1 - Qj)]";
  if (type === "gate not") return "NOT: Q = 1 - Q1";
  if (type === "gate vote") return `VOTING: Q = binomial tail, k = ${k ?? "n"}`;
  return "OR: Q = 1 - Π(1 - Qi)";
}
