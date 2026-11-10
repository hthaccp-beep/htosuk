import {writeFile,mkdir} from 'node:fs/promises';
import {generateOrderPDF} from '../utils/orderEmail.ts';
import {generatePackingSlipPDF} from '../utils/packingSlipPdf.ts';
import {generateCreditClaimPdf} from '../utils/creditClaimPdf.ts';
const branch:any={id:'qa',name:'Sample branch',address:'123 Sample Road, London',contactPerson:'QA reviewer',contactPhone:'02000000000',email:'qa@example.invalid'};
const supplier:any={id:'qa',name:'Sample supplier',contactName:'QA team'};
const order:any={id:'audit-00000001',status:'PLACED',branchId:'qa',supplierId:'qa',branchNameSnapshot:branch.name,supplierNameSnapshot:supplier.name,orderedByNameSnapshot:'QA',createdAt:'2026-10-11T12:00:00Z',deliveryDate:'2026-10-14',items:Array.from({length:18},(_,i)=>({productId:'p'+i,productNameSnapshot:['Rice','Noodles','Soy sauce'][i%3]+' '+(i+1),caseQty:2,packQty:1,casePriceSnapshot:10,packPriceSnapshot:2})),manualItems:[]};
const claim:any={cnRef:'CN-QA-01',claimDate:'2026-10-11',invoiceNumber:'QA-INVOICE',invoiceDate:'2026-10-11',emailStatus:'PENDING',totalClaimAmount:20,items:[{id:'c',description:'Rice shortage',issueType:'SHORTAGE',orderedQtyStr:'10 Box',deliveredQtyStr:'8 Box',expectedPrice:10,invoicedPrice:10,claimAmount:20}]};
const folder='../../work/audit-pdfs';await mkdir(folder,{recursive:true});
for(const [name,base64] of [['purchase-order',await generateOrderPDF(order,branch,supplier)],['packing-list',generatePackingSlipPDF(order,supplier.name)],['credit-request',generateCreditClaimPdf(claim,branch,supplier).base64]]){
 await writeFile(`${folder}/${name}.pdf`,Buffer.from(base64,'base64'));
}
console.log('Generated three synthetic QA PDFs using the application renderers.');
