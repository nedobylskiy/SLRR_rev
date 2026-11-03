/** Recovered SL2 scalar physics, adapted from sl-remastered @ 7aa574d.
 * Source functions, units and remaining host adaptations: docs/physics-reverse-port.md. */
export const STOCK_WHEEL_PARAMETERS = [1.4,0,1.49,0,15.2,0,-0,0,-1,0,0,8000,1,0.015,0.4,0,0];
export interface SlipState { longitudinal: number; angle: number }
export interface SlipParameters { longitudinalLimit: number; lateralLimit: number; longitudinalRelaxation: number; lateralRelaxation: number; transitionScale: number; speedThreshold: number; longitudinalDamping: number; lateralDamping: number }
export const STOCK_SLIP_PARAMETERS: SlipParameters = { longitudinalLimit:1,lateralLimit:1,longitudinalRelaxation:0.3,lateralRelaxation:0.5,transitionScale:0.1,speedThreshold:0.1,longitudinalDamping:0.1,lateralDamping:0.2 };
const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b,x));
const f = Math.fround;
export function wheelCurve(c: readonly number[], slip: number, load: number, signed = false): number {
  if (c.length < 11 || ![...c.slice(0,11),slip,load].every(Number.isFinite) || load < 0) throw new Error('Invalid native wheel curve');
  const amplitude = f(f(load*c[1])+c[2]), denominator = f(amplitude*c[0]);
  if (!denominator) return 0;
  const exponent = f(-f(load*c[5])*Math.LOG2E);
  if (Math.abs(exponent)>120) throw new Error('Native wheel curve exponent out of range');
  const scale = f(f(f(load*c[3])+c[4])*Math.exp(exponent*Math.LN2)/denominator);
  const argument = f(f(f(f(load*c[9])+c[10])+slip)*scale);
  const difference = f(Math.atan(argument)-argument);
  const curvature = f(f(f(load*c[7])+f(f(load*load)*c[6]))+c[8]);
  const angle = f(Math.atan(f(f(curvature*difference)+argument))*c[0]);
  const result = f(f(amplitude*load)*Math.sin(angle));
  return signed ? result : Math.max(0,result);
}
export function updateSlip(wheelSpeed: number, roadSpeed: number, lateralSpeed: number, dt: number, previous: SlipState, p = STOCK_SLIP_PARAMETERS): SlipState {
  if (![wheelSpeed,roadSpeed,lateralSpeed,dt,previous.longitudinal,previous.angle,...Object.values(p)].every(Number.isFinite)
    || dt<0 || p.longitudinalRelaxation<=0 || p.lateralRelaxation<=0) throw new Error('Invalid native wheel slip');
  const speed = Math.abs(roadSpeed), transition = clamp((speed-p.speedThreshold)*p.transitionScale,0,1);
  const targetLong = speed>p.speedThreshold ? (wheelSpeed-roadSpeed)/speed : 0;
  const targetAngle = speed>p.speedThreshold ? Math.atan(lateralSpeed/speed) : 0;
  if (transition>=1) return {longitudinal:targetLong,angle:targetAngle};
  const long = clamp((p.longitudinalRelaxation*previous.longitudinal+(wheelSpeed-roadSpeed)*dt)/((dt*500*p.longitudinalDamping+1)*p.longitudinalRelaxation),-p.longitudinalLimit,p.longitudinalLimit);
  const angle = clamp((p.lateralRelaxation*previous.angle+lateralSpeed*dt)/((dt*500*p.lateralDamping+1)*p.lateralRelaxation),-p.lateralLimit,p.lateralLimit);
  return {longitudinal: targetLong*transition+(1-transition)*long,angle:targetAngle*transition+(1-transition)*angle};
}
export function effectiveTireLoad(load: number, maximum: number, smoothing: number, lateralNormal = 0): number {
  if (![load,maximum,smoothing,lateralNormal].every(Number.isFinite) || load<0 || maximum<=0) throw new Error('Invalid native tire load');
  const slope = (Math.sqrt(Math.max(0,1-lateralNormal*lateralNormal))+1)*0.5;
  return slope*((1-smoothing)*Math.min(load,maximum)+Math.atan(load*Math.PI/2/maximum)*maximum*2/Math.PI*smoothing);
}
export function nativeTireForces(load: number, wheelSpeed: number, roadSpeed: number, lateralSpeed: number, dt: number, previous: SlipState, coefficients: readonly number[], surfaceFriction=1, lateralNormal=0) {
  const slip = updateSlip(wheelSpeed,roadSpeed,lateralSpeed,dt,previous);
  const effectiveLoad = effectiveTireLoad(load,coefficients[11],coefficients[14],lateralNormal);
  const sine = Math.sin(slip.angle), scaled = Math.cos(slip.angle)*slip.longitudinal*coefficients[12];
  const magnitude = Math.hypot(sine,scaled), curve=coefficients.slice(0,11);
  curve[2] *= surfaceFriction;
  if (coefficients[16]>0) curve[4] *= (coefficients[15]+coefficients[16])/(effectiveLoad+coefficients[16]);
  const force = magnitude>0.0001 ? wheelCurve(curve,magnitude,effectiveLoad) : 0;
  const aligning = wheelCurve([-2.3,0,1.49,0,15.2,0,0,0,-1,0,0],slip.angle,effectiveLoad,true)*curve[2];
  return {slip,longitudinal:magnitude>0.0001?scaled/magnitude*force:0,lateral:magnitude>0.0001?-sine/magnitude*force:0,aligning,effectiveLoad};
}
export function nativeSuspensionForce(length: number, previousLength: number, projectedVelocity: number, rest: number, max: number, spring: number, bumpDamping: number, reboundDamping: number, accumulated=0) {
  if (length>=max) return {force:0,work:0};
  const velocity=2*projectedVelocity;
  const dampingForce = velocity*(velocity>=0 ? (reboundDamping>0?reboundDamping:0.7*bumpDamping) : bumpDamping);
  return {force:Math.max(0,accumulated-dampingForce-(length-rest)*spring),work:Math.abs(dampingForce*(length-Math.min(previousLength,max)))};
}
export interface ClutchInput { engineSpeed:number; wheelSpeed:number; engineImpulse:number; engineInertia:number; transmissionInertia:number; engineInertiaFactor:number; gearRatio:number; finalDrive:number; clutch:number; previousDisplayedSpeed:number; drivenWeightSum:number }
export function clutchExchange(i: ClutchInput) {
  if (!Object.values(i).every(Number.isFinite) || i.engineInertia<=0 || i.transmissionInertia<=0 || i.engineInertiaFactor<=0 || i.drivenWeightSum<=0 || i.clutch<0 || i.clutch>1) throw new Error('Invalid native clutch exchange');
  const ratio=i.finalDrive*i.gearRatio;
  if (!ratio) throw new Error('Native clutch exchange requires an engaged gear');
  const reflected=i.transmissionInertia/(ratio*ratio), factor=reflected/(i.engineInertiaFactor*i.engineInertia+reflected);
  const displayed=((i.engineSpeed-(1-factor)*i.engineImpulse/i.engineInertia)-i.previousDisplayedSpeed)*0.25+i.previousDisplayedSpeed;
  let engine=i.engineSpeed+i.engineImpulse/i.engineInertia, wheel=i.wheelSpeed*ratio;
  const exchange=(wheel-engine)*factor, grip=1-i.clutch;
  wheel+=(exchange+engine-wheel)*grip*0.9990000128746033;
  engine+=exchange*grip*0.9990000128746033;
  return {engineSpeed:engine,wheelSpeed:wheel/ratio,displayedSpeed:displayed,wheelDeltaPerDriveWeight:(wheel/ratio-i.wheelSpeed)/i.drivenWeightSum,force:grip*exchange/(factor*factor)*100};
}
export function engineLimiter(rpm: number, previousRpm: number, limit: number): number {
  const predicted=2*rpm-previousRpm;
  if (predicted<=limit) return rpm>limit?(limit-predicted)/(rpm-predicted):1;
  return rpm>limit?0:(limit-rpm)/(predicted-rpm);
}
/** Native angular braking cannot reverse a stationary wheel. Strength is in native units. */
export function wheelBrake(omega: number, dt: number, inverseInertia: number, brake: number, handbrake: number, wheelBrake: number, wheelHandbrake: number, bearing: number, carBrakeStrength=1, carHandbrakeStrength=1, brakeFactor=1) {
  const strength=carHandbrakeStrength*Math.abs(handbrake)*wheelHandbrake+Math.abs(brake)*carBrakeStrength*wheelBrake+bearing;
  const amount=Math.max(0,dt*500*inverseInertia*strength*brakeFactor);
  return Math.sign(omega)*Math.max(0,Math.abs(omega)-amount);
}

/** Recovered engine heating and intact radiator cooling; temperatures are Celsius. */
export function engineTemperatureStep(temperature:number, ambient:number, capacity:number, availableTorque:number, speed:number, cooling:readonly number[], dt:number) {
  if (![temperature,ambient,capacity,availableTorque,speed,dt,...cooling].every(Number.isFinite) || capacity<=0 || dt<0)
    throw new Error('Invalid native engine thermal state');
  const heated=temperature+Math.max(0,availableTorque*1000)*dt/capacity;
  const rate=(cooling[0]+(heated>90?speed*speed*cooling[2]+cooling[1]:0))/capacity;
  const difference=heated-ambient;
  return heated-Math.abs(difference)*rate*difference*dt;
}
