// Sihti Eye v2 benchmark. Gates are fixed in PREREG_V2.md.
// usage: node tests/benchmark_v2.cjs dev   (the four bundled photos, for debugging)
//        node tests/benchmark_v2.cjs test  (all 200 BSDS500 test-split photos)
"use strict";
const fs=require("node:fs"),path=require("node:path");
global.window=global;
require("../data/patch_bsds.js");
require("../eye.js");
const E=global.SihtiEyeCore;
const {pngDecode,resizeGray}=require("./image_io.cjs");
const which=process.argv[2]||"dev";
const model=E.preparePatch(global.SIHTI_PATCH_DATA);

function images(){
  if(which==="dev")return ["42049","8023","108082","196073"].map(id=>({id,img:resizeGray(pngDecode(fs.readFileSync(path.join(__dirname,"..","data","photo_"+id+".png"))))}));
  const b=fs.readFileSync(path.join(__dirname,"..","data","bsds_test_96x64.bin")),n=b.readUInt32LE(0),out=[];let o=4;
  for(let k=0;k<n;k++){const id=String(b.readUInt32LE(o));o+=4;const img=new Float32Array(96*64);
    for(let i=0;i<img.length;i++){img[i]=b.readUInt16LE(o)/65535;o+=2;}out.push({id,img});}
  return out;
}
// name -> [policy, options]
const RUNS={
  "coarse+edge (no memory)":["edge",{base:"coarse"}],
  "coarse+r3energy (no memory)":["r3energy",{base:"coarse"}],
  "coarse+random (no memory)":["random",{base:"coarse"}],
  "P3+random":["random",{}],
  "P3+edge":["edge",{}],
  "P3+r3energy":["r3energy",{}],
  "P3+disagree":["disagree",{}],
  "P3+feedback (v1)":["feedback",{}],
  "P3+feedback2":["feedback2",{}],
  "P3+oracle (ceiling)":["oracle",{}],
  "P3+random+gain":["random",{gain:true}],
  "P3+edge+gain":["edge",{gain:true}],
  "P3+disagree+gain":["disagree",{gain:true}],
  "P3+feedback2+gain":["feedback2",{gain:true}],
};
const rows=[],t0=Date.now(),gainLog=[];
for(const {id,img} of images()){
  const sc=E.reconstruct(img,96,64,model);
  const r={id,coarse:E.psnr(sc.given,sc.truth),p3:E.psnr(sc.pred,sc.truth),at:{}};
  const ora=E.simulate2(sc,"oracle",{});
  for(const [name,[pol,opt]] of Object.entries(RUNS)){
    const s=E.simulate2(sc,pol,opt);
    if(!opt.gain&&opt.base!=="coarse")s.history.forEach((v,i)=>{if(v>ora.history[i]+1e-6)throw Error("G5 oracle bound failed "+id+" "+name+" "+i);});
    if(opt.gain){if(!s.gains.flat().every(Number.isFinite))throw Error("G5 non-finite gain "+id);if(name==="P3+disagree+gain")gainLog.push(s.gains[s.gains.length-1]);}
    r.at[name]={5:s.history[5],10:s.history[10],20:s.history[20]};
  }
  rows.push(r);
  if(rows.length%25===0)console.log(rows.length,"photos",((Date.now()-t0)/1000).toFixed(0)+"s");
}
const mean=(f)=>rows.reduce((s,r)=>s+f(r),0)/rows.length;
const at=(name,k=20)=>r=>r.at[name][k];
function boot(f,B=4000){ // 95% bootstrap CI of a per-photo mean difference
  const v=rows.map(f),n=v.length;let s=12345;const rnd=()=>((s=(Math.imul(s,1103515245)+12345)>>>0)/4294967296);
  const ms=[];for(let b=0;b<B;b++){let t=0;for(let i=0;i<n;i++)t+=v[Math.floor(rnd()*n)];ms.push(t/n);}
  ms.sort((a,b)=>a-b);return [ms[Math.floor(.025*B)],ms[Math.floor(.975*B)]];
}
function diff(a,b){const f=r=>r.at[a][20]-r.at[b][20];return {mean:mean(f),ci95:boot(f),wins:rows.filter(r=>f(r)>0).length/rows.length};}
const table={};table["coarse only"]={5:mean(r=>r.coarse),10:mean(r=>r.coarse),20:mean(r=>r.coarse)};table["P3, no looks"]={5:mean(r=>r.p3),10:mean(r=>r.p3),20:mean(r=>r.p3)};
for(const n of Object.keys(RUNS))table[n]={5:mean(at(n,5)),10:mean(at(n,10)),20:mean(at(n,20))};
const G={
  G1_disagree_minus_random:diff("P3+disagree","P3+random"),
  G2_disagree_minus_edge:diff("P3+disagree","P3+edge"),
  G3_feedback2_minus_disagree:diff("P3+feedback2","P3+disagree"),
  G4_gain_minus_pasteonly:diff("P3+disagree+gain","P3+disagree"),
};
G.G1_pass=G.G1_disagree_minus_random.mean>=0.5;
G.G2_pass=G.G2_disagree_minus_edge.mean>=0.2&&G.G2_disagree_minus_edge.wins>=0.55;
G.G3_pass=G.G3_feedback2_minus_disagree.mean>=0.1;
G.G4_pass=G.G4_gain_minus_pasteonly.mean>=0.2;
G.G5_pass=true;
const gm=[0,1,2].map(k=>gainLog.reduce((s,g)=>s+g[k],0)/gainLog.length);
console.log("\nMean PSNR (dB) over",rows.length,which,"photos, after 5 / 10 / 20 looks");
for(const [n,v] of Object.entries(table))console.log("  "+n.padEnd(30),v[5].toFixed(2),v[10].toFixed(2),v[20].toFixed(2));
console.log("\nfinal gains (r2, r1, r0), mean over photos:",gm.map(x=>x.toFixed(3)).join(", "));
for(const [k,v] of Object.entries(G))console.log(k,typeof v==="boolean"?v:`mean ${v.mean.toFixed(3)} dB, 95% CI [${v.ci95.map(x=>x.toFixed(3)).join(", ")}], wins ${(100*v.wins).toFixed(0)}%`);
fs.mkdirSync(path.join(__dirname,"..","results"),{recursive:true});
fs.writeFileSync(path.join(__dirname,"..","results","v2_"+which+".json"),JSON.stringify({experiment:"Sihti Eye v2",set:which,n:rows.length,table,gates:G,mean_final_gains_r2_r1_r0:gm,per_photo:rows},null,1)+"\n");
