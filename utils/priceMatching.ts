import type { Product, Supplier, PriceMonitoringSettings } from '../types.ts';

/**
 * Calculates string similarity using Bigram / Dice's Coefficient (0 to 100)
 */
export function stringSimilarity(str1: string, str2: string): number {
  const s1 = (str1 || '').trim().toLowerCase().replace(/[^a-z0-9]/g, ' ');
  const s2 = (str2 || '').trim().toLowerCase().replace(/[^a-z0-9]/g, ' ');

  if (s1 === s2) return 100;
  if (s1.length < 2 || s2.length < 2) {
    return s1 === s2 ? 100 : 0;
  }

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

  let intersection = 0;
  b1.forEach((count, bigram) => {
    if (b2.has(bigram)) {
      intersection += Math.min(count, b2.get(bigram)!);
    }
  });

  const total = (s1.length - 1) + (s2.length - 1);
  return Math.round((2.0 * intersection / total) * 100);
}

/**
 * Token overlap score between two product strings (0 to 100)
 */
export function tokenOverlapScore(query: string, target: string): number {
  const qTokens = (query || '').toLowerCase().split(/[\s,./\-_()]+/).filter(t => t.length > 1);
  const tTokens = new Set((target || '').toLowerCase().split(/[\s,./\-_()]+/).filter(t => t.length > 1));

  if (qTokens.length === 0 || tTokens.size === 0) return 0;

  let matched = 0;
  for (const token of qTokens) {
    if (tTokens.has(token)) {
      matched++;
    } else {
      // Check partial match for tokens of length > 3
      for (const t of tTokens) {
        if (t.length > 3 && (t.includes(token) || token.includes(t))) {
          matched += 0.7;
          break;
        }
      }
    }
  }

  return Math.min(100, Math.round((matched / Math.max(qTokens.length, 1)) * 100));
}

export interface MatchedResult {
  product: Product | null;
  confidence: number;
  matchReason: 'EXACT_CODE' | 'NAME_MATCH' | 'FUZZY_MATCH' | 'NONE';
  possibleDuplicates: Array<{
    product: Product;
    score: number;
  }>;
}

/**
 * Finds the best product match in the system for an extracted item line
 */
export function matchExtractedItem(
  rawDescription: string,
  itemCode: string | undefined,
  supplierId: string | undefined,
  products: Product[]
): MatchedResult {
  const cleanCode = (itemCode || '').trim().toUpperCase();
  const cleanDesc = (rawDescription || '').trim();

  // Filter products by supplier if supplier is known, otherwise search all active products
  // R07: When supplierId is specified, MUST stay within selected supplier even if zero active products.
  // NEVER fall back to entire catalogue of other suppliers!
  const targetPool = supplierId 
    ? products.filter(p => p.active && p.supplierId === supplierId)
    : products.filter(p => p.active);

  if (targetPool.length === 0) {
    return {
      product: null,
      confidence: 0,
      matchReason: 'NONE',
      possibleDuplicates: [],
    };
  }

  // 1. Exact Item Code Match (First and highest priority)
  if (cleanCode) {
    const exactCode = targetPool.find(
      p => (p.itemCode || '').trim().toUpperCase() === cleanCode
    );
    if (exactCode) {
      return {
        product: exactCode,
        confidence: 99,
        matchReason: 'EXACT_CODE',
        possibleDuplicates: [],
      };
    }
  }

  // 2. Name Matching
  // SAFEGUARD: If the line item HAS a supplier product code (e.g. Q0052), but no catalog item
  // shares that code, any name matches (e.g. against Q0156) are POTENTIAL DUPLICATES or suggestions,
  // NOT automatic matches! They must remain separate products.
  let bestProduct: Product | null = null;
  let highestScore = 0;
  const scoredList: Array<{ product: Product; score: number }> = [];

  // Check how many products share exact name in the pool
  const exactNameMatches = targetPool.filter(
    p => p.name.trim().toLowerCase() === cleanDesc.toLowerCase()
  );

  if (exactNameMatches.length === 1 && !cleanCode) {
    // Only one product with this name AND no conflicting extracted code
    return {
      product: exactNameMatches[0],
      confidence: 95,
      matchReason: 'NAME_MATCH',
      possibleDuplicates: [],
    };
  }

  for (const product of targetPool) {
    const prodCode = (product.itemCode || '').trim().toUpperCase();
    
    // If extracted item has a code and this product has a DIFFERENT code, do not allow automatic high-confidence match
    const codeConflict = cleanCode && prodCode && cleanCode !== prodCode;

    const diceScore = stringSimilarity(cleanDesc, product.name);
    const tokenScore = tokenOverlapScore(cleanDesc, product.name);
    let combinedScore = Math.round(diceScore * 0.4 + tokenScore * 0.6);

    if (codeConflict) {
      // Penalize combined score because product codes differ!
      combinedScore = Math.min(combinedScore, 65);
    }

    scoredList.push({ product, score: combinedScore });

    if (combinedScore > highestScore && !codeConflict) {
      highestScore = combinedScore;
      bestProduct = product;
    }
  }

  // Sort possible duplicates by score descending
  scoredList.sort((a, b) => b.score - a.score);
  const topDuplicates = scoredList.filter(s => s.score >= 40).slice(0, 5);

  // If there are multiple exact name matches (e.g. two Ajinomoto Gyoza with different codes),
  // require manual confirmation rather than guessing!
  if (exactNameMatches.length > 1) {
    return {
      product: null,
      confidence: 60,
      matchReason: 'NONE',
      possibleDuplicates: exactNameMatches.map(p => ({ product: p, score: 90 })),
    };
  }

  // If code is present but wasn't matched in catalog, do not auto-match by name
  if (cleanCode) {
    return {
      product: null,
      confidence: highestScore,
      matchReason: 'NONE',
      possibleDuplicates: topDuplicates,
    };
  }

  // Confidence thresholds:
  // >= 78% combined score is considered confident match (when no code was provided)
  if (highestScore >= 78 && bestProduct) {
    return {
      product: bestProduct,
      confidence: highestScore,
      matchReason: 'FUZZY_MATCH',
      possibleDuplicates: topDuplicates.filter(d => d.product.id !== bestProduct?.id),
    };
  }

  // Not confident enough -> Mark as unrecognised/new, but include possible duplicates for warning!
  return {
    product: null,
    confidence: highestScore,
    matchReason: 'NONE',
    possibleDuplicates: topDuplicates,
  };
}

