import fs from 'node:fs/promises';import path from 'node:path';import {constants} from 'node:fs';
import {id} from './utils.mjs';
const pattern=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}\.(?:png|jpe?g|webp)$/i;
export function recipeCoverId(value) {
  if (value==null||value==='') return '';
  if (typeof value!=='string'||!pattern.test(value)) throw new Error('配方展示图引用无效');
  return value;
}
export class RecipeCovers {
  constructor(store,{validateImage=()=>true}={}){this.directory=path.join(store.dir,'recipe-covers');this.validateImage=validateImage;}
  async importFile(source){
    const extension=path.extname(source).toLowerCase();
    if(!['.png','.jpg','.jpeg','.webp'].includes(extension))throw new Error('请选择 PNG、JPEG 或 WebP 图片');
    const stat=await fs.stat(source);if(!stat.isFile()||!stat.size||stat.size>30*1024**2)throw new Error('展示图片应为 30 MB 以内的图片文件');
    if(!await this.validateImage(source))throw new Error('图片无法读取，请更换一张图片');
    await fs.mkdir(this.directory,{recursive:true});const coverId=`${id()}${extension}`;
    await fs.copyFile(source,path.join(this.directory,coverId),constants.COPYFILE_EXCL);
    return {coverId,coverRevision:Date.now()};
  }
  async media(value){
    let coverId;try{coverId=recipeCoverId(value);}catch{return null;}if(!coverId)return null;
    const file=path.join(this.directory,coverId);
    try{const stat=await fs.lstat(file);if(!stat.isFile()||stat.isSymbolicLink())return null;const root=await fs.realpath(this.directory),real=await fs.realpath(file);return path.resolve(real).toLowerCase()===path.join(root,coverId).toLowerCase()?real:null;}catch{return null;}
  }
}
