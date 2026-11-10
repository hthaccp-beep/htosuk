import {spawnSync} from 'node:child_process';
for(const script of ['admin-workflow-smoke','order-scope-smoke','order-list-smoke','product-invoice-smoke']){
  const result=spawnSync(process.execPath,['--import','tsx',`scripts/${script}.ts`],{stdio:'inherit',env:process.env});
  if(result.status!==0)process.exit(result.status||1);
}
