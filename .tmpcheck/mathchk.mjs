import * as THREE from 'three'
const DEG=Math.PI/180
const clamp=(v,a,b)=>v<a?a:v>b?b:v
const yawPitchToVector3=(y,p,r=1,out=new THREE.Vector3())=>{const yy=y*DEG,pp=p*DEG,cp=Math.cos(pp);return out.set(cp*Math.sin(yy),Math.sin(pp),-cp*Math.cos(yy)).multiplyScalar(r)}
const v2yp=v=>{const l=v.length()||1;return {yaw:Math.atan2(v.x,-v.z)/DEG,pitch:Math.asin(clamp(v.y/l,-1,1))/DEG}}
function screenToYawPitch(x,y,w,h,cam,out=new THREE.Vector3()){
  const aspect=w/h, focal=1/Math.tan((cam.fov*DEG)/2)
  const ndcX=(x/w)*2-1, ndcY=1-(y/h)*2
  out.set(ndcX*aspect/focal, ndcY/focal, -1).normalize()
  out.applyEuler(new THREE.Euler(cam.pitch*DEG,-cam.yaw*DEG,0,'YXZ'))
  return v2yp(out)
}
const _e=new THREE.Euler(0,0,0,'YXZ'),_q=new THREE.Quaternion(),_d=new THREE.Vector3()
function yawPitchToScreen(yd,pd,cam,w,h){
  const aspect=w/h, focal=1/Math.tan((cam.fov*DEG)/2)
  _e.set(cam.pitch*DEG,-cam.yaw*DEG,0,'YXZ'); _q.setFromEuler(_e).invert()
  yawPitchToVector3(yd,pd,1,_d).applyQuaternion(_q)
  if(_d.z>-0.05) return null
  const ndcX=(_d.x/-_d.z)*(focal/aspect), ndcY=(_d.y/-_d.z)*focal
  return {x:(ndcX*0.5+0.5)*w,y:(1-(ndcY*0.5+0.5))*h}
}
// 1) round trip pantalla -> yawpitch -> pantalla
let peor=0,caso=null
for(const cam of [{yaw:0,pitch:0,fov:75},{yaw:137,pitch:-40,fov:35},{yaw:-179,pitch:80,fov:100},{yaw:45,pitch:89,fov:60},{yaw:0,pitch:-89.9,fov:60}]){
 for(const [w,h] of [[800,400],[390,844],[1200,900]]){
  for(let x=0;x<=w;x+=w/8) for(let y=0;y<=h;y+=h/8){
    const {yaw,pitch}=screenToYawPitch(x,y,w,h,cam)
    const p=yawPitchToScreen(yaw,pitch,cam,w,h)
    if(!p){console.log('NULL en round trip',cam,x,y,yaw,pitch);continue}
    const e=Math.hypot(p.x-x,p.y-y)
    if(e>peor){peor=e;caso={cam,w,h,x,y,yaw,pitch,p}}
  }
 }
}
console.log('round trip pantalla peor error px:',peor.toFixed(6), JSON.stringify(caso))

// 2) coherencia con three: camara real
const escena=new THREE.Scene()
for(const cam of [{yaw:23,pitch:-31,fov:70},{yaw:-160,pitch:65,fov:50}]){
  const w=800,h=450
  const c=new THREE.PerspectiveCamera(cam.fov,w/h,0.1,10)
  c.rotation.order='YXZ'; c.rotation.y=-cam.yaw*DEG; c.rotation.x=cam.pitch*DEG; c.updateMatrixWorld()
  c.updateProjectionMatrix()
  for(const [yaw,pitch] of [[cam.yaw,cam.pitch],[cam.yaw+10,cam.pitch+5],[cam.yaw-25,cam.pitch-12]]){
    const v=yawPitchToVector3(yaw,pitch,1).project(c)
    const esperado={x:(v.x*0.5+0.5)*w,y:(1-(v.y*0.5+0.5))*h}
    const got=yawPitchToScreen(yaw,pitch,cam,w,h)
    console.log('three vs formula', JSON.stringify(esperado), JSON.stringify(got))
  }
}
