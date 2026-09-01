import{A as e}from"./index-BTfA1CkX.js";import{B as t,D as n,E as r,F as i,I as a,P as o,R as s,S as c,T as l,_ as u,d,h as f,k as p,m,p as h,t as g,w as _,y as v,z as y}from"./math-Cb7BJ_En.js";function b(e,t,n=66){let r=Math.max(e,t),i=Math.min(e,t),a=Math.tan(n*g/2),o=2*Math.atan(i/r*a)/g;return e>=t?{hfov:n,vfov:o}:{hfov:o,vfov:n}}function x(e,t,n){if(t>=n)return e;let r=Math.tan(e*g/2);return 2*Math.atan(n/t*r)/g}function S(e,t){let n=document.createElement(`canvas`);return n.width=e,n.height=t,n}function C(e){e.width=0,e.height=0}function w(e,t){let n=S(e,t);try{let r=n.getContext(`2d`,{willReadFrequently:!0});if(!r)return!1;r.fillStyle=`#ff0000`,r.fillRect(e-1,t-1,1,1);let{data:i}=r.getImageData(e-1,t-1,1,1);return i[0]>200&&i[1]<60}catch(e){return!1}finally{C(n)}}var T=[4096,3072,2048,1024];function E(e=4096){for(let t of T)if(!(t>e)&&w(t,t/2))return t;return 1024}function D(e,t=1600){let n=Math.min(1,t/(e.videoWidth||t)),r=Math.max(1,Math.round((e.videoWidth||t)*n)),i=Math.max(1,Math.round((e.videoHeight||t)*n)),a=S(r,i),o=a.getContext(`2d`,{alpha:!1});if(!o)throw Error(`No se pudo preparar el lienzo de la toma.`);return o.drawImage(e,0,0,r,i),a}function O(e,t=32){let n=S(t,t).getContext(`2d`,{alpha:!1,willReadFrequently:!0});if(!n)return .5;n.drawImage(e,0,0,t,t);let{data:r}=n.getImageData(0,0,t,t),i=0;for(let e=0;e<r.length;e+=4)i+=.2126*r[e]+.7152*r[e+1]+.0722*r[e+2];return i/(t*t*255)}function k(e,t,n){let r=S(t,n).getContext(`2d`,{alpha:!1,willReadFrequently:!0});if(!r)return new Float32Array(t*n);r.drawImage(e,0,0,t,n);let{data:i}=r.getImageData(0,0,t,n),a=new Float32Array(t*n);for(let e=0,t=0;e<i.length;e+=4,t++)a[t]=(.2126*i[e]+.7152*i[e+1]+.0722*i[e+2])/255;return a}function A(e,t,n,r,i=Math.floor(n*.45)){let a=Math.floor(r*.25),o=Math.ceil(r*.75),s=n*(o-a)*.35,c=new Float32Array(2*i+1).fill(-2),l=0,u=-2;for(let r=-i;r<=i;r++){let d=0,f=0,p=0,m=0,h=0,g=0;for(let i=a;i<o;i++){let a=i*n,o=Math.max(0,-r),s=Math.min(n,n-r);for(let n=o;n<s;n++){let i=e[a+n],o=t[a+n+r];d+=i,f+=o,p+=i*i,m+=o*o,h+=i*o,g++}}if(g<s)continue;let _=d/g,v=f/g,y=h/g-_*v,b=p/g-_*_,x=m/g-v*v,S=y/Math.sqrt(Math.max(b,1e-9)*Math.max(x,1e-9));c[r+i]=S,S>u&&(u=S,l=r)}let d=l,f=l+i;if(f>0&&f<c.length-1){let e=c[f-1],t=c[f+1];if(e>-2&&t>-2){let n=e-2*u+t;if(Math.abs(n)>1e-6){let r=.5*(e-t)/n;Math.abs(r)<=1&&(d=l+r)}}}return{pixeles:d,confianza:u}}function j(e){let{anterior:t,actual:n,width:r,height:i,deltaYaw:a,deltaPitch:o}=e;if(Math.abs(a)<3||Math.abs(a)>20||Math.abs(o)>4)return null;let{pixeles:s,confianza:c}=A(t,n,r,i);if(c<.45||Math.abs(s)<1)return null;let l=Math.abs(s)/Math.tan(Math.abs(a)*g),u=2*Math.atan(r/(2*l))/g;return u<34||u>110?null:u}function M(e){if(e.length===0)return null;let t=[...e].sort((e,t)=>e-t),n=Math.floor(t.length/2);return t.length%2?t[n]:(t[n-1]+t[n])/2}async function N(e,t=320,n=.72){let r=`naturalWidth`in e?e.naturalWidth:e.width,i=`naturalHeight`in e?e.naturalHeight:e.height,a=Math.max(1,Math.round(t*i/r)),o=S(t,a),s=o.getContext(`2d`,{alpha:!1});if(!s)throw Error(`No se pudo generar la miniatura.`);s.imageSmoothingQuality=`high`,s.drawImage(e,0,0,t,a);let c=await new Promise(e=>o.toBlob(e,`image/jpeg`,n));if(!c)throw Error(`No se pudo generar la miniatura.`);return c}var P=`
  varying vec2 vNdc;
  void main() {
    // Las posiciones YA vienen en coordenadas de pantalla normalizadas: el
    // lienzo equirectangular ES el viewport, así que no hay matrices de cámara.
    vNdc = position.xy;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`,F=`
  precision highp float;

  uniform sampler2D uFoto;
  uniform mat3 uMundoACamara;
  uniform vec2 uTanMitad;   // (tan(hfov/2), tan(vfov/2))
  uniform float uDifuminado; // fracción del borde que se desvanece (0.02 … 0.4)
  uniform float uGanancia;   // corrección de exposición

  varying vec2 vNdc;

  const float PI = 3.141592653589793;

  void main() {
    // 1. Píxel del lienzo → dirección del mundo.
    //    x ∈ [-1,1] recorre yaw de -180° a 180°; y ∈ [-1,1] recorre pitch de -90° a 90°.
    float yaw = vNdc.x * PI;
    float pitch = vNdc.y * PI * 0.5;
    float cp = cos(pitch);
    vec3 dir = vec3(cp * sin(yaw), sin(pitch), -cp * cos(yaw));

    // 2. A espacio de la cámara. La cámara mira hacia -Z.
    vec3 d = uMundoACamara * dir;
    if (d.z > -0.0001) discard;              // queda atrás: no es parte de la foto

    // 3. Proyección gnomónica: la misma que hace una lente.
    vec2 plano = vec2(d.x / -d.z, d.y / -d.z) / uTanMitad;
    if (abs(plano.x) > 1.0 || abs(plano.y) > 1.0) discard;

    vec2 uv = plano * 0.5 + 0.5;

    // 4. Peso: 1 en el centro, 0 en el borde exacto.
    vec2 orilla = min(uv, 1.0 - uv) / max(uDifuminado, 0.001);
    float a = clamp(min(orilla.x, orilla.y), 0.0, 1.0);
    a = a * a * (3.0 - 2.0 * a);             // smoothstep a mano

    vec3 color = texture2D(uFoto, uv).rgb * uGanancia;
    gl_FragColor = vec4(color * a, a);       // alfa premultiplicado
  }
`,I=`
  precision highp float;
  uniform sampler2D uAcumulado;
  uniform vec3 uVacio;
  varying vec2 vNdc;
  void main() {
    vec2 uv = vNdc * 0.5 + 0.5;
    vec4 acc = texture2D(uAcumulado, uv);
    // Debajo de este alfa se considera "no fotografiado": pintarlo sería
    // amplificar ruido hasta convertirlo en manchas de colores.
    if (acc.a < 0.02) {
      gl_FragColor = vec4(uVacio, 1.0);
      return;
    }
    gl_FragColor = vec4(acc.rgb / acc.a, 1.0);
  }
`,L=4,R=2;function z(e){var t;let n=e.capabilities.maxTextureSize,r=(t=navigator.deviceMemory)==null?4:t;return n>=4096&&r>=4?4096:n>=2048?2048:1024}var B=class{constructor(a={}){var f,g,b,x;e(this,`width`,void 0),e(this,`height`,void 0),e(this,`canvas`,void 0),e(this,`renderer`,void 0),e(this,`acumulado`,void 0),e(this,`escena`,new o),e(this,`escenaNormalizar`,new o),e(this,`camara`,new n(-1,1,1,-1,0,1)),e(this,`malla`,void 0),e(this,`material`,void 0),e(this,`materialNormalizar`,void 0),e(this,`posiciones`,void 0),e(this,`matriz`,new l),e(this,`matriz3`,new _),e(this,`direccion`,new y),e(this,`brilloReferencia`,null),e(this,`tomas`,0),e(this,`polar`,new p),this.renderer=new d({alpha:!1,antialias:!1,preserveDrawingBuffer:!0,powerPreference:`high-performance`}),this.renderer.autoClear=!1;let S=(f=a.width)==null?z(this.renderer):f;this.width=Math.min(S,this.renderer.capabilities.maxTextureSize),this.height=this.width/2;let C=(g=a.preview)==null?{width:640,height:320}:g;this.renderer.setPixelRatio(1),this.renderer.setSize(C.width,C.height,!1),this.canvas=this.renderer.domElement,this.acumulado=new t(this.width,this.height,{depthBuffer:!1,stencilBuffer:!1,minFilter:c,magFilter:c,colorSpace:``});let w=new m;this.posiciones=new h(new Float32Array(12),3),this.posiciones.setUsage(v),w.setAttribute(`position`,this.posiciones),w.setIndex([0,1,2,0,2,3]),this.material=new i({vertexShader:P,fragmentShader:F,uniforms:{uFoto:{value:null},uMundoACamara:{value:new _},uTanMitad:{value:new s(1,1)},uDifuminado:{value:(b=a.difuminado)==null?.14:b},uGanancia:{value:1}},transparent:!0,depthTest:!1,depthWrite:!1,blending:5,blendEquation:100,blendSrc:201,blendDst:205,blendEquationAlpha:100,blendSrcAlpha:201,blendDstAlpha:205}),this.malla=new r(w,this.material),this.malla.frustumCulled=!1,this.escena.add(this.malla);let T=new u((x=a.colorVacio)==null?1119775:x);this.materialNormalizar=new i({vertexShader:P,fragmentShader:I,uniforms:{uAcumulado:{value:this.acumulado.texture},uVacio:{value:new y(T.r,T.g,T.b)}},depthTest:!1,depthWrite:!1});let E=new m;E.setAttribute(`position`,new h(new Float32Array([-1,-1,0,1,-1,0,1,1,0,-1,1,0]),3)),E.setIndex([0,1,2,0,2,3]);let D=new r(E,this.materialNormalizar);D.frustumCulled=!1,this.escenaNormalizar.add(D),this.limpiar()}limpiar(){let e=this.renderer.getRenderTarget();this.renderer.setRenderTarget(this.acumulado),this.renderer.setClearColor(0,0),this.renderer.clear(!0,!1,!1),this.renderer.setRenderTarget(e),this.brilloReferencia=null,this.tomas=0,this.dibujarPreview()}get totalTomas(){return this.tomas}agregar(e){let t=new a(e.fuente);t.colorSpace=``,t.minFilter=c,t.magFilter=c,t.wrapS=f,t.wrapT=f,t.generateMipmaps=!1,t.flipY=!0,t.needsUpdate=!0;let n=this.material.uniforms;n.uFoto.value=t,n.uTanMitad.value.set(Math.tan(e.hfov*g/2),Math.tan(e.vfov*g/2)),this.matriz.makeRotationFromQuaternion(e.orientacion).invert(),this.matriz3.setFromMatrix4(this.matriz),n.uMundoACamara.value.copy(this.matriz3),n.uGanancia.value=this.ganancia(e.brillo);let r=this.caja(e),i=this.renderer.getRenderTarget();this.renderer.setRenderTarget(this.acumulado);for(let e of r.copias)this.escribirCuadro(r.x0+e,r.x1+e,r.y0,r.y1),this.renderer.render(this.escena,this.camara);this.renderer.setRenderTarget(i),t.dispose(),this.tomas++,this.dibujarPreview()}ganancia(e){if(e===void 0||e<=.001)return 1;if(this.brilloReferencia===null)return this.brilloReferencia=e,1;let t=this.brilloReferencia/e;return Math.min(1.5,Math.max(.66,t))}escribirCuadro(e,t,n,r){let i=this.posiciones.array;i[0]=e,i[1]=n,i[2]=0,i[3]=t,i[4]=n,i[5]=0,i[6]=t,i[7]=r,i[8]=0,i[9]=e,i[10]=r,i[11]=0,this.posiciones.needsUpdate=!0}caja(e){let t=Math.tan(e.hfov*g/2),n=Math.tan(e.vfov*g/2),r=90,i=-90,a=1/0,o=-1/0,s=0,c=(r,i)=>{this.direccion.set(r*t,i*n,-1).applyQuaternion(e.orientacion).normalize();let a=Math.asin(Math.max(-1,Math.min(1,this.direccion.y)))/g;return{yaw:Math.atan2(this.direccion.x,-this.direccion.z)/g,pitch:a}},l=c(0,0);s=l.yaw,r=i=l.pitch,a=o=0;for(let e=0;e<=24;e++){let t=e/24*2-1;for(let[e,n]of[[t,-1],[t,1],[-1,t],[1,t]]){let{yaw:t,pitch:l}=c(e,n);r=Math.min(r,l),i=Math.max(i,l);let u=t-s;for(;u>180;)u-=360;for(;u<-180;)u+=360;a=Math.min(a,u),o=Math.max(o,u)}}let u=r=>(this.direccion.set(0,r,0).applyQuaternion(this.polar.copy(e.orientacion).invert()),this.direccion.z>-1e-6?!1:Math.abs(this.direccion.x/-this.direccion.z)<=t&&Math.abs(this.direccion.y/-this.direccion.z)<=n),d,f;u(1)||u(-1)?(u(1)&&(i=90),u(-1)&&(r=-90),d=-1,f=1):(d=(s+a-R)/180,f=(s+o+R)/180);let p=Math.max(-1,(r-L)/90),m=Math.min(1,(i+L)/90),h=[0];return d<-1&&h.push(2),f>1&&h.push(-2),{x0:d,x1:f,y0:p,y1:m,copias:h}}dibujarPreview(){this.renderer.setRenderTarget(null),this.renderer.render(this.escenaNormalizar,this.camara)}cobertura(e=96){let n=Math.max(2,Math.round(e/2)),r=new t(e,n,{depthBuffer:!1,stencilBuffer:!1,colorSpace:``}),a=this.renderer.getRenderTarget(),o=this.materialNormalizar.uniforms.uAcumulado.value;this.renderer.setRenderTarget(r),this.renderer.setClearColor(0,0),this.renderer.clear(!0,!1,!1);let s=new i({vertexShader:P,fragmentShader:`
        precision highp float;
        uniform sampler2D uAcumulado;
        varying vec2 vNdc;
        void main() { gl_FragColor = texture2D(uAcumulado, vNdc * 0.5 + 0.5); }
      `,uniforms:{uAcumulado:{value:this.acumulado.texture}},depthTest:!1,depthWrite:!1}),c=this.escenaNormalizar.children[0],l=c.material;c.material=s,this.renderer.render(this.escenaNormalizar,this.camara),c.material=l,this.materialNormalizar.uniforms.uAcumulado.value=o;let u=new Uint8Array(e*n*4);this.renderer.readRenderTargetPixels(r,0,0,e,n,u),this.renderer.setRenderTarget(a),r.dispose(),s.dispose();let d=0,f=0;for(let t=0;t<n;t++){let r=(t+.5)/n*180-90,i=Math.cos(r*g);for(let n=0;n<e;n++){let r=u[(t*e+n)*4+3];f+=i,r>96&&(d+=i)}}return f>0?d/f:0}async exportar(e=.86){var t=this;let{width:n,height:r}=t,i=new Uint8Array(n*r*4);t.renderer.readRenderTargetPixels(t.acumulado,0,0,n,r,i);let a=document.createElement(`canvas`);a.width=n,a.height=r;let o=a.getContext(`2d`);if(!o)throw Error(`No se pudo preparar el lienzo de la panorámica.`);let s=o.createImageData(n,r),c=s.data,l=t.materialNormalizar.uniforms.uVacio.value,u=Math.round(l.x*255),d=Math.round(l.y*255),f=Math.round(l.z*255);for(let e=0;e<r;e++){let t=(r-1-e)*n*4,a=e*n*4;for(let e=0;e<n;e++){let n=t+e*4,r=a+e*4,o=i[n+3];if(o<5)c[r]=u,c[r+1]=d,c[r+2]=f;else{let e=255/o;c[r]=Math.min(255,i[n]*e),c[r+1]=Math.min(255,i[n+1]*e),c[r+2]=Math.min(255,i[n+2]*e)}c[r+3]=255}}o.putImageData(s,0,0);let p=await new Promise(t=>a.toBlob(t,`image/jpeg`,e));if(a.width=0,a.height=0,!p)throw Error(`El navegador no pudo guardar la panorámica.`);return p}dispose(){this.acumulado.dispose(),this.material.dispose(),this.materialNormalizar.dispose(),this.malla.geometry.dispose(),this.renderer.dispose(),this.renderer.forceContextLoss()}};export{S as a,k as c,N as d,C as f,D as i,x as l,E as n,j as o,O as r,b as s,B as t,M as u};