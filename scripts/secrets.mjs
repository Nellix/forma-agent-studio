import {randomBytes} from 'node:crypto';
import {writeFile,mkdir,access} from 'node:fs/promises';
const k8s=process.argv.includes('--k8s');
const file=k8s?'deploy/k8s/secret.env':'.env';
try{await access(file);throw new Error(`${file} already exists. Keep existing keys to preserve encrypted credentials. Move it yourself if you intend to initialize a different environment.`);}catch(e){if(e.code!=='ENOENT')throw e;}
const password=randomBytes(24).toString('hex');
const lines=[`POSTGRES_PASSWORD=${password}`,`STUDIO_ADMIN_TOKEN=${randomBytes(32).toString('hex')}`,`STUDIO_RUNNER_TOKEN=${randomBytes(32).toString('hex')}`,`ENCRYPTION_KEY=${randomBytes(32).toString('hex')}`];
if(k8s)lines.push(`DATABASE_URL=postgresql://studio:${password}@postgres:5432/agentstudio`);
else lines.push('DATABASE_URL=pglite://.data/studio','DEMO_MODE=true','EMBEDDED_WORKER=true','HOST=127.0.0.1','PORT=3000','COOKIE_SECURE=false','HTTP_ALLOWED_HOSTS=');
await writeFile(file,lines.join('\n')+'\n',{mode:0o600,flag:'wx'});
console.log(`Wrote ${file}. It is excluded from Git. Keep a secure backup; the encryption key is needed to restore credentials.`);
console.log('Use the STUDIO_ADMIN_TOKEN value from this file to sign in.');
