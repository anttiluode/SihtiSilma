"use strict";
// PNG reader (8-bit RGB/RGBA, filters 0-4) and the 96x64 centre-crop bilinear resize used by every benchmark.
const zlib=require("node:zlib");
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
module.exports={pngDecode,resizeGray};
