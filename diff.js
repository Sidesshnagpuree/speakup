// Word-level diff helpers for highlighting corrections and scoring "say it" practice.
const words = (s) => (s || '').trim().split(/\s+/).filter(Boolean);
const key = (w) => w.toLowerCase().replace(/[^\p{L}\p{N}']/gu, '');

function lcsTable(A, B) {
  const n = A.length, m = B.length;
  const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = key(A[i]) === key(B[j]) ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  return dp;
}

/** Tokens of `b` marked as changed (not present in `a` in the same order). */
export function markChanges(a, b) {
  const A = words(a), B = words(b);
  if (!B.length) return [];
  if (A.length * B.length > 40000) return B.map((w) => ({ w, changed: false }));
  const dp = lcsTable(A, B);
  const out = [];
  let i = 0, j = 0;
  while (j < B.length) {
    if (i < A.length && key(A[i]) === key(B[j])) { out.push({ w: B[j], changed: false }); i++; j++; }
    else if (i < A.length && dp[i + 1][j] >= dp[i][j + 1]) i++;
    else { out.push({ w: B[j], changed: !!key(B[j]) }); j++; }
  }
  return out;
}

/** 0–100: how closely `said` matches `target`, ignoring case and punctuation. */
export function similarity(said, target) {
  const A = words(said).filter((w) => key(w)), B = words(target).filter((w) => key(w));
  if (!A.length || !B.length) return 0;
  const dp = lcsTable(A, B);
  return Math.round((2 * dp[0][0]) / (A.length + B.length) * 100);
}

export const sameText = (a, b) => words(a).map(key).filter(Boolean).join(' ') === words(b).map(key).filter(Boolean).join(' ');
