// Deterministic Node-only baseline on bundled BSDS500 demo images.
// PNG reader supports 8-bit RGB/RGBA, filters 0-4. No npm packages.
"use strict";
const fs=require("node:fs"),path=require("node:path"),zlib=require("node:zlib");
global.window=global;
require("../data/patch_bsds.js");
require("../eye.js");
const E=global.SihtiEyeCore;
function pngDecode(bytes){
  if(bytes.subarray(0,8).toString("hex")!=="89504e470d0a1a0a")throw Error("PNG signature");
  let width=0,height=0,type=0,bitDepth=0,pos=8,idat=[];
  while(pos<bytes.length){
    const size=bytes.readUInt32BE(pos),label=bytes.toString("ascii",pos+4,pos+8);
    const body=bytes.subarray(pos+8,pos+8+size);pos+=12+size;
    if(label==="IHDR"){width=body.readUInt32BE(0);height=body.readUInt32BE(4);bitDepth=body[8];type=body[9];}
    if(label==="IDAT")idat.push(body);
    if(label==="IEND")break;
  }
  if(bitDepth!==8 || (type!==2&&type!==6))throw Error("unsupported PNG "+type+" bit "+bitDepth);
  const channels=type===2?3:4, stride=width*channels,raw=zlib.inflateSync(Buffer.concat(idat));
  const result=Buffer.alloc(width*height*channels);let start=0;
  for(let y=0;y<height;y++){
    const filter=raw[start++],offset=y*stride;
    for(let x=0;x<stride;x++){
      const a=x>=channels?result[offset+x-channels]:0,b=y>0?result[offset-stride+x]:0;
      const c=(x>=channels&&y>0)?result[offset-stride+x-channels]:0;
      let pred=0;
      if(filter===1)pred=a;
      else if(filter===2)pred=b;
      else if(filter===3)pred=(a+b)>>1;
      else if(filter===4){
        const p=a+b-c,da=Math.abs(p-a),db=Math.abs(p-b),dc=Math.abs(p-c);
        pred=da<=db&&da<=dc?a:db<=dc?b:c;
      }else if(filter!==0)throw Error("PNG filter "+filter);
      result[offset+x]=(raw[start++]+pred)&255;
    }
  }
  return {width,height,channels,data:result};
}
function resizeGray(image,w=96,h=64){
  const out=new Float32Array(w*h),{width:srcW,height:srcH,channels,data}=image;
  const scale=Math.min(srcW/w,srcH/h),cw=w*scale,ch=h*scale;
  const offX=(srcW-cw)/2,offY=(srcH-ch)/2;
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    const sx=offX+(x+0.5)*cw/w-0.5,sy=offY+(y+0.5)*ch/h-0.5;
    const x0=Math.max(0,Math.floor(sx)),y0=Math.max(0,Math.floor(sy)),x1=Math.min(srcW-1,x0+1),y1=Math.min(srcH-1,y0+1);
    const tx=Math.min(1,Math.max(0,sx-x0)),ty=Math.min(1,Math.max(0,sy-y0));
    const v=(xx,yy)=>{
      const z=(yy*srcW+xx)*channels;
      return (0.2126*data[z]+0.7152*data[z+1]+0.0722*data[z+2])/255;
    };
    out[y*w+x]=(1-tx)*(1-ty)*v(x0,y0)+tx*(1-ty)*v(x1,y0)+(1-tx)*ty*v(x0,y1)+tx*ty*v(x1,y1);
  }
  return out;
}
const ids=["42049","8023","108082","196073"],policies=["fixed","random","edge","disagree","feedback","oracle"];
const model=E.preparePatch(global.SIHTI_PATCH_DATA),results=[];
for(const id of ids){
  const bytes=fs.readFileSync(path.join(__dirname,"..","data","photo_"+id+".png"));
  const png=pngDecode(bytes),img=resizeGray(png);
  const scene=E.reconstruct(img,96,64,model);
  const row={id,original_dimensions:[png.width,png.height],baseline_psnr:E.psnr(scene.pred,scene.truth),results:{}};
  const ora=E.simulate(scene,"oracle",20,17);
  for(const p of policies){
    const r=p==="oracle"?ora:E.simulate(scene,p,20,17);
    for(let i=0;i<r.history.length;i++)if(r.history[i]>ora.history[i]+1e-6)throw Error("oracle bound failed "+id+" "+p+" "+i);
    row.results[p]={after_4:r.history[4],after_10:r.history[10],after_20:r.history[20]};
  }
  results.push(row);
  console.log(id+" P3="+row.baseline_psnr.toFixed(2)+" | "+policies.map(p=>p+" "+row.results[p].after_20.toFixed(2)).join(" | "));
}
const mean={};for(const p of policies)mean[p]=Object.fromEntries(["after_4","after_10","after_20"].map(k=>[k,results.reduce((s,r)=>s+r.results[p][k],0)/results.length]));
const gain=p=>mean[p].after_20-mean.random.after_20;
const summary={experiment:"Sihti Eye v1 active observation",asset_source:"SihtiImageModel original BSDS500 held-out examples",
 note:"Node bilinear crop differs slightly from browser image resampling; results apply to these 4 images only.",
 image_size:[96,64],look_size:[8,8],look_budget:20,seed:17,results,mean,
 gates:{disagreement_over_random_dB:gain("disagree"),disagreement_pass:gain("disagree")>=0.5,
 feedback_over_disagreement_dB:mean.feedback.after_20-mean.disagree.after_20,
 feedback_pass:mean.feedback.after_20-mean.disagree.after_20>=0.1}};
fs.mkdirSync(path.join(__dirname,"..","results"),{recursive:true});
fs.writeFileSync(path.join(__dirname,"..","results","node_benchmark.json"),JSON.stringify(summary,null,2)+"\n");
console.log("MEAN after20: "+policies.map(p=>p+" "+mean[p].after_20.toFixed(2)).join(" | "));
console.log("GATES: "+JSON.stringify(summary.gates));
