// Builds data/bsds_test_96x64.bin from BSDS500 test-split PNGs (converted from the official JPEGs).
// Same centre crop + bilinear resize as tests/benchmark.cjs. Format: uint32 count, then per image:
// uint32 id, 96*64 uint16 gray values (0..65535).
"use strict";
const fs=require("node:fs"),path=require("node:path");
const {pngDecode,resizeGray}=require("../tests/image_io.cjs");
const dir=process.argv[2];if(!dir)throw Error("usage: node tools/make_test_set.cjs <png dir>");
const files=fs.readdirSync(dir).filter(f=>f.endsWith(".png")).sort();
const buf=Buffer.alloc(4+files.length*(4+96*64*2));let o=0;buf.writeUInt32LE(files.length,o);o+=4;
for(const f of files){
  const g=resizeGray(pngDecode(fs.readFileSync(path.join(dir,f))));
  buf.writeUInt32LE(parseInt(f),o);o+=4;
  for(const v of g){buf.writeUInt16LE(Math.round(Math.min(1,Math.max(0,v))*65535),o);o+=2;}
}
fs.writeFileSync(path.join(__dirname,"..","data","bsds_test_96x64.bin"),buf);
console.log("wrote",files.length,"images");
