import React from 'react';
import type {CatalogueValidationError} from '../../shared/catalogue-errors';

export function CatalogueValidationNotice({error}:{error:CatalogueValidationError}) {
  const rows=new Set(error.issues.flatMap(i=>i.row===undefined?[]:[i.row]));
  return <section className="h-csv-errors" role="alert" aria-label="File issues">
    <h4>{error.issues.length} {error.issues.length===1?'issue':'issues'} found{rows.size?` across ${rows.size} ${rows.size===1?'row':'rows'}`:''}</h4>
    <p>Nothing has been saved. Correct the issues below, then choose the corrected file.</p>
    <div className="h-csv-error-list" tabIndex={0} role="region" aria-label="All detected file issues">
      <ol>{error.issues.map((issue,index)=><li key={index}>
        <strong>{issue.row?`Row ${issue.row}`:'File'}{issue.field?` · ${issue.field}`:''}</strong>
        <span>{issue.message.replace(/^(?:CSV )?Row \d+:?\s*/, '')}</span>
      </li>)}</ol>
    </div>
    <p className="h-csv-check-scope">{error.stage==='structure'
      ?'The file structure needs correcting before product values and saved-product matches can be checked.'
      :error.stage==='file'
        ?'All product rows were checked for file errors. Saved-product matches and permissions will be checked after these errors are corrected.'
        :'All product rows were checked against this supplier’s catalogue. Checks that depend on invalid values or unresolved product choices will run again after correction.'} Row numbers count the heading as row 1 and exclude empty rows.</p>
  </section>;
}
