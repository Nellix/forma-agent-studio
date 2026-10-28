import 'dotenv/config';
import {createServer} from 'node:http';
import {DB} from './db.js';
import {seed} from './service.js';
import {Engine} from './engine.js';
import {createApp} from './app.js';
const databaseUrl=process.env.DATABASE_URL??'pglite://.data/studio';
if(databaseUrl.startsWith('pglite://')&&process.argv.includes('--worker'))throw new Error('Separate workers require PostgreSQL. Use EMBEDDED_WORKER=true with PGlite.');
if(process.env.NODE_ENV==='production'&&databaseUrl.startsWith('pglite://'))throw new Error('Production deployments require PostgreSQL.');
const db=await new DB(databaseUrl).open();await seed(db);
const workerOnly=process.argv.includes('--worker');const engine=new Engine(db,Number(process.env.MAX_CONCURRENT_RUNS??4));
const withWorker=workerOnly||process.env.EMBEDDED_WORKER==='true';
let lastWorkerTick=Date.now();
let tick:ReturnType<typeof setInterval>|undefined;if(withWorker)tick=setInterval(()=>{void engine.tick().then(()=>{lastWorkerTick=Date.now();}).catch(e=>console.error('Worker polling failed:',e.message));},300);
let server:ReturnType<ReturnType<typeof createApp>['listen']>|undefined;
if(!workerOnly){const port=Number(process.env.PORT??3000);const host=process.env.HOST??'127.0.0.1';server=createApp(db).listen(port,host,()=>console.log(`Agent Studio listening on http://${host}:${port}`));}
else {server=createServer(async(req,res)=>{try{if(req.url==='/health/ready'){await db.query('SELECT 1');if(Date.now()-lastWorkerTick>60000)throw new Error('Worker polling stalled');}else if(req.url!=='/health/live'){res.writeHead(404);res.end();return;}res.writeHead(200,{'Content-Type':'application/json'});res.end('{"status":"ok"}');}catch{res.writeHead(503);res.end('{"status":"unavailable"}');}}).listen(Number(process.env.WORKER_HEALTH_PORT??3001),process.env.HOST??'127.0.0.1');console.log('Agent Studio worker ready');}
let closing=false;async function shutdown(){if(closing)return;closing=true;if(tick)clearInterval(tick);server?.close();await engine.stop();await db.close();process.exit(0);}process.on('SIGTERM',shutdown);process.on('SIGINT',shutdown);
