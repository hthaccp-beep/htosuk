// Recipe content is independent of its screen and printed layout.
export const RECIPE_UNITS = ['g', 'kg', 'ml', 'l', 'each', 'portion'] as const;
export type RecipeUnit = typeof RECIPE_UNITS[number];
export type RecipeKind = 'dish' | 'preparation';
export interface ProductChoice {
  productId: string;
  supplierId: string;
  productName: string;
  supplierName: string;
  itemCode: string;
  packSize: string;
  note: string;
}
export interface RecipeIngredient {
  id: string;
  name: string;
  quantity: number | null;
  unit: RecipeUnit | '';
  source: 'product' | 'preparation';
  preferred: ProductChoice | null;
  alternatives: ProductChoice[];
  preparationId: string;
  preparationName: string;
  note: string;
}
export interface RecipeContent {
  id: string;
  code: string;
  name: string;
  category: string;
  kind: RecipeKind;
  photo: string;
  yieldQuantity: number | null;
  yieldUnit: RecipeUnit | '';
  portions: number | null;
  ingredients: RecipeIngredient[];
  method: string;
  plating: string;
  notes: string;
  sourceReference: string;
}
export interface Recipe extends RecipeContent {
  version: number;
  status: 'draft' | 'approved';
  allergenStatus: 'not_reviewed';
  updatedAt: string;
  updatedBy: string;
  updatedByName: string;
  approvedAt: string;
  approvedByName: string;
  dependencyHash: string;
}
export interface RecipeSummary {
  id: string; code: string; name: string; category: string; kind: RecipeKind;
  version: number; status: 'draft' | 'approved'; updatedAt: string;
}
export interface MenuProduct {
  id: string; supplierId: string; name: string; itemCode: string; packSize: string;
}
export interface Specification {
  id: string; productId: string; supplierId: string; fileName: string;
  mime: string; bytes: number; specificationDate: string; note: string;
  uploadedAt: string; uploadedByName: string; status: 'unreviewed'; checksum: string;
}
export interface RecipeDetail { recipe: Recipe; sourceChanged: boolean; issues: string[] }
export function newIngredient(): RecipeIngredient {
  return {id: crypto.randomUUID(), name: '', quantity: null, unit: '', source: 'product', preferred: null,
    alternatives: [], preparationId: '', preparationName: '', note: ''};
}
export function newRecipe(kind: RecipeKind = 'dish'): RecipeContent {
  return {id: crypto.randomUUID(), code: '', name: '', category: '', kind, photo: '', yieldQuantity: null,
    yieldUnit: '', portions: null, ingredients: [], method: '', plating: '', notes: '', sourceReference: ''};
}
// Transcribed from the supplied workbook, Standard Recipe!A4:D15. No inferred quantities or products.
export function greenSaladExample(): RecipeContent {
  return {...newRecipe(), code: 'S1', name: 'Green Salad', category: 'Salads',
    ingredients: ['Mixed Leaves', 'Tomatoes', 'Avocado', 'Cucumber', 'Wakame', 'Wafu Dressing']
      .map(name => ({...newIngredient(), name})),
    sourceReference: 'HT Standard Recipe Cards_3.xlsx · Standard Recipe!A4:D15',
    notes: 'Source draft. Confirm the complete recipe, quantities and exact supplier products before approval.'};
}
// User-selected example from Standard Recipe!A1029:D1042; no inferred quantities or product links.
export function tofuVegetableRamenExample(): RecipeContent {
  return {...newRecipe(), code: 'N2', name: 'Tofu & Vegetable Ramen',
    ingredients: ['Ramen Noodle', 'Tofu', 'Rapeseed Flower', 'Ajitsuke Menma', 'Kikurage Fungus', 'Spring Onion', 'Seaweed', 'Creamy Ramen Soup']
      .map(name => ({...newIngredient(), name})),
    sourceReference: 'HT Standard Recipe Cards_3.xlsx · Standard Recipe!A1029:D1042'};
}
export function recipeGaps(recipe: RecipeContent): string[] {
  const missing: string[] = [];
  if (!recipe.category.trim()) missing.push('Add a category.');
  if (!recipe.yieldQuantity || !recipe.yieldUnit) missing.push('Add the usable batch yield and unit.');
  if (!recipe.portions) missing.push('Add the number of portions.');
  if (!recipe.method.trim()) missing.push('Add the preparation method.');
  if (recipe.kind === 'dish' && !recipe.plating.trim()) missing.push('Add plating instructions.');
  if (!recipe.ingredients.length) missing.push('Add the ingredients.');
  for (const [index, row] of recipe.ingredients.entries()) {
    const label = row.name || `Ingredient ${index + 1}`;
    if (!row.name.trim()) missing.push(`${label}: add a name.`);
    if (!row.quantity || !row.unit) missing.push(`${label}: add a quantity and unit.`);
    if (row.source === 'product' && !row.preferred) missing.push(`${label}: select a supplier product.`);
    if (row.source === 'preparation' && !row.preparationId) missing.push(`${label}: select a preparation recipe.`);
  }
  return missing;
}
export const SPEC_MAX_BYTES = 2 * 1024 * 1024;
export const SPEC_EXTENSIONS = ['pdf', 'xlsx', 'xls', 'docx', 'doc', 'csv', 'txt', 'png', 'jpg', 'jpeg'] as const;
