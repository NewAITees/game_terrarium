// network-core.ts — shared logic for all network visualization pages
import * as THREE from 'three';

// ── Seeded RNG ────────────────────────────────────────────────────
export class RNG {
  s: number;
  constructor(s){ this.s=((s||Math.random()*2**32)^0xDEADBEEF)>>>0; }
  next(){ let x=this.s; x^=x<<13; x^=x>>17; x^=x<<5; return(this.s=x>>>0)/0x100000000; }
  range(a,b){ return a+this.next()*(b-a); }
  int(a,b)  { return a+(this.next()*(b-a+1)|0); }
  pick(arr)  { return arr[this.next()*arr.length|0]; }
}

// ── Topology ──────────────────────────────────────────────────────
export const LAYERS = ['core','dist','acc','term'];
export const YL = { core:36, dist:20, acc:4, term:-16 };

export function layerCounts(n){
  const core=1, dist=Math.max(2,Math.min(4,Math.floor(n*.10)));
  const acc=Math.max(3,Math.min(10,Math.floor(n*.25)));
  return {core,dist,acc,term:Math.max(1,n-core-dist-acc)};
}

export function edgeKey(a,b){ return `${Math.min(a,b)}-${Math.max(a,b)}`; }

export function assignRadialPositions(lnodes,rng){
  const R={dist:27,acc:56,term:86}, J={dist:2,acc:3,term:4};
  const lc=new Map();
  function leafCount(n){
    if(lc.has(n.id)) return lc.get(n.id);
    const v=n.children.length?n.children.reduce((s,c)=>s+leafCount(c),0):1;
    lc.set(n.id,v); return v;
  }
  function assignArc(n,lo,hi){
    n._a=(lo+hi)/2;
    if(!n.children.length) return;
    const total=n.children.reduce((s,c)=>s+leafCount(c),0);
    let a=lo;
    for(const c of n.children){ const arc=(leafCount(c)/total)*(hi-lo); assignArc(c,a,a+arc); a+=arc; }
  }
  for(const n of lnodes['core']){ n.x=rng.range(-2,2); n.z=rng.range(-2,2); n._a=0; assignArc(n,0,Math.PI*2); }
  for(const layer of ['dist','acc','term'])
    for(const n of lnodes[layer]){ const r=R[layer]+rng.range(-J[layer],J[layer]); n.x=Math.cos(n._a)*r; n.z=Math.sin(n._a)*r; }
}

export function buildTopology(total,seed,mode='tree',rewirePct=0){
  const rng=new RNG(seed), counts=layerCounts(total);
  const SPREAD=Math.max(110,counts.term*14);
  const nodes=[], lnodes={};

  for(const layer of LAYERS){
    const n=counts[layer]; lnodes[layer]=[];
    for(let i=0;i<n;i++){
      const x=((i+1)/(n+1)-.5)*SPREAD+rng.range(-4,4), z=rng.range(-12,12);
      const node={id:nodes.length,layer,x,z,y:YL[layer],parent:null,children:[],isServer:false};
      nodes.push(node); lnodes[layer].push(node);
    }
  }

  const terms=lnodes['term'];
  const server=terms.reduce((b,t)=>Math.abs(t.x)<Math.abs(b.x)?t:b);
  server.isServer=true;

  const accNodes=lnodes['acc'];
  const srvSwitch=accNodes.reduce((b,s)=>Math.abs(s.x-server.x)<Math.abs(b.x-server.x)?s:b);
  const freeAcc=accNodes.filter(s=>s!==srvSwitch);

  const treeEdges=[];
  for(let li=1;li<LAYERS.length-1;li++){
    const parents=lnodes[LAYERS[li-1]], children=lnodes[LAYERS[li]];
    for(const child of children){
      const par=parents.reduce((b,p)=>Math.abs(p.x-child.x)<Math.abs(b.x-child.x)?p:b);
      child.parent=par; par.children.push(child); treeEdges.push({a:par,b:child});
    }
    for(const p of parents) if(!p.children.length){ const c=rng.pick(children); p.children.push(c); treeEdges.push({a:p,b:c}); }
  }

  server.parent=srvSwitch; srvSwitch.children.push(server); treeEdges.push({a:srvSwitch,b:server});
  const otherTerms=terms.filter(t=>!t.isServer);
  for(const t of otherTerms){
    const pool=freeAcc.length?freeAcc:accNodes;
    const par=pool.reduce((b,p)=>Math.abs(p.x-t.x)<Math.abs(b.x-t.x)?p:b);
    t.parent=par; par.children.push(t); treeEdges.push({a:par,b:t});
  }
  for(const p of freeAcc) if(!p.children.length){ const c=rng.pick(otherTerms); if(c){ p.children.push(c); treeEdges.push({a:p,b:c}); } }

  assignRadialPositions(lnodes,rng);

  // Small world: shortcuts between dist/acc only
  const shortcutEdges=[];
  if(mode==='smallworld' && rewirePct>0){
    const existing=new Set(treeEdges.map(e=>edgeKey(e.a.id,e.b.id)));
    const k=Math.max(1,Math.round(nodes.length*rewirePct/100));
    let added=0, attempts=0;
    while(added<k && attempts<k*30){
      attempts++;
      const u=rng.pick(nodes), v=rng.pick(nodes);
      if(u===v||u.layer==='core'||u.layer==='term'||v.layer==='core'||v.layer==='term') continue;
      const ek_=edgeKey(u.id,v.id);
      if(existing.has(ek_)) continue;
      existing.add(ek_); shortcutEdges.push({a:u,b:v}); added++;
    }
  }

  return {nodes,treeEdges,shortcutEdges,lnodes,server};
}

