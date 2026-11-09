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
// ---- v2 ----
test("v2 policies read no unobserved truth (feedback2 sees only observed tiles)",()=>{
  const v=[
    {index:0,tx:0,ty:0,edge:1,r3energy:1,disagreement:0.5,get error(){throw Error("Truth leaked")}},
    {index:1,tx:1,ty:0,edge:0,r3energy:0,disagreement:2,get error(){throw Error("Truth leaked")}},
    {index:2,tx:2,ty:0,edge:0,r3energy:0,disagreement:1,error:0.3}
  ];
  const seen=new Set([2]),observed=[v[2]];
  for(const p of ["r3energy","feedback2"])assert.ok(E.selectNext(p,v,seen,observed,17));
});
test("v2 gain fit depends only on revealed pixels",()=>{
  const W2=32,H2=32,im=Float32Array.from({length:W2*H2},(_,k)=>0.5+0.3*Math.sin(k*0.37)*Math.cos(k*0.011));
  const s1=E.reconstruct(im,W2,H2,model),revealed=[];
  for(let y=0;y<8;y++)for(let x=0;x<8;x++)revealed.push(y*W2+x);
  const g1=E.fitGains(s1,revealed);
  const s2={...s1,truth:Float32Array.from(s1.truth)};
  for(let i=0;i<s2.truth.length;i++)if(!revealed.includes(i))s2.truth[i]=Math.random();
  assert.deepEqual(E.fitGains(s2,revealed),g1);
  assert.deepEqual(E.fitGains(s1,[]),[1,1,1]);
  assert.ok(g1.every(g=>g>=0&&g<=2));
});
test("v2 paste-only runs never beat the oracle; gain runs stay finite",()=>{
  const ora=E.simulate2(scene,"oracle",{steps:4}).history;
  for(const p of ["random","edge","r3energy","disagree","feedback2"]){
    const a=E.simulate2(scene,p,{steps:4}).history;a.forEach((v,i)=>assert.ok(ora[i]+1e-7>=v,p+" "+i));
    const g=E.simulate2(scene,p,{steps:4,gain:true});assert.ok(g.history.every(Number.isFinite));
  }
});
console.log(n+" tests passed.");
