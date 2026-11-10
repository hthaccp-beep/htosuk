// Synthetic local documents for the isolated browser harness. No customer data.
const fs=require('node:fs'),path=require('node:path'),XLSX=require('xlsx');
const folder=path.resolve(__dirname,'../../../work/supplier-file-fixtures');fs.mkdirSync(folder,{recursive:true});
const rows=[{Code:'QA001',Description:'Sample rice',PackSize:'',Price:19,Unit:'CASE'},{Code:'QA002',Description:'Fresh Shanghai noodles – family pack',PackSize:'',Price:30,Unit:'CASE'},{Code:'UNKNOWN',Description:'Unknown item',PackSize:'12kg',Price:12,Unit:'KG'}];
const sheet=XLSX.utils.json_to_sheet(rows),book=XLSX.utils.book_new();XLSX.utils.book_append_sheet(book,sheet,'Prices');
XLSX.writeFile(book,path.join(folder,'Supplier-prices.xlsx'));XLSX.writeFile(book,path.join(folder,'Supplier-prices.xls'),{bookType:'biff8'});
fs.writeFileSync(path.join(folder,'Supplier-prices.csv'),XLSX.utils.sheet_to_csv(sheet));
fs.writeFileSync(path.join(folder,'HTOS-template.csv'),'SystemID,ItemCode,Name,PriceBox,PriceUnit\nqa-p,QA001,Sample rice,27,3');
fs.writeFileSync(path.join(folder,'Supplier-photo.png'),Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aRekAAAAASUVORK5CYII=','base64'));
const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 500 250] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',null,'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
const content='BT /F1 16 Tf 30 200 Td (SYNTHETIC SUPPLIER PRICE LIST) Tj 0 -35 Td (QA001 Sample rice: GBP 27 per case excl VAT) Tj ET';objects[3]=`<< /Length ${content.length} >>\nstream\n${content}\nendstream`;
let pdf='%PDF-1.4\n',offsets=[0];objects.forEach((object,i)=>{offsets.push(pdf.length);pdf+=`${i+1} 0 obj\n${object}\nendobj\n`;});const xref=pdf.length;pdf+='xref\n0 6\n0000000000 65535 f \n'+offsets.slice(1).map(n=>String(n).padStart(10,'0')+' 00000 n \n').join('')+`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
fs.writeFileSync(path.join(folder,'Supplier-prices.pdf'),pdf);fs.writeFileSync(path.join(folder,'failed-scan.pdf'),pdf);console.log(folder);