// ── Path finding ──────────────────────────────────────────────────
export function findTreePath(from,to){
  const pA=[]; let n=from; while(n){pA.push(n);n=n.parent;}
  const pB=[]; n=to; while(n){pB.push(n);n=n.parent;}
  const setA=new Set(pA);
  let ia=pA.length-1,ib=0;
  for(let i=0;i<pB.length;i++) if(setA.has(pB[i])){ia=pA.indexOf(pB[i]);ib=i;break;}
  return [...pA.slice(0,ia+1),...pB.slice(0,ib).reverse()];
}

export function buildAdj(nodes,edgeMap){
  const adj=new Map();
  for(const n of nodes) adj.set(n.id,[]);
  for(const [,e] of edgeMap){ adj.get(e.an.id).push(e.bn); adj.get(e.bn.id).push(e.an); }
  return adj;
}

export function findShortestPath(from,to,adj){
  if(from===to) return [from];
  const visited=new Set([from.id]), prev=new Map([[from.id,null]]), queue=[from];
  while(queue.length){
    const curr=queue.shift();
    if(curr===to){ const path=[]; let n=to; while(n!==null){path.unshift(n);n=prev.get(n.id);} return path; }
    for(const nb of (adj.get(curr.id)||[]))
      if(!visited.has(nb.id)){ visited.add(nb.id); prev.set(nb.id,curr); queue.push(nb); }
  }
  return findTreePath(from,to);
}

// ── Visual styles ─────────────────────────────────────────────────
export const STYLE={
  core:  {color:0x3B8BD4,em:0x0d2d55,emI:1.4,geo:()=>new THREE.TorusGeometry(4,1.1,12,26),halo:10,hOp:.06,rx:.18,rz:.10},
  dist:  {color:0x1D9E75,em:0x073d2c,emI:1.3,geo:()=>new THREE.TorusGeometry(2.6,.72,10,20),halo:6.5,hOp:.05,rx:.22,rz:.14},
  acc:   {color:0xBA7517,em:0x4a2c06,emI:1.1,geo:()=>new THREE.BoxGeometry(4.8,.85,2.6),halo:5,hOp:.04},
  term:  {color:0xb4c8de,em:0x2a3c50,emI:1.2,geo:()=>new THREE.ConeGeometry(1.0,2.5,6),halo:3.2,hOp:.04,ry:.28},
  server:{color:0xFFD060,em:0x7a4a00,emI:1.8,geo:()=>new THREE.CylinderGeometry(1.9,2.3,5.5,10),halo:9,hOp:.07,ry:.12},
};

export function buildScene(topo, scene, spinData){
  for(const node of topo.nodes){
    const sk=node.isServer?'server':node.layer, s=STYLE[sk];
    const mat=new THREE.MeshStandardMaterial({color:s.color,emissive:s.em,emissiveIntensity:s.emI,metalness:.45,roughness:.25});
    const mesh=new THREE.Mesh(s.geo(),mat);
    mesh.position.set(node.x,node.y,node.z);
    mesh.add(new THREE.Mesh(new THREE.SphereGeometry(s.halo,12,12),
      new THREE.MeshBasicMaterial({color:s.color,transparent:true,opacity:s.hOp,side:THREE.BackSide})));
    scene.add(mesh); node.mesh=mesh;
    if(spinData) spinData.push({mesh,s});
  }
  for(let i=0;i<3;i++){
    const r=new THREE.Mesh(new THREE.TorusGeometry(2.6,.07,6,22),
      new THREE.MeshBasicMaterial({color:0xFFD060,transparent:true,opacity:.3}));
    r.rotation.x=Math.PI/2;
    r.position.set(topo.server.x,topo.server.y-1.5+i*1.5,topo.server.z);
    scene.add(r);
  }
  const srvGlow=new THREE.PointLight(0xFFD060,3.5,80);
  srvGlow.position.set(topo.server.x,topo.server.y+5,topo.server.z);
  scene.add(srvGlow);
  return srvGlow;
}

