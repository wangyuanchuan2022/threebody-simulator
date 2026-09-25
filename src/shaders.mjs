// Procedural atmosphere, animated clouds and ocean. Terrain can be replaced by a
// real GLB mesh (see app.mjs); the shader ridges stay as the no-model fallback.
export const vertexShader = `
varying vec2 vUv;
void main() { vUv=uv; gl_Position=vec4(position.xy,0.0,1.0); }
`;
export const fragmentShader = `
precision highp float;
#ifndef MARCH_STEPS
#define MARCH_STEPS 12
#endif
#ifndef SHADOW_STEPS
#define SHADOW_STEPS 4
#endif
#ifndef OCTAVES
#define OCTAVES 5
#endif
varying vec2 vUv;
uniform vec2 resolution;
uniform vec3 suns[3];
uniform vec3 sunColors[3];
uniform float powers[3];
uniform float radii[3];
uniform float clock;
uniform float weatherClock;
uniform float yaw;
uniform float pitch;
uniform float fov;
uniform float exposure;
uniform float cloudCover;
uniform float temperature;
uniform float quality;
uniform float terrainMesh;
uniform sampler2D distantMountains;
uniform float distantMountainsReady;
uniform float proceduralStars;  // 1 only when no real catalogue is embedded
const float PI=3.14159265359;
float hash(vec2 p) { return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
float noise(vec2 p) {
  vec2 i=floor(p),f=fract(p); f=f*f*(3.0-2.0*f);
  return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1)),f.x),f.y);
}
float fbm(vec2 p) {
  float f=0.0,a=0.5;
  mat2 m=mat2(.8,.6,-.6,.8);
  for(int i=0;i<OCTAVES;i++){f+=a*noise(p);p=m*p*2.03+17.3;a*=.5;}
  return f;
}
vec2 sphere(vec3 ro,vec3 rd,float radius) {
  float b=dot(ro,rd),c=dot(ro,ro)-radius*radius;
  float d=b*b-c;
  if(d<0.0)return vec2(-1.0);
  return vec2(-b-sqrt(d),-b+sqrt(d));
}
// Single scattering through exponential Rayleigh and Mie density profiles.
// One star layer, sized to mimic the real naked-eye sky: a sparse hash grid whose
// lit cells place a star at a random spot inside the cell (no lattice shows),
// with a power-law magnitude spread, a colour temperature and a point spread that
// never drops below ~1 px. Layer counts (whole sphere) follow the real
// magnitude histogram: ~20 first-magnitude stars, ~50 second, ~150 third,
// ~500 fourth, ~1600 fifth, ~4800 sixth -- roughly 3x per magnitude.
vec3 starLayer(vec2 st, float ppr, float density, float litFraction, float gain, float seed) {
  vec2 grid=st*density;
  vec2 cell=floor(grid);
  if(hash(cell+seed)>litFraction) return vec3(0.0);
  float h1=hash(cell+seed+1.7),h2=hash(cell+seed+3.3);
  float h3=hash(cell+seed+7.1),h4=hash(cell+seed+11.3);
  vec2 delta=(fract(grid)-vec2(h1,h2))/density;
  float angle=length(delta*vec2(cos(st.y),1.0));
  float mag=pow(h3,2.5);                               // few bright, many faint
  float sigma=(.7+.9*mag)/max(1.0,ppr);                // brightest read as small discs
  float core=exp(-.5*angle*angle/(sigma*sigma));
  float glow=exp(-.5*angle*angle/(2.5*sigma*sigma))*.06*mag;
  vec3 tint=mix(vec3(.60,.70,1.0),vec3(1.0,.84,.68),h4);
  return tint*(core*(.20+3.6*mag)+glow)*gain;
}
vec3 atmosphere(vec3 rd, bool disk) {
  const float R=6371000.0,A=6471000.0;
  const vec3 betaR=vec3(5.8e-6,13.5e-6,33.1e-6);
  const vec3 betaM=vec3(3.5e-6);
  vec3 ro=vec3(0.0,R+18.0,0.0);
  vec2 interval=sphere(ro,rd,A);
  float lengthRay=interval.y;
  vec2 ground=sphere(ro,rd,R);
  if(ground.x>0.0)lengthRay=min(lengthRay,ground.x);
  float ds=lengthRay/float(MARCH_STEPS);
  vec2 depth=vec2(0.0);
  vec3 sum=vec3(0.0);
  for(int j=0;j<MARCH_STEPS;j++) {
    vec3 pos=ro+rd*(float(j)+.5)*ds;
    float h=max(0.0,length(pos)-R);
    vec2 density=exp(-h/vec2(8000.0,1200.0));
    depth+=density*ds;
    for(int i=0;i<3;i++) {
      float ls=sphere(pos,suns[i],A).y/float(SHADOW_STEPS);
      vec2 sd=vec2(0.0);
      bool shadow=false;
      for(int k=0;k<SHADOW_STEPS;k++) {
        float sh=length(pos+suns[i]*(float(k)+.5)*ls)-R;
        if(sh<0.0)shadow=true;
        sd+=exp(-max(sh,0.0)/vec2(8000.0,1200.0))*ls;
      }
      if(!shadow) {
        float mu=dot(rd,suns[i]);
        float pr=3.0/(16.0*PI)*(1.0+mu*mu);
        float g=.78;
        float pm=3.0/(8.0*PI)*((1.0-g*g)*(1.0+mu*mu))/((2.0+g*g)*pow(max(.001,1.0+g*g-2.0*g*mu),1.5));
        vec3 tr=exp(-(betaR*(depth.x+sd.x)+betaM*1.1*(depth.y+sd.y)));
        sum+=tr*(density.x*betaR*pr+density.y*betaM*pm)*ds*sunColors[i]*min(powers[i],35.0)*18.0;
      }
    }
  }
  vec3 extinction=exp(-betaR*depth.x-betaM*depth.y);
  if(disk && rd.y>-.006) for(int i=0;i<3;i++) {
    float angle=acos(clamp(dot(rd,suns[i]),-1.0,1.0));
    // Novel semantics: apparent size is the physical angular size. A distant sun
    // degrades into a flying star (a point image); a close one blooms into a disk.
    // Surface brightness is distance-independent -- only the size changes.
    float ppr=resolution.y/fov;
    float starPx=radii[i]*ppr;
    float limb=1.0-smoothstep(radii[i]*.3,radii[i],angle);
    float edge=max(radii[i]*.16,1.3/ppr);
    float diskVis=1.0-smoothstep(radii[i]-edge,radii[i]+edge,angle);
    float surf=clamp(powers[i]*6.0,.4,3.0);
    vec3 diskColor=mix(vec3(1.05,1.02,.98),sunColors[i],.5);
    // Disk: surface brightness is distance-independent, so a close sun blinds.
    float diskBright=(6.0+54.0*limb)*diskVis*surf;
    // Flying star: a bare point whose brightness sits in the SAME range as the
    // background stars (0.12-1.1), so a distant sun reads as "a star" rather
    // than a small sun. Only its angular size and the halo below change with
    // distance -- and the disk branch takes over the moment it is a few px wide.
    float pointBright=clamp(powers[i]*4.0,.12,1.1)*exp(-0.5*angle*angle*ppr*ppr/0.72);
    sum+=diskColor*extinction*mix(pointBright,diskBright,smoothstep(1.1,3.2,starPx));
    // Halo switches on sharply (flux^2, no floor): a far flying star carries no
    // fuzzy glow, while an approaching sun floods the sky instead of creeping.
    float glow=exp(-angle/.03)+exp(-angle/.14)*.22;
    sum+=sunColors[i]*extinction*glow*2.4*clamp(powers[i]*powers[i]*6.0,0.0,3.0)*smoothstep(-.06,.01,suns[i].y);
  }
  float daylight=0.0;
  for(int i=0;i<3;i++)daylight+=max(0.0,suns[i].y+.09)*powers[i];
  float night=exp(-daylight*9.0);
  sum+=vec3(.0008,.0015,.0026)*night;
  if(disk && rd.y>0.0 && proceduralStars>.5) {
    // Fallback only: when the real catalogue is embedded the stars come from the
    // point sprites in the world scene, which also rotate with the planet.
    vec2 st=vec2(atan(rd.z,rd.x),asin(rd.y));
    float ppr=resolution.y/fov;
    vec3 field=starLayer(st,ppr,40.0,.00048,1.4,0.0)
              +starLayer(st,ppr,80.0,.00038,.9,17.0)
              +starLayer(st,ppr,170.0,.00041,.55,41.0);
    float band=pow(max(0.0,1.0-abs(rd.x*.5+rd.y*.7+rd.z*.2)),12.0);
    sum+=night*(field+vec3(.001,.0012,.0017)*fbm(rd.xz*100.0)*band);
  }
  return sum;
}
vec3 sunlight(vec3 normal) {
  vec3 light=vec3(.009,.013,.018);
  for(int i=0;i<3;i++) {
    float altitude=max(.025,suns[i].y);
    vec3 trans=exp(-vec3(.06,.12,.25)/altitude);
    light+=sunColors[i]*trans*min(powers[i],20.0)*max(0.0,dot(normal,suns[i]))*smoothstep(-.025,.02,suns[i].y)*1.8;
  }
  return light;
}

vec3 clouds(vec3 rd,vec3 sky) {
  if(rd.y<.015 || cloudCover<.01)return sky;
  // Clouds ride the WEATHER clock (simulated days), so their drift scales with
  // the chosen time speed; the ocean below keeps the wall-clock to stay readable.
  float t=weatherClock;
  vec2 p=rd.xz/rd.y*1.3+vec2(t*.045,t*.014);
  float cover=clamp(cloudCover,0.0,1.0);
  // The morph offset drifts against the wind so cloud shapes evolve instead of
  // sliding rigidly -- combined with the faster wind the layer visibly moves.
  vec2 morph=vec2(-t*.013,t*.009);
  float base=fbm(p*.7+morph);
  float density=smoothstep(.68-cover*.37,.86-cover*.4,base);
  float detail=fbm(p*4.0+vec2(t*.02,-t*.015));
  density*=mix(.5,1.0,detail);
  float farFade=smoothstep(.015,.12,rd.y);
  vec3 light=vec3(.016,.023,.033);
  for(int i=0;i<3;i++) {
    float shadow=fbm(p*.7+suns[i].xz*.42);
    float direct=exp(-max(0.0,shadow-base+.06)*9.0);
    float rim=pow(max(0.0,dot(rd,suns[i])),24.0);
    vec3 trans=exp(-vec3(.07,.14,.28)/max(.035,suns[i].y+.08));
    light+=sunColors[i]*trans*min(powers[i],15.0)*smoothstep(-.12,.14,suns[i].y)*(direct*.7+rim*.9);
  }
  light*=.55+detail*.7;
  float alpha=(1.0-exp(-density*3.3))*farFade;
  return mix(sky,light,alpha);
}
float wave(vec2 p) {
  float t=clock;
  return sin(p.x*.7+p.y*.9+t*.8)*.27+sin(p.x*1.5-p.y*.5+t*1.2)*.14
    +sin(p.x*3.3+p.y*1.8-t*1.5)*.06+sin(p.y*6.0+p.x*2.3+t*2.1)*.025
    +(noise(p*12.0+t*.6)-.5)*.025;
}
float ridge(float a,float layer) {
  // Per-layer frequency and phase so the three ridgelines stop reading as one
  // repeated silhouette; varied amplitude breaks the paper-cut look.
  vec2 p=vec2(cos(a),sin(a))*(3.0+layer*1.9)+vec2(layer*37.0,layer*89.0);
  float f=fbm(p*(1.0+layer*.22));
  return .003+pow(f,2.6)*(.62+layer*.13)*(0.3+0.7*noise(p*.35+layer*13.0));
}
vec3 shadeWater(vec3 rd) {
  float dist=18.0/max(.0001,-rd.y);
  vec2 p=rd.xz*dist*.065;
  float eps=.015;
  float wx=(wave(p+vec2(eps,0))-wave(p-vec2(eps,0)))/(eps*2.0);
  float wz=(wave(p+vec2(0,eps))-wave(p-vec2(0,eps)))/(eps*2.0);
  float flatten=mix(.15,1.0,smoothstep(0.0,.4,-rd.y));
  vec3 n=normalize(vec3(-wx*.12*flatten,1.0,-wz*.12*flatten));
  vec3 ref=reflect(rd,n);
  vec3 reflection=atmosphere(ref,false);
  float fres=.02+.98*pow(1.0-max(0.0,dot(-rd,n)),5.0);
  vec3 water=vec3(.006,.032,.038)*sunlight(vec3(0,1,0));
  vec3 color=mix(water,reflection,clamp(fres*1.5+.05,0.0,1.0));
  for(int i=0;i<3;i++) {
    vec3 halfV=normalize(suns[i]-rd);
    float nh=max(0.0,dot(n,halfV));
    float rough=.008+min(.016,dist*.0000008);
    float spec=rough/(PI*pow(nh*nh*(rough-1.0)+1.0,2.0));
    vec3 trans=exp(-vec3(.08,.15,.29)/max(.03,suns[i].y));
    color+=sunColors[i]*trans*min(powers[i],20.0)*spec*.006*smoothstep(-.005,.025,suns[i].y);
  }
  // Aerial perspective: far water converges to the SAME horizon sky color so
  // the horizon reads as an atmospheric blend, not a branch-switch edge.
  vec3 horizonSky=atmosphere(normalize(vec3(rd.x,.016,rd.z)),false);
  float mist=1.0-exp(-dist*.000045);
  color=mix(color,horizonSky,mist);
  float frozen=smoothstep(245.0,175.0,temperature);
  color=mix(color,vec3(.23,.32,.37)*.8*sunlight(n)+reflection*.2,frozen*.75);
  return color;
}
vec3 aces(vec3 x){return clamp((x*(2.51*x+.03))/(x*(2.43*x+.59)+.14),0.0,1.0);}
void main() {
  vec2 uv=vUv*2.0-1.0; uv.x*=resolution.x/resolution.y;
  vec3 rd=normalize(vec3(uv*tan(fov*.5),-1.0));
  rd.yz=mat2(cos(pitch),sin(pitch),-sin(pitch),cos(pitch))*rd.yz;
  rd.xz=mat2(cos(yaw),-sin(yaw),sin(yaw),cos(yaw))*rd.xz;
  vec3 sky=clouds(rd,atmosphere(rd,true));
  vec3 color = rd.y>=0.0 ? sky : shadeWater(rd);
  // Horizon seam: cross-fade the sky and water looks across +-0.007 rad so the
  // boundary is an atmospheric blend, not a one-pixel branch-switch edge.
  if(abs(rd.y)<.007) {
    vec3 rdS=normalize(vec3(rd.x,.0025,rd.z));
    vec3 rdW=normalize(vec3(rd.x,-.0025,rd.z));
    vec3 skySide=clouds(rdS,atmosphere(rdS,true));
    vec3 waterSide=shadeWater(rdW);
    color=mix(waterSide,skySide,smoothstep(-.007,.007,rd.y));
  }
  float angle=atan(rd.z,rd.x);
  float elevation=atan(rd.y,length(rd.xz));
  if(distantMountainsReady>.5 && elevation>-.025 && elevation<.30) {
    // Mirrored panorama closes the 360-degree loop without a hard seam.
    float u=1.0-abs(2.0*fract(angle/PI+.5)-1.0);
    float v=(elevation+.025)/.325;
    vec4 mountains=texture2D(distantMountains,vec2(u,v));
    vec3 albedo=pow(max(mountains.rgb,vec3(0.0)),vec3(2.2));
    vec3 haze=atmosphere(normalize(vec3(rd.x,.035,rd.z)),false);
    float sunHeight=max(suns[0].y,max(suns[1].y,suns[2].y));
    float skyGlow=smoothstep(-.16,.08,sunHeight);
    vec3 rock=albedo*(sunlight(vec3(0,1,0))*.65+vec3(.12,.15,.18)*skyGlow);
    // Atmospheric light makes distant ridges softer and paler than foreground.
    rock=mix(rock,haze,.18);
    float alpha=mountains.a*smoothstep(-.025,.006,elevation);
    color=mix(color,rock,alpha);
  }
  if(terrainMesh<.5) {
    for(int j=0;j<3;j++) {
      float layer=float(j);
      float height=ridge(angle,layer);
      float elevation=atan(rd.y,length(rd.xz));
      if(elevation<height && elevation>-.003) {
        float slope=(ridge(angle+.002,layer)-height)/.002;
        vec3 normal=normalize(vec3(cos(angle)*.5-sin(angle)*slope,1.0,sin(angle)*.5+cos(angle)*slope));
        float detail=fbm(vec2(angle*55.0,elevation*240.0)+layer*90.0);
        vec3 rock=mix(vec3(.05,.062,.048),vec3(.21,.18,.14),detail)*sunlight(normal);
        float snow=smoothstep(.075,.17,height)*smoothstep(.42,.72,detail)*(1.0-smoothstep(300.0,350.0,temperature));
        rock=mix(rock,vec3(.5,.55,.57)*sunlight(normal),snow);
        float haze=.6-layer*.17;
        color=mix(rock,atmosphere(normalize(vec3(rd.x,.025,rd.z)),false)*.75,haze);
      }
    }
    // Near coastal rock shelf, textured in world-space with ocean at the right.
    if(rd.y<-.14) {
      float d=18.0/-rd.y;
      vec2 p=rd.xz*d;
      float edge=-24.0+sin(p.y*.035)*11.0+noise(p*.045)*8.0;
      if(p.x<edge) {
        float tex=fbm(p*.65);
        vec3 n=normalize(vec3(noise(p*.25)-.5,1.0,noise(p*.31+5.0)-.5));
        vec3 rock=mix(vec3(.055,.06,.052),vec3(.24,.2,.16),tex)*sunlight(n);
        float wet=1.0-smoothstep(0.0,8.0,edge-p.x);
        color=mix(rock,rock*.45+sky*.12,wet);
      }
    }
  }
  color=aces(color*exposure);
  color=pow(color,vec3(1.0/2.2));
  float grain=(hash(gl_FragCoord.xy+fract(clock)*91.0)-.5)/255.0;
  gl_FragColor=vec4(color+grain,1.0);
}
`;
