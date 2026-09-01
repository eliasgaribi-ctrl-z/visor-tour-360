import * as THREE from 'three'
const DEG=Math.PI/180
function extremos(hfov,vfov,q,PASOS){
  const tanH=Math.tan(hfov*DEG/2), tanV=Math.tan(vfov*DEG/2)
  const dir=new THREE.Vector3()
  const proyectar=(sx,sy)=>{dir.set(sx*tanH,sy*tanV,-1).applyQuaternion(q).normalize()
    return {yaw:Math.atan2(dir.x,-dir.z)/DEG,pitch:Math.asin(Math.max(-1,Math.min(1,dir.y)))/DEG}}
  const c=proyectar(0,0)
  let pmin=c.pitch,pmax=c.pitch,ymin=0,ymax=0
  for(let i=0;i<=PASOS;i++){
    const t=(i/PASOS)*2-1
    for(const [sx,sy] of [[t,-1],[t,1],[-1,t],[1,t]]){
      const {yaw,pitch}=proyectar(sx,sy)
      pmin=Math.min(pmin,pitch);pmax=Math.max(pmax,pitch)
      let d=yaw-c.yaw; while(d>180)d-=360; while(d<-180)d+=360
      ymin=Math.min(ymin,d);ymax=Math.max(ymax,d)
    }
  }
  return {pmin,pmax,ymin,ymax,yc:c.yaw}
}
function contienePolo(hfov,vfov,q,signo){
  const tanH=Math.tan(hfov*DEG/2),tanV=Math.tan(vfov*DEG/2)
  const d=new THREE.Vector3(0,signo,0).applyQuaternion(q.clone().invert())
  if(d.z>-1e-6) return false
  return Math.abs(d.x/-d.z)<=tanH && Math.abs(d.y/-d.z)<=tanV
}
const fovs=[[66,51.9],[51.9,66],[80,60],[100,80],[40,30],[90,90],[66,66]]
for(const [hfov,vfov] of fovs){
  let peorP=0,peorY=0,cP=null,cY=null
  for(let pitch=-90;pitch<=90;pitch+=1){
    for(let roll=0;roll<=90;roll+=3){
      const q=new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch*DEG,0,0,'YXZ'))
        .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,0,1),roll*DEG))
      if(contienePolo(hfov,vfov,q,1)||contienePolo(hfov,vfov,q,-1)) continue
      const a=extremos(hfov,vfov,q,16), b=extremos(hfov,vfov,q,4000)
      const eP=Math.max(a.pmin-b.pmin, b.pmax-a.pmax)
      const eY=Math.max(a.ymin-b.ymin, b.ymax-a.ymax)
      if(eP>peorP){peorP=eP;cP={pitch,roll,a,b}}
      if(eY>peorY){peorY=eY;cY={pitch,roll,a,b}}
    }
  }
  console.log(`hfov${hfov} vfov${vfov}: error max pitch ${peorP.toFixed(2)}° (${cP&&cP.pitch}/${cP&&cP.roll}) | error max yaw ${peorY.toFixed(2)}° (${cY&&cY.pitch}/${cY&&cY.roll})`)
  if(peorP>1) console.log('   detalle pitch', JSON.stringify(cP))
  if(peorY>1) console.log('   detalle yaw', JSON.stringify(cY))
}
