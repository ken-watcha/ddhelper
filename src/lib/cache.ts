/**
 * 간단한 서버측 인메모리 캐시
 * - Vercel 서버리스는 warm start에서만 유지됨 (몇 분)
 * - 같은 입력 재시도나 연속 사용 시에 큰 효과
 * - TTL 기본 10분
 *
 * 개발 환경(NODE_ENV=development)에서는 비활성화: 코드 변경 시
 * 옛 결과가 무한 반환되는 디버깅 함정 방지.
 */
interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry<unknown>>();
const DEFAULT_TTL_MS = 10 * 60 * 1000; // 10분
const CACHE_ENABLED = process.env.NODE_ENV === "production";

export function getCache<T>(key: string): T | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (entry.expiresAt < Date.now()) {
    cache.delete(key);
    return null;
  }
  return entry.value as T;
}

export function setCache<T>(key: string, value: T, ttlMs = DEFAULT_TTL_MS): void {
  cache.set(key, {
    value,
    expiresAt: Date.now() + ttlMs,
  });

  // 메모리 누수 방지: 캐시가 너무 커지면 오래된 것 삭제
  if (cache.size > 100) {
    const now = Date.now();
    for (const [k, v] of cache.entries()) {
      if (v.expiresAt < now) cache.delete(k);
    }
  }
}

/**
 * 문자열에서 안정적인 해시 생성 (간단 FNV-1a)
 */
export function hashString(s: string): string {
  let hash = 2166136261;
  for (let i = 0; i < s.length; i++) {
    hash ^= s.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

export async function withCache<T>(
  key: string,
  fn: () => Promise<T>,
  ttlMs?: number
): Promise<{ value: T; cached: boolean }> {
  if (!CACHE_ENABLED) {
    const value = await fn();
    return { value, cached: false };
  }
  const cached = getCache<T>(key);
  if (cached !== null) {
    return { value: cached, cached: true };
  }
  const value = await fn();
  setCache(key, value, ttlMs);
  return { value, cached: false };
}
