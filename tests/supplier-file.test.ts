import test from 'node:test';
import assert from 'node:assert/strict';
import {assessFileLine,initialMatchedSelection,selectedSupplierUpdates,catalogueFileLines,chooseFileSource,sortedSupplierProducts,filePrice,mapFileLines,matchFileItem,normalPack,priceWarnings,suggestColumns,verifyFileLines} from '../shared/supplier-file.ts';
const products:any[]=[{id:'rice',supplierId:'s',itemCode:'001',name:'Rice',chineseName:'大米',packSize:'6 x 1kg',casePrice:10,packPrice:2,active:true,unitType:'BOTH'},{id:'other',supplierId:'other',itemCode:'001',name:'Rice',casePrice:99}];
function line(row:any){return mapFileLines([row],suggestColumns(Object.keys(row)),products,'s')[0];}

test('supplier price matching ignores retired duplicate codes while respecting explicit IDs',()=>{
 const catalogue=[...products,{...products[0],id:'retired',active:false}];
 const source={systemId:'',code:'001',name:'Rice',packSize:'6 x 1kg',unit:''};
 assert.equal(matchFileItem(source,catalogue,'s').productId,'rice');
 assert.equal(matchFileItem({...source,systemId:'retired'},catalogue,'s').productId,'retired');
 assert.equal(matchFileItem(source,catalogue.map(p=>({...p,active:false})),'s').productId,'');
});

test('JFC headings map codes and case prices without interpreting order quantities as prices',()=>{
 const mapping=suggestColumns(['ITEMNO','ITEM DESCRIPTION','CASE PRICE','ORDER BY CASE','ORDER BY PIECE']);
 assert.equal(mapping.code,'ITEMNO');assert.equal(mapping.name,'ITEM DESCRIPTION');assert.equal(mapping.casePrice,'CASE PRICE');assert.equal(mapping.packPrice,'');
 assert.equal(mapFileLines([{'ITEMNO':'001','ITEM DESCRIPTION':'Rice','CASE PRICE':11}],mapping,products,'s')[0].productId,'rice');
});

test('local verification reports ready, warning, correction and unchanged rows without changing selection',()=>{
 const rows=[line({Code:'001',PriceBox:11}),line({Code:'001',PriceBox:30}),line({Code:'missing',PriceBox:12}),line({Code:'001',PriceBox:10})];
 const before=JSON.stringify(rows);
 assert.deepEqual(verifyFileLines(rows,products,'s','Supplier'),{ready:1,warnings:1,corrections:1,unchanged:1,unmatched:1});
 assert.equal(JSON.stringify(rows),before);
 assert.deepEqual(verifyFileLines(rows,[],'s','Supplier'),{ready:0,warnings:0,corrections:4,unchanged:0,unmatched:4});
});
test('supplier code and permanent ID match within chosen supplier; name is only a suggestion',()=>{
 assert.equal(line({Code:'001',Description:'Rice'}).productId,'rice');
 assert.equal(line({SystemID:'other',Code:'001'}).productId,'');
 assert.match(line({Description:'Rice',Pack:'6×1000g'}).reason,/suggestion/);
 assert.equal(line({Description:'Rice',Pack:'12x1kg'}).productId,'');
 assert.equal(normalPack('6 x 1 L'),normalPack('6×1000ml'));
 const duplicate=[...products,{...products[0],id:'duplicate'}];
 assert.equal(matchFileItem(line({Code:'001'}),duplicate,'s').productId,'');
});
test('generic price requires a known unit; line totals are never selected as prices',()=>{
 const row=line({Code:'001',Price:'12.50',Unit:'box',TotalPrice:125});assert.equal(row.casePrice,'12.50');assert.equal(row.packPrice,'');
 const unknown=line({Code:'001',UnitPrice:12.5,Unit:'KG'});assert.equal(unknown.casePrice,'');assert.equal(unknown.packPrice,'');
 assert.ok(assessFileLine(unknown,products,'s','Supplier').blocked.length);
 assert.equal(line({Code:'001',TotalPrice:125}).casePrice,'');
 const scan=line({itemCode:'001',rawDescription:'Rice',casePrice:12,packPrice:null,unitPrice:12,unitTypeDetected:'CASE'});assert.equal(scan.casePrice,'12');assert.equal(scan.packPrice,'');
});
test('all rows start unselected; warnings cover identity, packs, inactive items, scanner notes and currency',()=>{
 const row=line({Code:'001',Description:'Different rice',PackSize:'12kg',PriceBox:0,Notes:'Digit unclear',Supplier:'Different supplier',Currency:'EUR'});
 assert.equal(row.selected,false);const result=assessFileLine(row,products,'s','Supplier');
 assert.ok(result.blocked.some(f=>f.includes('GBP')));for(const text of ['Description','Pack size','£0.00','Digit unclear','Supplier'])assert.ok(result.flags.some(f=>f.includes(text)));
 assert.ok(assessFileLine(row,[{...products[0],active:false}],'s','Supplier').flags.some(f=>f.includes('Inactive')));
 assert.ok(assessFileLine({...row,reason:'Manually matched'},products,'s','Supplier').flags.some(f=>f.includes('manually')));
});
test('duplicate selected products block save and unchanged prices are identified',()=>{
 const row={...line({Code:'001',PriceBox:10}),selected:true};
 assert.equal(assessFileLine(row,products,'s','Supplier').unchanged,true);
 assert.ok(assessFileLine(row,products,'s','Supplier',[row,{...row,id:'another'}]).blocked.some(f=>f.includes('more than once')));
});
test('prices accept zero and valid GBP decimals; blanks preserve and malformed values reject',()=>{
 assert.equal(filePrice('£1,234.50'),1234.5);assert.equal(filePrice(''),undefined);assert.equal(filePrice(0),0);
 for(const value of ['1,25','-1','1e4','NaN','Infinity','$12','12 total','12.3.4'])assert.throws(()=>filePrice(value));
 assert.equal(priceWarnings({casePrice:10},{casePrice:11.99}).length,0);
 assert.ok(priceWarnings({casePrice:10},{casePrice:12})[0].includes('+20.0%'));
 assert.ok(priceWarnings({casePrice:10},{casePrice:8})[0].includes('-20.0%'));
 assert.ok(priceWarnings({casePrice:0},{casePrice:12})[0].includes('no positive'));
});


