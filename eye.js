/* Sihti Eye: active measurement over the original SihtiImageModel P3 patch memory.
   Source SihtiImageModel/sihti_model/{sieve,patch}.py, simplified to grayscale and
   a single fixed held-out image with revealed 8x8 truth tiles.
   No target pixels may enter a policy score except pixels explicitly revealed.
*/
(function(root){
"use strict";
const DEPTHS=[0,1,4,16,64], STRIDES={0:1,1:1,2:2,3:4}, P=4, G=5, EPS=0.02, TILE=8;
const POLICIES=["fixed","random","edge","disagree","feedback","feedback2","oracle"];
const max=(v,a,b)=>Math.max(a,Math.min(b,v));
function decode(o){
  const raw=atob(o.b64), bytes=new Uint8Array(raw.length);
  for(let i=0;i<raw.length;i++)bytes[i]=raw.charCodeAt(i);
  const n=o.shape.reduce((a,b)=>a*b,1), view=new DataView(bytes.buffer);
  if(bytes.length!==n*2)throw Error("Invalid quantized model shape");
  const a=new Float32Array(n);
  for(let i=0;i<n;i++)a[i]=view.getInt16(i*2,true)*o.scale;
  return a;
}
function preparePatch(json){
  if(json.K!==512)throw Error("Expected the original 512-expert P3 model");
  const bands={};
  for(let b=0;b<4;b++){
    const o=json.bands[b];
    if(o.C.shape[0]!==512||o.C.shape[1]!==25||o.W.shape.join(",")!=="512,26,16")throw Error("Unexpected P3 shape");
    bands[b]={centers:decode(o.C),weights:decode(o.W)};
  }
  return {K:json.K,bands};
}
function purify(x,w,h){
  const y=new Float32Array(x.length);
  for(let j=0;j<h;j++)for(let i=0;i<w;i++){
    const k=j*w+i,v=x[k];
    const l=x[j*w+Math.max(0,i-1)], r=x[j*w+Math.min(w-1,i+1)];
    const t=x[Math.max(0,j-1)*w+i],b=x[Math.min(h-1,j+1)*w+i];
    y[k]=v+0.25*(l+r+t+b-4*v);
  }
  return y;
}
function sieve(x,w,h){
  let cur=Float32Array.from(x),last=0;const states=[];
  for(const step of DEPTHS){while(last<step){cur=purify(cur,w,h);last++;}states.push(cur);}
  const bands=[];
  for(let k=0;k<4;k++){const d=new Float32Array(x.length);for(let i=0;i<x.length;i++)d[i]=states[k][i]-states[k+1][i];bands.push(d);}
  bands.push(states[4]);return bands;
}
function sum(a,b){const c=new Float32Array(a.length);for(let i=0;i<a.length;i++)c[i]=a[i]+b[i];return c;}
function grid(n){const x=[];for(let i=0;i<=n-P;i+=2)x.push(i);if(x[x.length-1]!==n-P)x.push(n-P);return x;}
function predictBand(coarse,w,h,b,model){
  const {centers,weights}=model.bands[b],stride=STRIDES[b],out=new Float32Array(w*h),
    unc=new Float32Array(w*h),counts=new Float32Array(w*h),xx=grid(w),yy=grid(h);
  const x=new Float32Array(26),guess=new Float32Array(16),alt=new Float32Array(16);
  for(const row of yy)for(const col of xx){
    let m=0;
    for(let j=0;j<G;j++)for(let i=0;i<G;i++){
      const py=max(row+2+(j-2)*stride,0,h-1), px=max(col+2+(i-2)*stride,0,w-1);
      x[j*G+i]=coarse[py*w+px];m+=x[j*G+i];
    }
    m/=25;let variance=0;
    for(let d=0;d<25;d++){x[d]-=m;variance+=x[d]*x[d];}
    const sc=Math.sqrt(variance/25)+EPS;
    for(let d=0;d<25;d++)x[d]/=sc;
    x[25]=1;
    let best=[-1,-1,-1], dist=[Infinity,Infinity,Infinity];
    for(let k=0;k<512;k++){
      const o=k*25;let v=0;
      for(let d=0;d<25;d++){const e=x[d]-centers[o+d];v+=e*e;}
      if(v<dist[2]){
        let pos=2;while(pos>0&&v<dist[pos-1]){dist[pos]=dist[pos-1];best[pos]=best[pos-1];pos--;}
        dist[pos]=v;best[pos]=k;
      }
    }
    const pred=new Float32Array(48),probs=new Float32Array(3);
    let z=0;const temp=Math.max(0.5,dist[0]*0.15);
    for(let t=0;t<3;t++){probs[t]=Math.exp(-(dist[t]-dist[0])/temp);z+=probs[t];}
    for(let t=0;t<3;t++){
      probs[t]/=z;const offset=best[t]*26*16;
      for(let d=0;d<26;d++){
        const base=offset+d*16,vd=x[d];
        for(let e=0;e<16;e++)pred[t*16+e]+=vd*weights[base+e]*sc;
      }
    }
    // Baseline is *exactly* the nearest expert from P3. Alternatives supply a
    // disagreement proxy; they are not posterior probabilities or calibrated.
    for(let e=0;e<16;e++){
      guess[e]=pred[e];
      const mu=probs[0]*pred[e]+probs[1]*pred[16+e]+probs[2]*pred[32+e];
      alt[e]=probs[0]*(pred[e]-mu)**2+probs[1]*(pred[16+e]-mu)**2+probs[2]*(pred[32+e]-mu)**2;
    }
    for(let j=0;j<4;j++)for(let i=0;i<4;i++){
      const k=(row+j)*w+col+i,t=j*4+i;
      out[k]+=guess[t];unc[k]+=alt[t];counts[k]++;
    }
  }
  for(let i=0;i<out.length;i++){out[i]/=counts[i];unc[i]/=counts[i];}
  return {out,unc};
}
function reconstruct(input,w,h,model){
  const bs=sieve(input,w,h),coarse=sum(bs[3],bs[4]);
  let current=coarse,lastUnc=null;const stages=[{label:"core + r3",image:coarse}],parts=[];
  for(const b of [2,1,0]){const p=predictBand(current,w,h,b,model);current=sum(current,p.out);lastUnc=p.unc;parts.push(p.out);stages.push({label:"through r"+b,image:current});}
  // v2: keep the three predicted bands (p2, p1, p0) and the visible r3 band separately
  return {truth:Float32Array.from(input),given:coarse,pred:current,unc:lastUnc,w,h,stages,parts,r3:bs[3]};
}
function psnr(pred,truth){let mse=0;for(let i=0;i<pred.length;i++){const e=max(pred[i],0,1)-truth[i];mse+=e*e;}return 10*Math.log10(1/Math.max(1e-12,mse/pred.length));}
function tiles(scene){
  const {w,h,unc,given,pred,truth}=scene, nx=w/TILE,ny=h/TILE, a=[];
  if(w%TILE||h%TILE)throw Error("Image size must be a multiple of "+TILE);
  for(let ty=0;ty<ny;ty++)for(let tx=0;tx<nx;tx++){
    let disagreement=0,edge=0,error=0,r3energy=0;
    for(let y=ty*TILE;y<(ty+1)*TILE;y++)for(let x=tx*TILE;x<(tx+1)*TILE;x++){
      const i=y*w+x,e=max(pred[i],0,1)-truth[i];
      disagreement+=unc[i];
      if(scene.r3)r3energy+=scene.r3[i]*scene.r3[i];
      error+=e*e;
      const gx=given[y*w+Math.min(w-1,x+1)]-given[y*w+Math.max(0,x-1)];
      const gy=given[Math.min(h-1,y+1)*w+x]-given[Math.max(0,y-1)*w+x];
      edge+=Math.sqrt(gx*gx+gy*gy);
    }
    a.push({tx,ty,index:a.length,disagreement:disagreement/64,edge:edge/64,error:error/64,r3energy:r3energy/64});
  }
  return a;
}
function rng(seed){let a=seed>>>0;return()=>{a=(Math.imul(a,1664525)+1013904223)>>>0;return a/4294967296;};}
function selectNext(policy,ts,seen,observed,seed){
  const random=rng(seed),remaining=ts.filter(t=>!seen.has(t.index));
  if(!remaining.length)return null;
  if(policy==="fixed")return remaining[0];
  if(policy==="random"){const order=ts.map(t=>t.index),shuffle=rng(seed);for(let i=order.length-1;i>0;i--){const j=Math.floor(shuffle()*(i+1));[order[i],order[j]]=[order[j],order[i]];}return ts[order.find(i=>!seen.has(i))];}
  let best=null,bs=-Infinity;
  for(const t of remaining){
    let score=policy==="edge"?t.edge:policy==="oracle"?t.error:policy==="r3energy"?t.r3energy:t.disagreement;
    if(policy==="feedback"){
      // Only already-revealed errors are allowed. A nearby observation tells us
      // whether our uncertainty proxy underestimated or overestimated error.
      let d=0,n=0;
      for(const o of observed){
        const dd=(o.tx-t.tx)**2+(o.ty-t.ty)**2,wt=Math.exp(-dd/4);
        const ratio=Math.min(5,Math.max(0.2,o.error/(o.disagreement+1e-5)));
        d+=wt*ratio;n+=wt;
      }
      if(n>0)score*=max(0.3+0.7*d/n,0.2,4);
    }
    if(policy==="feedback2"&&observed.length){
      // v2: scale-free ratio. Divide by the median ratio over observed tiles, so the
      // score asks "is this neighbourhood worse than the memory's usual miss?"
      const raw=observed.map(o=>o.error/(o.disagreement+1e-12)).sort((a,b)=>a-b);
      const med=raw[Math.floor((raw.length-1)/2)]||1;
      let d=0,n=0;
      for(const o of observed){
        const dd=(o.tx-t.tx)**2+(o.ty-t.ty)**2,wt=Math.exp(-dd/4);
        d+=wt*max(o.error/(o.disagreement+1e-12)/med,0.2,5);n+=wt;
      }
      score*=max(0.3+0.7*d/n,0.2,4);
    }
    // deterministic tie breaks
    if(score>bs+1e-14){best=t;bs=score;}
  }
  return best;
}
function simulate(scene,policy,steps=20,seed=17){
  const ts=tiles(scene),seen=new Set(),observed=[],history=[psnr(scene.pred,scene.truth)],selected=[];
  const out=Float32Array.from(scene.pred);
  for(let step=0;step<Math.min(steps,ts.length);step++){
    const t=selectNext(policy,ts,seen,observed,seed);
    seen.add(t.index);observed.push(t);selected.push(t);
    for(let y=t.ty*TILE;y<(t.ty+1)*TILE;y++)for(let x=t.tx*TILE;x<(t.tx+1)*TILE;x++){
      const i=y*scene.w+x;out[i]=scene.truth[i];
    }
    history.push(psnr(out,scene.truth));
  }
  return {history,selected};
}
function drawGray(canvas,im,w,h,scale=1){
  canvas.width=w;canvas.height=h;
  const ctx=canvas.getContext("2d"),idata=ctx.createImageData(w,h);
  for(let i=0;i<im.length;i++){const v=Math.round(255*max(im[i]*scale,0,1));idata.data[4*i]=v;idata.data[4*i+1]=v;idata.data[4*i+2]=v;idata.data[4*i+3]=255;}
  ctx.putImageData(idata,0,0);
}
function drawTiles(canvas,im,w,h,selected){
  drawGray(canvas,im,w,h);
  const ctx=canvas.getContext("2d");ctx.strokeStyle="#f5b757";ctx.lineWidth=0.9;
  for(let i=0;i<selected.length;i++){const t=selected[i];ctx.strokeRect(t.tx*TILE+.5,t.ty*TILE+.5,TILE-1,TILE-1);}
}
function graph(canvas,sims,budget){
  const ctx=canvas.getContext("2d"),rect=canvas.getBoundingClientRect(),w=Math.max(320,rect.width||620),h=200,dpr=window.devicePixelRatio||1;
  canvas.width=Math.floor(w*dpr);canvas.height=Math.floor(h*dpr);ctx.setTransform(dpr,0,0,dpr,0,0);
  ctx.clearRect(0,0,w,h);ctx.fillStyle="#11242c";ctx.fillRect(0,0,w,h);
  const colors={fixed:"#8d9ea6",random:"#c9a27b",edge:"#efb968",disagree:"#60d0cb",feedback:"#c2a0f8",feedback2:"#e8e2a0",oracle:"#f38f8a"};
  let mn=Infinity,mx=-Infinity;for(const r of Object.values(sims))for(const v of r.history){mn=Math.min(mn,v);mx=Math.max(mx,v);}
  mn=Math.floor(mn-1);mx=Math.ceil(mx+1);
  const margin={l:44,r:14,t:15,b:27},x=t=>margin.l+(w-margin.l-margin.r)*t/budget,y=v=>h-margin.b-(h-margin.b-margin.t)*(v-mn)/(mx-mn);
  ctx.font="11px system-ui";ctx.strokeStyle="#34505c";ctx.lineWidth=1;
  for(let i=0;i<=4;i++){const v=mn+(mx-mn)*i/4;ctx.beginPath();ctx.moveTo(margin.l,y(v));ctx.lineTo(w-margin.r,y(v));ctx.stroke();ctx.fillStyle="#8ca5ad";ctx.fillText(v.toFixed(1),5,y(v)+4);}
  for(let t=0;t<=budget;t+=5){ctx.fillStyle="#8ca5ad";ctx.fillText(String(t),x(t)-3,h-7);}
  for(const [p,r] of Object.entries(sims)){
    ctx.strokeStyle=colors[p];ctx.lineWidth=p==="disagree"?2.7:1.6;ctx.beginPath();
    r.history.forEach((v,i)=>{if(i===0)ctx.moveTo(x(i),y(v));else ctx.lineTo(x(i),y(v));});ctx.stroke();
  }
}
function initUI(){
  const $=id=>document.getElementById(id),W=96,H=64;
  let model=null,scene=null,sourceId="",policy="disagree",looks=0,sims=null,playing=false,seed=17,cache=new Map();
  const photos=[["42049","Branches / bird"],["8023","Ground bird"],["108082","Wild landscape"],["196073","Natural scene"]];
  for(const [id,label] of photos){const o=document.createElement("option");o.value=id;o.textContent=label+"  ·  "+id;$("photo").append(o);}
  $("photo").insertAdjacentHTML("beforeend",'<option value="upload">My image (local)</option>');
  async function loadImage(url){
    return new Promise((resolve,reject)=>{const im=new Image();im.onload=()=>resolve(im);im.onerror=()=>reject(Error("Image could not be opened"));im.src=url;});
  }
  function toGray(im){const c=document.createElement("canvas");c.width=W;c.height=H;const ctx=c.getContext("2d",{willReadFrequently:true});
    const size=Math.min(im.width/ W,im.height/ H),cw=W*size,ch=H*size;
    ctx.drawImage(im,(im.width-cw)/2,(im.height-ch)/2,cw,ch,0,0,W,H);
    const rgba=ctx.getImageData(0,0,W,H).data,out=new Float32Array(W*H);
    for(let i=0;i<out.length;i++)out[i]=(0.2126*rgba[i*4]+0.7152*rgba[i*4+1]+0.0722*rgba[i*4+2])/255;
    return out;
  }
  function currentRec(){
    const out=Float32Array.from(scene.pred),selected=sims[policy].selected.slice(0,looks);
    for(const t of selected)for(let y=t.ty*TILE;y<(t.ty+1)*TILE;y++)for(let x=t.tx*TILE;x<(t.tx+1)*TILE;x++)
      out[y*W+x]=scene.truth[y*W+x];
    return {image:out,selected};
  }
  function drawScores(){
    const tileset=tiles(scene),can=$("scores");can.width=W;can.height=H;const ctx=can.getContext("2d");
    const nums=tileset.map(t=>policy==="edge"?t.edge:policy==="oracle"?t.error:t.disagreement);
    const sorted=nums.slice().sort((a,b)=>a-b),lo=sorted[0],hi=sorted[sorted.length-1]||1;
    for(const t of tileset){
      const q=Math.sqrt(max((nums[t.index]-lo)/(hi-lo+1e-12),0,1));
      ctx.fillStyle="rgb("+Math.round(18+220*q)+","+Math.round(47+113*q)+","+Math.round(57+38*(1-q))+")";
      ctx.fillRect(t.tx*TILE,t.ty*TILE,TILE,TILE);
    }
    ctx.strokeStyle="#f8f4de";ctx.lineWidth=1;
    for(const t of sims[policy].selected.slice(0,looks))ctx.strokeRect(t.tx*TILE+.5,t.ty*TILE+.5,TILE-1,TILE-1);
  }
  function render(){
    if(!scene)return;
    const cur=currentRec();
    drawGray($("truth"),scene.truth,W,H);drawGray($("given"),scene.given,W,H);
    drawGray($("prediction"),scene.pred,W,H);drawTiles($("current"),cur.image,W,H,cur.selected);drawScores();
    $("psnr").textContent=psnr(cur.image,scene.truth).toFixed(2)+" dB";
    $("basepsnr").textContent=psnr(scene.pred,scene.truth).toFixed(2)+" dB";
    $("observed").textContent=looks+" / "+(W/TILE)*(H/TILE)+" tiles";
    $("share").textContent=(100*looks/((W/TILE)*(H/TILE))).toFixed(1)+"%";
    const nxt=sims[policy].selected[looks];
    $("next").textContent=nxt?"Next: tile ("+(nxt.tx+1)+", "+(nxt.ty+1)+")":"All 20 looks used";
    $("step").disabled=looks>=20;$("play").disabled=looks>=20;
    graph($("graph"),sims,20);
    $("rows").innerHTML=POLICIES.map(p=>'<tr><td><span class="dot" style="background:'+({fixed:"#8d9ea6",random:"#c9a27b",edge:"#efb968",disagree:"#60d0cb",feedback:"#c2a0f8",feedback2:"#e8e2a0",oracle:"#f38f8a"}[p])+'"></span>'+({fixed:"Fixed grid",random:"Random",edge:"Coarse edges",disagree:"Expert disagreement",feedback:"Feedback (v1, disconnected)",feedback2:"Feedback v2 (scale-free)",oracle:"Oracle (ceiling)"}[p])+'</td><td>'+sims[p].history[20].toFixed(2)+' dB</td><td>'+((sims[p].history[20]-sims[p].history[0])).toFixed(2)+' dB</td></tr>').join("");
  }
  function reset(){looks=0;render();}
  async function openScene(){
    playing=false;const id=$("photo").value,stamp=id==="upload"?"upload:"+seed:id;
    $("status").textContent="Opening image and running original P3 patch memory…";$("step").disabled=true;$("play").disabled=true;
    await new Promise(r=>setTimeout(r,35));
    try {
      if(!model)model=preparePatch(root.SIHTI_PATCH_DATA);
      if(id==="upload"&&!root.SIHTI_UPLOADED)throw Error("Choose an image file first");
      if(cache.has(stamp))scene=cache.get(stamp);
      else {
        const im=id==="upload"?root.SIHTI_UPLOADED:await loadImage("data/photo_"+id+".png");
        scene=reconstruct(toGray(im),W,H,model);cache.set(stamp,scene);
      }
      sims=Object.fromEntries(POLICIES.map(p=>[p,simulate(scene,p,20,seed)]));
      looks=0;sourceId=id;render();
      $("status").textContent="Ready: 512-expert BSDS500 memory · 96×64 grayscale · 8×8 pixel observations.";
    }catch(e){$("status").textContent="Error: "+e.message;console.error(e);}
  }
  $("photo").onchange=openScene;
  $("policy").onchange=()=>{policy=$("policy").value;reset();};
  $("seed").onchange=()=>{seed=Math.max(1,(Number($("seed").value)||17)|0);if(scene){sims=Object.fromEntries(POLICIES.map(p=>[p,simulate(scene,p,20,seed)]));reset();}};
  $("step").onclick=()=>{looks=Math.min(20,looks+1);render();};
  $("reset").onclick=reset;
  $("play").onclick=async()=>{if(playing)return;playing=true;$("play").disabled=true;
    while(looks<20&&playing){looks++;render();await new Promise(r=>setTimeout(r,135));}playing=false;$("play").disabled=looks>=20;};
  $("upload").onchange=async e=>{const f=e.target.files[0];if(!f)return;const url=URL.createObjectURL(f);
    try{root.SIHTI_UPLOADED=await loadImage(url);seed++;$("photo").value="upload";await openScene();}
    finally{URL.revokeObjectURL(url);}};
  $("benchmark").onclick=async()=>{
    $("benchmark").disabled=true;const orig=$("photo").value,results=[],tmp=scene;
    try{
      for(const [id] of photos){
        $("status").textContent="Benchmark "+id+" (original P3 memory; no hidden pixels used by admissible policies)…";
        await new Promise(r=>setTimeout(r,40));
        let s=cache.get(id);
        if(!s){const im=await loadImage("data/photo_"+id+".png");s=reconstruct(toGray(im),W,H,model);cache.set(id,s);}
        const vals={id};
        for(const p of POLICIES)vals[p]=simulate(s,p,20,seed).history[20];
        results.push(vals);
      }
      $("benchmarkResults").hidden=false;
      $("benchmarkResults").textContent=results.map(r=>r.id+"  "+POLICIES.map(p=>p+": "+r[p].toFixed(2)).join("  |  ")).join("\n")
        +"\nMean  "+POLICIES.map(p=>p+": "+(results.reduce((a,r)=>a+r[p],0)/results.length).toFixed(2)).join("  |  ");
      $("status").textContent="Benchmark complete. Four supplied held-out photos; PSNR after 20 equal-cost looks.";
      const blob=new Blob([JSON.stringify({resolution:[W,H],seed,looks:20,policies:POLICIES,results},null,2)],{type:"application/json"});
      const url=URL.createObjectURL(blob);$("download").href=url;$("download").hidden=false;
    }catch(e){$("status").textContent="Benchmark error: "+e.message;}finally{$("benchmark").disabled=false;scene=tmp;}
  };
  window.addEventListener("resize",()=>{if(scene)graph($("graph"),sims,20);});
  openScene();
}
/* v2: looks recalibrate the memory.
   Revealed pixels give the true fine detail t = truth - (core+r3). Fit one gain per predicted
   band (p2, p1, p0) by ridge regression toward 1, refit after every look, and apply the gains to
   every unrevealed pixel. mu and the [0,2] clamp are fixed in PREREG_V2.md. */
function fitGains(scene,revealed,mu=0.5){
  const P=scene.parts,A=[[0,0,0],[0,0,0],[0,0,0]],b=[0,0,0];
  for(const i of revealed){
    const t=scene.truth[i]-scene.given[i];
    for(let r=0;r<3;r++){b[r]+=P[r][i]*t;for(let c=0;c<3;c++)A[r][c]+=P[r][i]*P[c][i];}
  }
  const tr=A[0][0]+A[1][1]+A[2][2];
  if(!(tr>0))return [1,1,1];
  const m=mu*tr/3,M=A.map((row,r)=>row.map((v,c)=>v+(r===c?m:0))),y=b.map(v=>v+m);
  for(let k=0;k<3;k++){ // Gaussian elimination with partial pivoting
    let piv=k;for(let r=k+1;r<3;r++)if(Math.abs(M[r][k])>Math.abs(M[piv][k]))piv=r;
    [M[k],M[piv]]=[M[piv],M[k]];[y[k],y[piv]]=[y[piv],y[k]];
    for(let r=k+1;r<3;r++){const f=M[r][k]/M[k][k];for(let c=k;c<3;c++)M[r][c]-=f*M[k][c];y[r]-=f*y[k];}
  }
  const g=[0,0,0];
  for(let k=2;k>=0;k--){let s=y[k];for(let c=k+1;c<3;c++)s-=M[k][c]*g[c];g[k]=s/M[k][k];}
  return g.map(v=>max(Number.isFinite(v)?v:1,0,2));
}
function simulate2(scene,policy,{steps=20,seed=17,base="p3",gain=false}={}){
  const ts=tiles(scene),seen=new Set(),observed=[],selected=[],revealed=[],isRev=new Uint8Array(scene.truth.length);
  const start=base==="coarse"?scene.given:scene.pred,out=Float32Array.from(start),gains=[];
  const history=[psnr(out,scene.truth)];
  for(let step=0;step<Math.min(steps,ts.length);step++){
    const t=selectNext(policy,ts,seen,observed,seed);
    seen.add(t.index);observed.push(t);selected.push(t);
    for(let y=t.ty*TILE;y<(t.ty+1)*TILE;y++)for(let x=t.tx*TILE;x<(t.tx+1)*TILE;x++){
      const i=y*scene.w+x;out[i]=scene.truth[i];isRev[i]=1;revealed.push(i);
    }
    if(gain&&base==="p3"){
      const g=fitGains(scene,revealed);gains.push(g);
      const P=scene.parts;
      for(let i=0;i<out.length;i++)if(!isRev[i])out[i]=scene.given[i]+g[0]*P[0][i]+g[1]*P[1][i]+g[2]*P[2][i];
    }
    history.push(psnr(out,scene.truth));
  }
  return {history,selected,gains,image:out};
}
root.SihtiEyeCore={DEPTHS,preparePatch,purify,sieve,predictBand,reconstruct,psnr,tiles,rng,selectNext,simulate,fitGains,simulate2};
if(typeof document!=="undefined")document.addEventListener("DOMContentLoaded",initUI);
})(typeof window==="undefined"?globalThis:window);
