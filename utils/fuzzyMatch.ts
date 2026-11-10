import { Product } from '../types';

/**
 * Normalizes a product name or description for comparison.
 */
export function normalizeText(text: string): string {
  if (!text) return '';
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Calculates Dice's coefficient (bigram similarity) between two strings.
 * Returns a value between 0 and 1.
 */
export function calculateSimilarity(str1: string, str2: string): number {
  const s1 = normalizeText(str1);
  const s2 = normalizeText(str2);

  if (s1 === s2) return 1.0;
  if (s1.length < 2 || s2.length < 2) {
    return s1 === s2 ? 1.0 : 0;
  }

  // Create character bigrams
  const getBigrams = (str: string) => {
    const bigrams = new Map<string, number>();
    for (let i = 0; i < str.length - 1; i++) {
      const bigram = str.substring(i, i + 2);
      bigrams.set(bigram, (bigrams.get(bigram) || 0) + 1);
    }
    return bigrams;
  };

  const b1 = getBigrams(s1);
  const b2 = getBigrams(s2);

  let intersectionSize = 0;
  b1.forEach((count1, bigram) => {
    if (b2.has(bigram)) {
      intersectionSize += Math.min(count1, b2.get(bigram)!);
    }
  });

  const totalLength = (s1.length - 1) + (s2.length - 1);
  return (2.0 * intersectionSize) / totalLength;
}

/**
 * Token-based Jaccard similarity (word-level).
 */
export function calculateTokenSimilarity(str1: string, str2: string): number {
  const tokens1 = new Set(normalizeText(str1).split(' ').filter(Boolean));
  const tokens2 = new Set(normalizeText(str2).split(' ').filter(Boolean));

  if (tokens1.size === 0 || tokens2.size === 0) return 0;

  let intersection = 0;
  tokens1.forEach(t => {
    if (tokens2.has(t)) intersection++;
  });

  const union = new Set([...tokens1, ...tokens2]).size;
  return union > 0 ? intersection / union : 0;
}

export interface MatchResult {
  product: Product;
  score: number; // 0 - 100
  exactCodeMatch: boolean;
  matchType: 'EXACT_CODE' | 'EXACT_NAME' | 'HIGH_CONFIDENCE' | 'POSSIBLE_DUPLICATE' | 'LOW';
}

/**
 * Finds matching existing products for a given detected raw item.
 */
export function findBestProductMatches(
  rawName: string,
  rawCode: string | undefined,
  products: Product[],
  supplierId?: string
): MatchResult[] {
  const normRawName = normalizeText(rawName);
  const cleanRawCode = rawCode?.trim().toLowerCase();

  // Prefer supplier products if specified, but include all for duplicate check
  const candidateProducts = supplierId 
    ? [...products.filter(p => p.supplierId === supplierId), ...products.filter(p => p.supplierId !== supplierId)]
    : products;

  const results: MatchResult[] = [];

  for (const product of candidateProducts) {
    const isSameSupplier = !supplierId || product.supplierId === supplierId;
    const cleanProdCode = product.itemCode?.trim().toLowerCase();
    
    // 1. Check exact itemCode match
    if (cleanRawCode && cleanProdCode && cleanRawCode === cleanProdCode && isSameSupplier) {
      results.push({
        product,
        score: 100,
        exactCodeMatch: true,
        matchType: 'EXACT_CODE'
      });
      continue;
    }

    // 2. Check exact name match
    const normProdName = normalizeText(product.name);
    if (normRawName === normProdName) {
      results.push({
        product,
        score: 98,
        exactCodeMatch: false,
        matchType: 'EXACT_NAME'
      });
      continue;
    }

    // 3. Fuzzy similarity (Combined Dice + Token)
    const diceSim = calculateSimilarity(rawName, product.name);
    const tokenSim = calculateTokenSimilarity(rawName, product.name);
    const combinedScore = Math.round(((diceSim * 0.6) + (tokenSim * 0.4)) * 100);

    if (combinedScore >= 40) {
      let matchType: MatchResult['matchType'] = 'LOW';
      if (combinedScore >= 80) matchType = 'HIGH_CONFIDENCE';
      else if (combinedScore >= 50) matchType = 'POSSIBLE_DUPLICATE';

      results.push({
        product,
        score: combinedScore,
        exactCodeMatch: false,
        matchType
      });
    }
  }

  // Sort descending by score
  return results.sort((a, b) => b.score - a.score);
}