// ── Edge materials (simple bright/dim swap) ───────────────────────
export function makeMats(){
  return {
    tA: new THREE.LineBasicMaterial({color:0x88ddff,transparent:true,opacity:1.0}),
    tI: new THREE.LineBasicMaterial({color:0x0d1e33,transparent:true,opacity:0.2}),
    sA: new THREE.LineDashedMaterial({color:0xff8833,dashSize:3,gapSize:1,transparent:true,opacity:1.0}),
    sI: new THREE.LineDashedMaterial({color:0x401508,dashSize:3,gapSize:1,transparent:true,opacity:0.45}),
  };
}

export function buildEdges(topo,scene,edgeMap,allEdges,mats){
  function add(a,b,shortcut){
    const p0=new THREE.Vector3(a.x,a.y,a.z), p2=new THREE.Vector3(b.x,b.y,b.z);
    const mid=p0.clone().lerp(p2,.5); mid.y+=shortcut?22:6;
    const curve=new THREE.QuadraticBezierCurve3(p0,mid,p2);
    const geo=new THREE.BufferGeometry().setFromPoints(curve.getPoints(70));
    const line=new THREE.Line(geo,shortcut?mats.sI:mats.tI);
    if(shortcut) line.computeLineDistances();
    scene.add(line);
    const edge={line,curve,an:a,bn:b,activeUntil:0,shortcut};
    allEdges.push(edge); edgeMap.set(edgeKey(a.id,b.id),edge);
  }
  topo.treeEdges.forEach(e=>add(e.a,e.b,false));
  topo.shortcutEdges.forEach(e=>add(e.a,e.b,true));
}

export function tickEdges(allEdges,mats,now){
  for(const e of allEdges)
    e.line.material=e.activeUntil>now?(e.shortcut?mats.sA:mats.tA):(e.shortcut?mats.sI:mats.tI);
}

// ── Neon flash: spikes emissiveIntensity on packet arrival ─────────
export function initFlash(nodes){ return new Map(nodes.map(n=>[n.id,0])); }

export function tickFlash(nodes,glowMap,dt){
  for(const node of nodes){
    let g=glowMap.get(node.id);
    if(g>0.005){
      g=Math.max(0,g-dt*4);
      glowMap.set(node.id,g);
      const s=STYLE[node.isServer?'server':node.layer];
      node.mesh.material.emissiveIntensity=s.emI+g*6;
    }
  }
}

// ── Packets ───────────────────────────────────────────────────────
export function spawnPacket(p,terms,server,routeFn,rng){
  const src=rng.pick(terms);
  const dst=rng.next()<.8?server:(()=>{let d;do{d=rng.pick(terms);}while(d===src);return d;})();
  let path=routeFn(src,dst);
  if(rng.next()<.5) path=[...path].reverse();
  p.path=path; p.seg=0; p.t=rng.next(); p.speed=.3+rng.next()*.35;
}

export function buildPackets(count,scene,topo,seed,routeFn){
  const PCOLS=[0xFFD060,0x38aaff,0xffffff,0x44ffaa,0xff8855];
  const rng=new RNG(seed);
  const terms=topo.lnodes['term'];
  const packets=Array.from({length:count},()=>{
    const mesh=new THREE.Mesh(new THREE.SphereGeometry(.37,7,7),
      new THREE.MeshBasicMaterial({color:PCOLS[rng.int(0,PCOLS.length-1)]}));
    scene.add(mesh);
    const p={mesh,path:[],seg:0,t:rng.next(),speed:.3};
    spawnPacket(p,terms,topo.server,routeFn,rng); return p;
  });
  // close over rng for respawn
  const respawn=p=>spawnPacket(p,terms,topo.server,routeFn,rng);
  return {packets,respawn};
}

export function tickPackets(packets,respawn,edgeMap,glowMap,dt,now){
  for(const p of packets){
    p.t+=dt*p.speed;
    if(p.t>=1){
      const arrived=p.path[p.seg+1];
      if(arrived) glowMap.set(arrived.id,1.0);   // ← neon flash trigger
      p.t=0; p.seg++;
      if(p.seg>=p.path.length-1){respawn(p);continue;}
    }
    const a=p.path[p.seg],b=p.path[p.seg+1];
    if(!a||!b){respawn(p);continue;}
    const e=edgeMap.get(edgeKey(a.id,b.id));
    if(!e){respawn(p);continue;}
    p.mesh.position.copy(e.curve.getPoint(e.an===a?p.t:1-p.t));
    e.activeUntil=Math.max(e.activeUntil,now+.3);
  }
}