export interface PriceComparisonResult {
  hasPriceChange: boolean;
  isFirstPrice?: boolean;
  oldPrice: number;
  newPrice: number;
  priceDiff: number;
  percentChange: number;
  priceType: 'CASE' | 'PACK';
  significantAlert: boolean;
  caseChanged?: boolean;
  packChanged?: boolean;
  oldCasePrice?: number;
  newCasePrice?: number;
  oldPackPrice?: number;
  newPackPrice?: number;
}

/**
 * Compares detected price against official recorded price with independent case & pack checks
 */
export function comparePrices(
  detectedCasePrice: number | undefined,
  detectedPackPrice: number | undefined,
  product: Product,
  settings?: PriceMonitoringSettings
): PriceComparisonResult {
  const threshold = settings?.alertOnPercentageThreshold ?? 5;

  const validCaseDetected = typeof detectedCasePrice === 'number' && Number.isFinite(detectedCasePrice) && detectedCasePrice > 0;
  const validPackDetected = typeof detectedPackPrice === 'number' && Number.isFinite(detectedPackPrice) && detectedPackPrice > 0;

  const currentCase = Math.round((product.casePrice || 0) * 100) / 100;
  const currentPack = Math.round((product.packPrice || 0) * 100) / 100;

  const newCase = validCaseDetected ? Math.round(detectedCasePrice * 100) / 100 : currentCase;
  const newPack = validPackDetected ? Math.round(detectedPackPrice * 100) / 100 : currentPack;

  const caseChanged = validCaseDetected && (currentCase === 0 || Math.abs(newCase - currentCase) >= 0.01);
  const packChanged = validPackDetected && (currentPack === 0 || Math.abs(newPack - currentPack) >= 0.01);

  const caseDiff = validCaseDetected ? Math.round((newCase - currentCase) * 100) / 100 : 0;
  const packDiff = validPackDetected ? Math.round((newPack - currentPack) * 100) / 100 : 0;

  const hasPriceChange = caseChanged || packChanged;
  const isFirstPrice = (currentCase === 0 && validCaseDetected) || (currentPack === 0 && validPackDetected);

  // Primary diff for headline display (prefer case price change if present)
  let oldPrice = currentCase;
  let newPrice = newCase;
  let priceDiff = caseDiff;
  let priceType: 'CASE' | 'PACK' = 'CASE';

  if (!caseChanged && packChanged) {
    oldPrice = currentPack;
    newPrice = newPack;
    priceDiff = packDiff;
    priceType = 'PACK';
  } else if (!validCaseDetected && validPackDetected) {
    oldPrice = currentPack;
    newPrice = newPack;
    priceDiff = packDiff;
    priceType = 'PACK';
  }

  const percentChange = oldPrice > 0 
    ? Math.round(((newPrice - oldPrice) / oldPrice) * 1000) / 10 
    : (newPrice > 0 ? 100 : 0);
  const significantAlert = isFirstPrice || Math.abs(percentChange) >= threshold;

  return {
    hasPriceChange,
    isFirstPrice,
    oldPrice,
    newPrice,
    priceDiff,
    percentChange,
    priceType,
    significantAlert,
    caseChanged,
    packChanged,
    oldCasePrice: currentCase,
    newCasePrice: validCaseDetected ? newCase : undefined,
    oldPackPrice: currentPack,
    newPackPrice: validPackDetected ? newPack : undefined,
  };
}
