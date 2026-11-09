// Deterministic Node-only baseline on bundled BSDS500 demo images.
// PNG reader supports 8-bit RGB/RGBA, filters 0-4. No npm packages.
"use strict";
const fs=require("node:fs"),path=require("node:path");
global.window=global;
require("../data/patch_bsds.js");
require("../eye.js");
const E=global.SihtiEyeCore;
const {pngDecode,resizeGray}=require("./image_io.cjs");
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
