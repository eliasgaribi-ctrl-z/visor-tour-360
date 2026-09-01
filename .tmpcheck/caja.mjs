import * as THREE from 'three'
const DEG = Math.PI/180

// Reimplementación exacta de PanoramaStitcher.caja
function caja(toma){
  const tanH = Math.tan((toma.hfov*DEG)/2)
  const tanV = Math.tan((toma.vfov*DEG)/2)
  const dir = new THREE.Vector3()
  let pitchMin=90,pitchMax=-90,yawMin=Infinity,yawMax=-Infinity,yawCentro=0
  const proyectar=(sx,sy)=>{
    dir.set(sx*tanH, sy*tanV, -1).applyQuaternion(toma.orientacion).normalize()
    const pitch=Math.asin(Math.max(-1,Math.min(1,dir.y)))/DEG
    const yaw=Math.atan2(dir.x,-dir.z)/DEG
    return {yaw,pitch}
  }
  const centro=proyectar(0,0)
  yawCentro=centro.yaw
  pitchMin=pitchMax=centro.pitch
  yawMin=yawMax=0
  const PASOS=16
  for(let i=0;i<=PASOS;i++){
    const t=(i/PASOS)*2-1
    for(const [sx,sy] of [[t,-1],[t,1],[-1,t],[1,t]]){
      const {yaw,pitch}=proyectar(sx,sy)
      pitchMin=Math.min(pitchMin,pitch); pitchMax=Math.max(pitchMax,pitch)
      let delta=yaw-yawCentro
      while(delta>180) delta-=360
      while(delta<-180) delta+=360
      yawMin=Math.min(yawMin,delta); yawMax=Math.max(yawMax,delta)
    }
  }
  const polar=new THREE.Quaternion()
  const contienePolo=(signo)=>{
    dir.set(0,signo,0).applyQuaternion(polar.copy(toma.orientacion).invert())
    if(dir.z> -1e-6) return false
    return Math.abs(dir.x/-dir.z)<=tanH && Math.abs(dir.y/-dir.z)<=tanV
  }
  let x0,x1
  if(contienePolo(1)||contienePolo(-1)){
    if(contienePolo(1)) pitchMax=90
    if(contienePolo(-1)) pitchMin=-90
    x0=-1;x1=1
  } else {
    const margen=1
    x0=(yawCentro+yawMin-margen)/180
    x1=(yawCentro+yawMax+margen)/180
  }
  const y0=Math.max(-1,(pitchMin-1)/90)
  const y1=Math.min(1,(pitchMax+1)/90)
  const copias=[0]
  if(x0<-1) copias.push(2)
  if(x1>1) copias.push(-2)
  return {x0,x1,y0,y1,copias}
}

// ¿el píxel del lienzo (ndc x,y) cae dentro de la foto? (mismo shader)
function dentroFoto(ndcx,ndcy,toma,inv){
  const yaw=ndcx*Math.PI, pitch=ndcy*Math.PI*0.5
  const cp=Math.cos(pitch)
  const d=new THREE.Vector3(cp*Math.sin(yaw),Math.sin(pitch),-cp*Math.cos(yaw)).applyQuaternion(inv)
  if(d.z>-1e-4) return false
  const px=(d.x/-d.z)/Math.tan(toma.hfov*DEG/2)
  const py=(d.y/-d.z)/Math.tan(toma.vfov*DEG/2)
  return Math.abs(px)<=1 && Math.abs(py)<=1
}

// ¿el ndc queda cubierto por alguna de las copias dibujadas?
function cubiertoPorCaja(ndcx,ndcy,c){
  for(const off of c.copias){
    const x0=c.x0+off, x1=c.x1+off
    if(ndcx>=x0 && ndcx<=x1 && ndcy>=c.y0 && ndcy<=c.y1) return true
  }
  return false
}

const N=900, M=450
let peorGlobal=null
function probar(toma,etiqueta){
  const inv=toma.orientacion.clone().invert()
  const c=caja(toma)
  let perdidos=0, total=0, ejemplo=null
  for(let j=0;j<M;j++){
    const ndcy=((j+0.5)/M)*2-1
    for(let i=0;i<N;i++){
      const ndcx=((i+0.5)/N)*2-1
      if(!dentroFoto(ndcx,ndcy,toma,inv)) continue
      total++
      if(!cubiertoPorCaja(ndcx,ndcy,c)){perdidos++; if(!ejemplo) ejemplo={ndcx,ndcy,yaw:ndcx*180,pitch:ndcy*90}}
    }
  }
  if(perdidos>0){
    const frac=perdidos/total
    if(!peorGlobal||frac>peorGlobal.frac) peorGlobal={frac,etiqueta,c,ejemplo,total,perdidos}
    return {frac,ejemplo,total,perdidos,c}
  }
  return null
}

// barrido: pitch de cámara, roll, yaw
const fovs=[[66,52],[52,66],[80,60],[40,30],[100,80]]
let fallos=0, casos=0
for(const [hfov,vfov] of fovs){
  for(let pitch=-90;pitch<=90;pitch+=3){
    for(const roll of [0,15,35,45,60,90]){
      for(const yaw of [0,17,90,175,180,-90]){
        const q=new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch*DEG,-yaw*DEG,0,'YXZ'))
        q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,0,1), roll*DEG))
        const toma={hfov,vfov,orientacion:q}
        casos++
        const r=probar(toma,`hfov${hfov} vfov${vfov} pitch${pitch} roll${roll} yaw${yaw}`)
        if(r){fallos++; if(fallos<12) console.log('FALLO',hfov,vfov,'pitch',pitch,'roll',roll,'yaw',yaw,'perdido',(r.frac*100).toFixed(2)+'%','ej',r.ejemplo,'caja',r.c)}
      }
    }
  }
}
console.log('casos',casos,'fallos',fallos)
if(peorGlobal) console.log('PEOR',peorGlobal.etiqueta,(peorGlobal.frac*100).toFixed(2)+'%',peorGlobal.ejemplo,peorGlobal.c)