test('HTOS list is supplier scoped, naturally sorted by item code, including unmatched products',()=>{
 const catalogue=[{...products[0],id:'ten',itemCode:'A10'},{...products[0],id:'two',itemCode:'A2'},{...products[0],id:'nocode',itemCode:''},products[1]];
 assert.deepEqual(sortedSupplierProducts(catalogue,'s').map(p=>p.id),['two','ten','nocode']);
 const source=mapFileLines([{Code:'A10',PriceBox:11}],suggestColumns(['Code','PriceBox']),catalogue,'s');
 const rows=catalogueFileLines(source,catalogue,'s');
 assert.deepEqual(rows.map(r=>r.productId),['two','ten','nocode']);
 assert.equal(rows[0].sourceId,'');assert.equal(rows[1].sourceId,'0');assert.equal(rows[1].casePrice,'11');
 assert.ok(assessFileLine(rows[0],catalogue,'s','Supplier').blocked.includes('Choose a supplier-file item'));
});

test('duplicate file candidates require choice; changing source keeps HTOS identity and resets old values',()=>{
 const sources=mapFileLines([{Code:'001',PriceBox:11},{Code:'001',PriceUnit:4}],suggestColumns(['Code','PriceBox','PriceUnit']),products,'s');
 const row=catalogueFileLines(sources,products,'s')[0];
 assert.equal(row.sourceId,'');assert.match(row.reason,/Several/);
 const chosen=chooseFileSource({...row,selected:true,reviewed:true,casePrice:'999'},sources[1]);
 assert.equal(chosen.productId,'rice');assert.equal(chosen.id,'rice');assert.equal(chosen.sourceId,'1');
 assert.equal(chosen.casePrice,'');assert.equal(chosen.packPrice,'4');assert.equal(chosen.selected,false);assert.equal(chosen.reviewed,false);
 assert.equal(chooseFileSource(chosen).packPrice,'');assert.equal(chooseFileSource(chosen).sourceId,'');
 const duplicate={...chosen,id:'second',productId:'second',selected:true};
 assert.ok(assessFileLine(chosen,products,'s','Supplier',[{...chosen,selected:true},duplicate]).blocked.includes('Supplier-file item selected more than once'));
 assert.equal(products[0].casePrice,10);
});


test('matched updates select valid code matches including warnings, but leave inactive and unmatched items alone',()=>{
 const catalogue=[...products,{...products[0],id:'off',itemCode:'002',active:false},{...products[0],id:'no',itemCode:'003'}];
 const sources=mapFileLines([{Code:'001',PriceBox:20},{Code:'002',PriceBox:12}],suggestColumns(['Code','PriceBox']),catalogue,'s');
 const rows=initialMatchedSelection(catalogueFileLines(sources,catalogue,'s'),catalogue,'s','Supplier');
 assert.deepEqual(rows.map(r=>r.selected),[true,false,false]);
 assert.ok(assessFileLine(rows[0],catalogue,'s','Supplier').flags.length);
 assert.equal(selectedSupplierUpdates(rows,catalogue,'s','Supplier').length,1);
});

test('name edits keep permanent IDs and can be reviewed without a price change; blank names and duplicate sources block',()=>{
 const sources=mapFileLines([{Code:'001',PriceBox:10}],suggestColumns(['Code','PriceBox']),products,'s');
 const base=catalogueFileLines(sources,products,'s')[0];
 const renamed={...base,proposedName:' Brown rice ',selected:true};
 assert.equal(assessFileLine(renamed,products,'s','Supplier').unchanged,false);
 assert.deepEqual(selectedSupplierUpdates([renamed],products,'s','Supplier'),[{SystemID:'rice',Name:'Brown rice',PriceBox:10,PriceUnit:''}]);
 assert.throws(()=>selectedSupplierUpdates([{...renamed,proposedName:' '}],products,'s','Supplier'),/product name/);
 assert.throws(()=>selectedSupplierUpdates([{...base,selected:true}],products,'s','Supplier'),/changed/);
 assert.throws(()=>selectedSupplierUpdates([renamed,{...renamed,id:'duplicate'}],products,'s','Supplier'),/more than once/);
 assert.equal(chooseFileSource(renamed,sources[0]).proposedName,' Brown rice ');
 assert.equal(products[0].name,'Rice');
});
