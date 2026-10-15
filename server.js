// Paleisk: node server.js  ->  http://localhost:3000   (reikia Node 18+, jokių paketų diegti nereikia)
const http=require("http"),fs=require("fs"),path=require("path");
const PORT=process.env.PORT||3000, DZ="https://api.deezer.com";
// Numatyti atlikėjai. Daugiau galima pridėti pačiame puslapyje.
const ARTISTS=["OG Version","Proflame","Jazzu","Andrius Mamontovas","Jurga","Monika Liu","The Roop","Silvester Belt","Justinas Jarutis","Jessica Shy","Donny Montell","Vaidas Baumila","G&G Sindikatas","Skamp","Lemon Joy","Foje","Rokas Yan","Leon Somov"];
const norm=x=>(x||"").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-z0-9 ]/g," ").replace(/\s+/g," ").trim();
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
// Deezer leidžia ~50 užklausų per 5 s, todėl jas siunčiame po vieną
let chain=Promise.resolve();
function dz(p){
  const run=async()=>{for(let i=0;i<3;i++){await sleep(120);let j;try{j=await(await fetch(DZ+p)).json()}catch(e){return{}}if(j.error&&j.error.code===4){await sleep(2500);continue}return j}return{}};
  const r=chain.then(run);chain=r.catch(()=>{});return r;
}
process.on("unhandledRejection",e=>console.log("Klaida:",e&&e.message));
const cache=new Map();
const HTMLS=new Map();
async function cached(k,fn,ttl){const c=cache.get(k);if(c&&Date.now()-c.t<ttl)return c.v;const v=await fn();if(v!=null&&!(Array.isArray(v)&&!v.length))cache.set(k,{t:Date.now(),v});return v}
const findArtist=n=>cached("a:"+norm(n),async()=>{
  const l=((await dz("/search/artist?limit=5&q="+encodeURIComponent(n))).data)||[];
  const ex=l.filter(a=>norm(a.name)===norm(n));
  const a=(ex.length?ex:l).sort((x,y)=>(y.nb_fan||0)-(x.nb_fan||0))[0];
  return a?{id:a.id,name:a.name}:null;
},864e5);
// Visos atlikėjo dainos (populiariausios + paieška), tik kur jis pagrindinis atlikėjas
const liveTracks=name=>cached("t:"+norm(name),async()=>{
  const a=await findArtist(name);if(!a)return[];
  const top=await dz(`/artist/${a.id}/top?limit=100`);
  const se=await dz("/search?limit=100&q="+encodeURIComponent(`artist:"${a.name}"`));
  const seen=new Set(),out=[];
  [...(top.data||[]),...(se.data||[])].forEach(x=>{
    if(!x.artist||x.artist.id!==a.id)return;
    const title=x.title_short||x.title,k=norm(title);if(seen.has(k))return;seen.add(k);
    out.push({id:x.id,title,artist:a.name,cover:x.album&&(x.album.cover_medium||x.album.cover),coverBig:x.album&&(x.album.cover_big||x.album.cover_xl),album:x.album&&x.album.title,albumId:x.album&&x.album.id});
  });
  return out;
},36e5);
// songs.json: iš anksto surinktos dainos (paleisk "node server.js --build" savo kompiuteryje) – svetainė startuoja iškart
let SNAP={};try{const j=JSON.parse(fs.readFileSync(path.join(__dirname,"songs.json"),"utf8"));for(const k in j)SNAP[norm(k)]=j[k];console.log("Įkelta iš songs.json:",Object.keys(SNAP).length,"atlikėjų")}catch(e){}
const tracksOf=name=>SNAP[norm(name)]?Promise.resolve(SNAP[norm(name)]):liveTracks(name);
const pmemo=new Map();
const pool=async names=>{const k=names.join("|"),c=pmemo.get(k);if(c&&Date.now()-c.t<60000)return c.v;
  const v=(await Promise.all(names.map(tracksOf))).flat().sort((a,b)=>a.id-b.id);if(pmemo.size>40)pmemo.clear();pmemo.set(k,{t:Date.now(),v});return v};
