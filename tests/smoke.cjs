// Native Node.js smoke/regression checks. No npm dependencies.
"use strict";
const assert=require("node:assert/strict");
global.window=global;
require("../data/patch_bsds.js");
require("../eye.js");
const E=global.SihtiEyeCore;
let n=0;function test(name,f){f();console.log("PASS "+name);n++;}
test("Original exported memory has 512 experts and expected tensors",()=>{
  const m=E.preparePatch(global.SIHTI_PATCH_DATA);
  assert.equal(m.K,512);
  assert.equal(m.bands[0].centers.length,512*25);
  assert.equal(m.bands[0].weights.length,512*26*16);
});
const w=16,h=16,img=Float32Array.from({length:w*h},(_,k)=>{
  const x=k%w,y=(k/w)|0;return 0.35+0.2*Math.cos(x*0.7)+0.15*Math.sin(y*0.4);
});
test("Sihti bands telescope back to the input (lossless)",()=>{
  const bs=E.sieve(img,w,h);
  let mx=0;
  for(let i=0;i<img.length;i++){let sum=0;for(const b of bs)sum+=b[i];mx=Math.max(mx,Math.abs(sum-img[i]));}
  assert.ok(mx<1e-5,"max reconstruction error "+mx);
});
const model=E.preparePatch(global.SIHTI_PATCH_DATA),scene=E.reconstruct(img,w,h,model);
test("P3 full coarse-to-fine reconstruction is finite",()=>{
  assert.equal(scene.stages.length,4);
  assert.ok(scene.pred.every(Number.isFinite));
  assert.ok(scene.unc.every(Number.isFinite));
  assert.ok(Number.isFinite(E.psnr(scene.pred,img)));
});
test("Only oracle may read unobserved true error",()=>{
  const v=[
    {index:0,tx:0,ty:0,edge:1,disagreement:0.5,get error(){throw Error("Truth leaked")}},
    {index:1,tx:1,ty:0,edge:0,disagreement:2,get error(){throw Error("Truth leaked")}}
  ];
  for(const p of ["fixed","random","edge","disagree","feedback"]){
    assert.ok(E.selectNext(p,v,new Set(),[],17));
  }
});
test("Every observer has equal observation budget, PSNR never decreases",()=>{
  const policies=["fixed","random","edge","disagree","feedback","oracle"];
  for(const p of policies){
    const r=E.simulate(scene,p,4,17);
    assert.equal(r.history.length,5);
    assert.equal(new Set(r.selected.map(t=>t.index)).size,4);
    for(let i=1;i<r.history.length;i++)assert.ok(r.history[i]+1e-10>=r.history[i-1],p+" step "+i);
  }
});
test("Oracle tile ranking is an optimal upper bound for fixed-size independent reveals",()=>{
  for(const p of ["fixed","random","edge","disagree","feedback"]){
    const a=E.simulate(scene,p,4,17).history,oracle=E.simulate(scene,"oracle",4,17).history;
    for(let i=0;i<a.length;i++)assert.ok(oracle[i]+1e-7>=a[i],p+" step "+i);
  }
});
console.log(n+" tests passed.");
