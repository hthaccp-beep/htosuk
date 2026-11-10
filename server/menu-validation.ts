import {createHash} from 'node:crypto';
import type {RecipeContent, ProductChoice, RecipeUnit} from '../shared/menu-recipes.ts';
import {RECIPE_UNITS, SPEC_MAX_BYTES} from '../shared/menu-recipes.ts';

export class MenuError extends Error {
  status: number;
  constructor(message: string, status = 400) { super(message); this.status = status; }
}
export function menuId(value: unknown): string {
  if (typeof value !== 'string' || !/^[\w-]{1,100}$/.test(value)) throw new MenuError('Invalid record reference.');
  return value;
}
export function textValue(value: unknown, label: string, max = 200, required = false): string {
  if (value == null && !required) return '';
  if (typeof value !== 'string' || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) throw new MenuError(`${label} is invalid or too long.`);
  const clean = value.trim();
  if (required && !clean) throw new MenuError(`Enter ${label.toLowerCase()}.`);
  return clean;
}
function amount(value: unknown): number | null {
  if (value == null || value === '') return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value > 1000000) throw new MenuError('Quantities must be greater than zero and no more than 1,000,000.');
  return value;
}
function unit(value: unknown): RecipeUnit | '' {
  if (value == null || value === '') return '';
  if (!RECIPE_UNITS.includes(value as RecipeUnit)) throw new MenuError('Choose a supported unit.');
  return value as RecipeUnit;
}
function productChoice(value: any): ProductChoice {
  if (!value || typeof value !== 'object') throw new MenuError('Choose a supplier product.');
  return {productId: menuId(value.productId), supplierId: menuId(value.supplierId), productName: '', supplierName: '', itemCode: '', packSize: '', note: textValue(value.note, 'Product note', 500)};
}
export function validateRecipe(value: any): RecipeContent {
  if (!value || typeof value !== 'object') throw new MenuError('Enter a recipe.');
  const code = textValue(value.code, 'Recipe code', 30, true).toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9_-]{0,29}$/.test(code)) throw new MenuError('Use letters, numbers, hyphens or underscores for the recipe code.');
  if (!['dish', 'preparation'].includes(value.kind)) throw new MenuError('Choose a dish or preparation recipe.');
  if (!Array.isArray(value.ingredients) || value.ingredients.length > 60) throw new MenuError('Use up to 60 ingredient rows per recipe.');
  const ingredients = value.ingredients.map((row: any) => {
    if (!row || !['product', 'preparation'].includes(row.source) || !Array.isArray(row.alternatives) || row.alternatives.length > 8) throw new MenuError('Invalid ingredient or too many alternatives (maximum eight).');
    const preferred = row.source === 'product' && row.preferred ? productChoice(row.preferred) : null;
    const alternatives = row.source === 'product' ? row.alternatives.map(productChoice) : [];
    const ids = [preferred, ...alternatives].filter(Boolean).map((p: any) => p.productId);
    if (ids.length !== new Set(ids).size) throw new MenuError('A product can appear only once in an ingredient’s choices.');
    if (!preferred && alternatives.length) throw new MenuError('Select a preferred product before adding alternatives.');
    return {id: menuId(row.id), name: textValue(row.name, 'Ingredient name', 160), quantity: amount(row.quantity), unit: unit(row.unit),
      source: row.source, preferred, alternatives, preparationId: row.source === 'preparation' && row.preparationId ? menuId(row.preparationId) : '',
      preparationName: '', note: textValue(row.note, 'Ingredient note', 1000)};
  });
  if (new Set(ingredients.map((r: any) => r.id)).size !== ingredients.length) throw new MenuError('Ingredient row references must be unique.');
  const photo = textValue(value.photo, 'Photograph', 350000);
  if (photo) {
    const match = photo.match(/^data:image\/(jpeg|png);base64,([A-Za-z0-9+/]+={0,2})$/);
    if (!match) throw new MenuError('Use a JPG or PNG photograph, up to 250 KB.');
    const bytes = Buffer.from(match[2], 'base64');
    if (bytes.length > 250 * 1024 || !imageSignature(bytes, match[1])) throw new MenuError('Invalid photograph. Use a JPG or PNG up to 250 KB.');
  }
  return {id: menuId(value.id), code, name: textValue(value.name, 'Recipe name', 160, true), kind: value.kind,
    category: textValue(value.category, 'Category', 100), photo, yieldQuantity: amount(value.yieldQuantity), yieldUnit: unit(value.yieldUnit),
    portions: amount(value.portions), ingredients, method: textValue(value.method, 'Method', 12000), plating: textValue(value.plating, 'Plating', 5000),
    notes: textValue(value.notes, 'Notes', 5000), sourceReference: textValue(value.sourceReference, 'Source reference', 500)};
}
function imageSignature(bytes: Buffer, kind: string) {
  return kind === 'png' ? bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])) : bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
}
export function digest(value: unknown) { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
export function validateSpecification(body: any) {
  const fileName = textValue(body.fileName, 'File name', 180, true);
  if (/[\\/<>:"|?*]/.test(fileName) || fileName.startsWith('.')) throw new MenuError('Use a simple file name without folder paths.');
  const extension = fileName.split('.').pop()!.toLowerCase();
  const types: Record<string,string> = {pdf:'application/pdf',xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',xls:'application/vnd.ms-excel',docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',doc:'application/msword',csv:'text/csv',txt:'text/plain',png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg'};
  if (!types[extension]) throw new MenuError('Use PDF, Excel, Word, CSV, TXT, JPG or PNG.');
  if (typeof body.base64 !== 'string' || body.base64.length > Math.ceil(SPEC_MAX_BYTES / 3) * 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(body.base64)) throw new MenuError('Choose a non-empty specification file, up to 2 MB.');
  const bytes = Buffer.from(body.base64, 'base64');
  if (!bytes.length || bytes.length > SPEC_MAX_BYTES || bytes.toString('base64') !== body.base64) throw new MenuError('The file is invalid or larger than 2 MB.');
  const start = bytes.subarray(0,8).toString('hex');
  if (extension === 'pdf' && bytes.subarray(0,5).toString() !== '%PDF-' ||
      ['xlsx','docx'].includes(extension) && !start.startsWith('504b0304') ||
      ['xls','doc'].includes(extension) && start !== 'd0cf11e0a1b11ae1' ||
      ['png','jpg','jpeg'].includes(extension) && !imageSignature(bytes,extension === 'png' ? 'png' : 'jpeg') ||
      ['csv','txt'].includes(extension) && (bytes.includes(0) || start.startsWith('4d5a'))) throw new MenuError('The file contents do not match its file type.');
  const specificationDate = textValue(body.specificationDate, 'Specification date', 10);
  if (specificationDate && (!/^\d{4}-\d{2}-\d{2}$/.test(specificationDate) || new Date(specificationDate+'T00:00:00Z').toISOString().slice(0,10) !== specificationDate)) throw new MenuError('Enter a valid specification date.');
  return {fileName, mime: types[extension], bytes: bytes.length, specificationDate, note: textValue(body.note, 'Specification note', 1000),
    checksum: createHash('sha256').update(bytes).digest('hex'), base64: body.base64 as string};
}