function seeded(str){let s=0;for(const c of str)s=(s*31+c.charCodeAt(0))>>>0;return()=>(s=(s*1664525+1013904223)>>>0)/4294967296}
async function round(names,daily,cover){
  let p=await pool(daily?ARTISTS:names);
  if(cover){p=p.filter(t=>t.albumId&&t.album&&t.cover);if(!p.length)throw new Error("Nepavyko rasti albumų");
    const t=p[Math.floor(Math.random()*p.length)];return{id:t.id,title:t.title,artist:t.artist,album:t.album,albumId:t.albumId,cover:t.cover,coverBig:t.coverBig||t.cover};}
  if(!p.length)throw new Error("Nepavyko rasti dainų");
  const day=new Date().toLocaleDateString("sv",{timeZone:"Europe/Vilnius"});
  const rnd=daily?seeded(day):Math.random;
  let i=Math.floor(rnd()*p.length);
  for(let k=0;k<10;k++,i=(i+1)%p.length){
    const f=await dz("/track/"+p[i].id); // šviežia peržiūros nuoroda (jos greitai nebegalioja)
    if(f.preview)return{id:f.id,title:f.title_short||f.title,artist:p[i].artist,cover:f.album&&(f.album.cover_medium||f.album.cover),coverBig:f.album&&(f.album.cover_big||f.album.cover_xl),album:f.album&&f.album.title,albumId:f.album&&f.album.id,preview:f.preview,start:rnd()*14};
  }
  throw new Error("Nepavyko rasti dainos");
}
async function search(q,names,album){
  const v=norm(q);if(v.length<2)return[];
  if(album){const seen=new Set(),out=[];
    for(const t of await pool(names)){if(!t.albumId||seen.has(t.albumId))continue;
      if(norm(t.album+" "+t.artist).includes(v)){seen.add(t.albumId);out.push({id:t.albumId,title:t.album,artist:t.artist,cover:t.cover});if(out.length>=8)break}}
    return out;}
  return(await pool(names)).filter(t=>norm(t.title+" "+t.artist).includes(v)).slice(0,8);
}
const send=(res,code,obj)=>{res.writeHead(code,{"Content-Type":"application/json; charset=utf-8"});res.end(JSON.stringify(obj))};
const server=http.createServer(async(req,res)=>{
  const u=new URL(req.url,"http://x"),q=u.searchParams,n=(q.get("a")||"").split("|").filter(Boolean),names=n.length?n:ARTISTS;
  try{
    if(u.pathname==="/api/artists")return send(res,200,ARTISTS);
    if(u.pathname==="/api/artist"){const a=await findArtist(q.get("name")||"");return a?send(res,200,a):send(res,404,{error:"Atlikėjas nerastas"})}
    if(u.pathname==="/api/artistsearch"){const l=((await dz("/search/artist?limit=6&q="+encodeURIComponent(q.get("q")||""))).data)||[];return send(res,200,l.map(a=>({id:a.id,name:a.name,picture:a.picture_small})))}
    if(u.pathname==="/api/stats"){const o={};for(const n of ARTISTS)o[n]=(await tracksOf(n)).length;return send(res,200,o)}
    if(u.pathname==="/api/round")return send(res,200,await round(names,q.get("daily")==="1",q.get("mode")==="cover"));
    if(u.pathname==="/api/search")return send(res,200,await search(q.get("q")||"",q.get("daily")==="1"?ARTISTS:names,q.get("album")==="1"));
    if(u.pathname==="/og.png"){try{const d=fs.readFileSync(path.join(__dirname,"public","og.png"));res.writeHead(200,{"Content-Type":"image/png","Cache-Control":"public, max-age=86400"});return res.end(d)}catch(e){return send(res,404,{error:"Nerasta"})}}
    // puslapio adresas įrašomas į nuorodų peržiūros (og:) žymas pagal tai, kuriuo adresu atidaryta svetainė
    let host=req.headers["x-forwarded-host"]||req.headers.host||"";if(!/^[a-z0-9.-]+(:\d+)?$/i.test(host))host="atspekdaina.eu";
    const origin=(/^(localhost|127\.)/.test(host)?"http://":"https://")+host;
    let H=HTMLS.get(origin);
    if(!H){try{const raw=Buffer.from(fs.readFileSync(path.join(__dirname,"public","index.html"),"utf8").split("__ORIGIN__").join(origin));H={raw,gz:require("zlib").gzipSync(raw)};if(HTMLS.size>20)HTMLS.clear();HTMLS.set(origin,H)}catch(e){return send(res,404,{error:"Nerasta"})}}
    const gz=/gzip/.test(req.headers["accept-encoding"]||"");
    res.writeHead(200,{"Content-Type":"text/html; charset=utf-8","Cache-Control":"no-cache",...(gz?{"Content-Encoding":"gzip"}:{})});res.end(gz?H.gz:H.raw);
  }catch(e){send(res,500,{error:e.message})}
});
if(process.argv.includes("--build")){(async()=>{const o={};for(const n of ARTISTS){o[n]=await liveTracks(n);console.log(n+":",o[n].length)}
  fs.writeFileSync(path.join(__dirname,"songs.json"),JSON.stringify(o));console.log("Išsaugota songs.json");process.exit(0)})();}
else server.listen(PORT,()=>{console.log("Atidaryk http://localhost:"+PORT);if(Object.keys(SNAP).length<ARTISTS.length)pool(ARTISTS).then(p=>console.log("Paruošta dainų:",p.length)).catch(()=>{})});
