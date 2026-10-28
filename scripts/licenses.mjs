import {readFile,readdir,writeFile,mkdir,copyFile} from 'node:fs/promises';
import {join} from 'node:path';
const lock=JSON.parse(await readFile('package-lock.json','utf8'));const inventory=[];
await mkdir('docs/third-party-licenses',{recursive:true});
for(const [path,entry] of Object.entries(lock.packages)){
 if(!path||entry.dev||entry.optional)continue;
 let pkg;try{pkg=JSON.parse(await readFile(join(path,'package.json'),'utf8'));}catch{continue;}
 const files=await readdir(path);const notices=files.filter(name=>/^(license|licence|copying|notice)(\.|$)/i.test(name));const copied=[];
 for(const name of notices){const dest=`${pkg.name.replace(/[@/]/g,'_')}-${pkg.version}-${name}`;try{await copyFile(join(path,name),join('docs/third-party-licenses',dest));copied.push(dest);}catch{}}
 inventory.push({name:pkg.name,version:pkg.version,license:pkg.license??entry.license??'REVIEW',repository:typeof pkg.repository==='string'?pkg.repository:pkg.repository?.url??null,notices:copied});
}
inventory.sort((a,b)=>a.name.localeCompare(b.name));await writeFile('docs/dependency-licenses.json',JSON.stringify(inventory,null,2)+'\n');
const unknown=inventory.filter(i=>i.license==='REVIEW');console.log(`Inventoried ${inventory.length} production dependencies and copied their available notices. ${unknown.length} need license metadata review.`);if(unknown.length)process.exitCode=1;
