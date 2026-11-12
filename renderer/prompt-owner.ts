export function promptOwnerColor(id:string){return [...id].reduce((hash,char)=>(hash*31+char.charCodeAt(0))>>>0,0)%8;}
