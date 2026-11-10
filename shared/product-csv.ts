import {CatalogueValidationError} from './catalogue-errors.ts';
// Legacy 2027 headings remain supported for import. New exports use editable/technical headings below.
export const productCSVBase = ['SystemID','ItemCode','Name','ChineseName','Category','PackSize','PriceBox','PriceUnit','DisplayOrder','Active'] as const;
export const productCSVExtra = ['VATRate','UnitType','CaseUnitName','PackUnitName','MinParLevel','TargetParLevel','CataloguePosition','BranchScope','SupplierID'] as const;
export const productCSVLegacy = ['CategoryID','AllowedBranchIds','Position'] as const;
// Version 2 presents a single human position. Legacy headings remain importable.
export const productCSVEditable = ['Position','ItemCode','Name','ChineseName','Category','PackSize','PriceBox','PriceUnit','Active','BranchScope'] as const;
export const productCSVTechnical = ['CSVVersion','SystemID','SupplierID'] as const;
export const decodeCSVText = (value:string) => /^'[=+\-@\t\r]/.test(value) ? value.slice(1) : value;

/** Blank markers inherit the explicitly selected supplier; a different marker never does. */
export function validateCSVSupplier(rows:Record<string,string>[],supplierId:string){
 const issues=rows.flatMap((row,index)=>row.SupplierID?.trim()&&row.SupplierID.trim()!==supplierId?[{row:index+2,field:'SupplierID',message:`Row ${index+2}: SupplierID does not match the selected supplier. Choose the correct supplier and keep the SupplierID column unchanged.`}]:[]);
 if(issues.length)throw new CatalogueValidationError(issues,'file');
}
