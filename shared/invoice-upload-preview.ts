export function validateInvoiceUploadFile(file:{size:number;type:string},evidence=false){
 if(file.size<=0||file.size>3*1024*1024||!(evidence?['image/jpeg','image/png']:['image/jpeg','image/png','application/pdf']).includes(file.type))throw new Error(evidence?'Choose a JPEG or PNG photo up to 3 MB.':'Choose a JPEG, PNG or PDF up to 3 MB.');
}
export function canUploadInvoicePreview(hasFile:boolean,checked:boolean,busy:boolean){return hasFile&&checked&&!busy;}
