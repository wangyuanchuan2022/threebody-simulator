import assert from 'node:assert/strict';
import { G, createSystem, accelerations, verlet, energy, center, distance, environment, destruction, advance, localSunDirections, observerFrame, clamp, classifyEra } from '../src/physics.mjs';
let passed = 0;
function check(value, message) { assert.ok(value, message); passed++; }
check(clamp(5, 0, 1) === 1 && clamp(-1, 0, 1) === 0, 'clamping');
const a = createSystem(12), b = createSystem(12);
assert.deepEqual(a, b); passed++;
check(createSystem().bodies.length === 4, 'default random seed');
check(JSON.stringify(a.bodies) !== JSON.stringify(createSystem(13).bodies), 'different seeds');
check(Math.hypot(...center(a.bodies)) < 1e-14 && Math.hypot(...center(a.bodies, 'v')) < 1e-14, 'barycentric initial conditions');
const acc = accelerations(a.bodies);
check([0,1,2].every(k => Math.abs(acc.reduce((s, v, i) => s + a.bodies[i].mass * v[k], 0)) < 1e-15), 'Newton third law');
const circular = [{ mass: 1, p: [0,0,0], v:[0,0,0] }, { mass:3e-6,p:[1,0,0],v:[0,0,Math.sqrt(G)] }];
const e = energy(circular);
for (let i=0;i<14610;i++) verlet(circular,.025);
check(Math.abs((energy(circular)-e)/e)<1e-7,'two-body orbit energy');
check(Math.abs(distance(circular[0].p,circular[1].p)-1)<.001,'circular orbit radius');
const frame=observerFrame(a);
check(Math.abs(Math.hypot(...frame.up)-1)<1e-12,'observer unit normal');
check(localSunDirections(a).every(d=>Math.abs(Math.hypot(...d)-1)<1e-12),'unit sky directions');
for (let i=0;i<100;i++){advance(a);advance(b);}
assert.deepEqual(a,b);passed++;
check(a.days>2.4 && a.days<2.6,'physical clock');
check(Math.abs((energy(a.bodies)-a.initialEnergy)/a.initialEnergy)<1e-6,'short four-body energy');
const frozen=structuredClone(a);advance(a,0);advance(a,-1);advance(a,NaN);assert.deepEqual(a,frozen);passed++;
const collision=createSystem(3);collision.bodies[3].p=[...collision.bodies[0].p];collision.env=environment(collision.bodies);
check(destruction(collision).type==='collision','Earth collision reason');advance(collision);
check(collision.death.type==='collision' && collision.days===0,'collision checked before integration');
const dead=structuredClone(collision);advance(collision);assert.deepEqual(collision,dead);passed++;
const tidal=createSystem(7);tidal.bodies[0].radius=.0001;tidal.bodies[3].p=tidal.bodies[0].p.map((x,i)=>x+(i===0?.001:0));tidal.env=environment(tidal.bodies);
check(destruction(tidal).type==='tidal','tidal criterion');
for(const [key,value,type] of [['hotDays',8,'heat'],['coldDays',30,'cold']]){
 const s=createSystem(17);s[key]=value;check(destruction(s).type===type,type+' reason');
}
const escape=createSystem(14);escape.bodies[3].p=[100,0,0];escape.bodies[3].v=[1,0,0];escape.env=environment(escape.bodies);
check(destruction(escape).type==='escape','outward positive-energy escape');
escape.bodies[3].v=[-1,0,0];check(destruction(escape)===null,'inward motion is not escape');
escape.bodies[3].v=[.00001,0,0];check(destruction(escape)===null,'bound orbit is not escape');
const stars=createSystem(9);stars.bodies[0].p=[...stars.bodies[1].p];stars.env=environment(stars.bodies);
check(destruction(stars).type==='model','stellar collision not reported as Earth destruction');
const hot=createSystem(18);hot.temperature=500;advance(hot,.1);check(hot.hotDays>.09,'heat duration accumulates');
const cold=createSystem(18);cold.temperature=100;advance(cold,.1);check(cold.coldDays>.09,'cold duration accumulates');
const endings={};
for(let seed=1;seed<=12;seed++){
 const s=createSystem(seed);
 for(let n=0;n<10000 && !s.death;n++)advance(s,.1);
 check(s.bodies.every(b=>[...b.p,...b.v].every(Number.isFinite)),'seed '+seed+' stays finite');
 check(s.days>0,'seed '+seed+' advances');
 endings[s.death?.type??'surviving']=(endings[s.death?.type??'surviving']??0)+1;
}
// Initial star positions must be genuinely volumetric, not a flat ring: for
// uniform spherical sampling E|y|/E|r| = 0.5, while a coplanar setup trends to 0.
// Averaged over 200 worlds so the 3-sample noise cannot decide the verdict.
let ratioSum=0, ratioN=0;
for(let seed=1;seed<=200;seed++){
 const s=createSystem(seed*7919);
 const stars=s.bodies.slice(0,3);
 const ay=stars.reduce((q,b)=>q+Math.abs(b.p[1]),0)/3;
 const ar=stars.reduce((q,b)=>q+Math.hypot(...b.p),0)/3;
 ratioSum+=ay/ar; ratioN++;
}
const meanRatio=ratioSum/ratioN;
check(meanRatio>0.35 && meanRatio<0.65,'volumetric 3D star placement (mean |y|/|r| = '+meanRatio.toFixed(3)+', coplanar would be ~0)');
// 恒纪元/乱纪元 classification: the era describes a period, so the rule is
// checked on synthetic windows (one dominant sun vs three comparable suns).
const window=(n,{temp=288,swing=0,dominance=1,flux=1}={})=>Array.from({length:n},(_,i)=>({days:i*0.25,temperature:temp+(i%2?swing:0),dominance,flux}));
const steady=window(20,{temp:288,swing:2,dominance:.95,flux:1});
check(classifyEra(steady)==='恒纪元','steady climate under one dominant sun is 恒纪元');
check(classifyEra(window(20,{temp:288,swing:2,dominance:.34,flux:3}))==='乱纪元','three comparable suns (三日凌空) is 乱纪元');
check(classifyEra(window(20,{temp:288,swing:80,dominance:.95,flux:1}))==='乱纪元','wildly swinging climate is 乱纪元');
check(classifyEra(window(20,{temp:420,swing:2,dominance:.95,flux:1}))==='乱纪元','scorched climate is 乱纪元');
check(classifyEra(window(20,{temp:288,swing:2,dominance:.95,flux:.05}))==='乱纪元','dark sky without a real sun is 乱纪元');
check(classifyEra(window(4,{temp:288}))===null,'too little history yields no era label');
console.log('[PASS] '+passed+' assertions. Seed survey: '+JSON.stringify(endings));
