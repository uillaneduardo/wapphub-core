import http from "node:http";
import {Pool} from "pg";
const port=Number(process.env.PORT||3080);
const pool=process.env.DATABASE_URL?new Pool({connectionString:process.env.DATABASE_URL,connectionTimeoutMillis:2500}):null;
const send=(res,status,body)=>{res.writeHead(status,{"content-type":"application/json; charset=utf-8","cache-control":"no-store","x-content-type-options":"nosniff"});res.end(JSON.stringify(body))};
const server=http.createServer(async(req,res)=>{
  const path=new URL(req.url,"http://localhost").pathname;
  if(req.method==="GET"&&(path==="/health/live"||path==="/api/v1/health/live"))return send(res,200,{status:"alive",service:"wapphub-core-next"});
  if(req.method==="GET"&&(path==="/health/ready"||path==="/api/v1/health/ready")){
    if(!pool)return send(res,503,{status:"not_ready",reason:"DATABASE_URL missing"});
    try{await pool.query("select 1");return send(res,200,{status:"ready"})}
    catch{return send(res,503,{status:"not_ready"})}
  }
  // Fail closed: identity, tenant authorization, and conversation endpoints are not
  // exposed until the authentication and SQL transaction milestones are implemented.
  return send(res,404,{error:{code:"not_found",message:"Rota indisponível"}});
});
server.listen(port,"0.0.0.0",()=>console.log(JSON.stringify({service:"wapphub-core-next",port,status:"started"})));
const shutdown=async()=>{server.close();await pool?.end();};
process.on("SIGTERM",()=>{void shutdown()});
process.on("SIGINT",()=>{void shutdown()});
