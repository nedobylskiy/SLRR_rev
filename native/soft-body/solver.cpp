// Freestanding C++17: no allocator, libc, threads, or Emscripten runtime.
// One instance per panel keeps JS typed-array views stable for its lifetime.
extern "C" __attribute__((import_module("env"), import_name("exp"))) double host_exp(double);
extern "C" __attribute__((import_module("env"), import_name("box_contact"))) void host_box_contact(int, int, double, double, double);
namespace {
constexpr int max_nodes = 512, max_beams = 8192, max_mounts = 4;
double positions[max_nodes * 3], rest[max_nodes * 3], velocities[max_nodes * 3];
double previous[max_nodes * 3], anchor_lambda[max_nodes * 3], incoming[max_nodes * 3];
double anchor_velocity[max_nodes * 3], ground[max_nodes];
// a, b, initial length, plastic rest length, lambda, stiffness
double beams[max_beams * 6];
// broken, force, overload duration, node count, node indices...
double mounts[max_mounts * (max_nodes + 4)];
double boxes[64 * 8]; // min XYZ, max XYZ, restitution, friction
int box_count;
int nodes, beam_count, mount_count, mount_stride;
double inverse_mass;
double ror_forces[max_nodes*3], ror_planes[max_nodes*8],ror_damping[max_beams],ror_mount_load[max_mounts],ror_rest[max_nodes*3],ror_ground[max_nodes],ror_plane_offset[max_nodes],ror_node_k[max_nodes],ror_node_d[max_nodes];
double abs(double v) { return v < 0 ? -v : v; }
double max(double a, double b) { return a > b ? a : b; }
double min(double a, double b) { return a < b ? a : b; }
double norm(double x, double y, double z) {
  const double scale = max(abs(x), max(abs(y), abs(z)));
  if (scale == 0) return 0;
  x /= scale; y /= scale; z /= scale;
  return scale * __builtin_sqrt(x*x + y*y + z*z);
}
}
extern "C" {
int abi_version() { return 1; }
int configure(int n, int b, int m, double mass) {
  if (n <= 0 || n > max_nodes || b < 0 || b > max_beams || m < 0 || m > max_mounts || !__builtin_isfinite(mass) || mass <= 0) return 0;
  nodes = n; beam_count = b; mount_count = m; mount_stride = n + 4; inverse_mass = n / mass;
  return 1;
}
double* buffer(int id) {
  switch (id) {
    case 0: return positions; case 1: return rest; case 2: return velocities;
    case 3: return previous; case 4: return anchor_lambda; case 5: return incoming;
    case 6: return anchor_velocity; case 7: return ground; case 8: return beams; case 9: return mounts;
    case 10: return boxes; case 11: return ror_planes;
    default: return nullptr;
  }
}
int set_colliders(int count) {
  box_count = count <= 64 ? count : 0;
  return count >= 0 && count <= 64;
}
void predict(double dt, double gravity, int attached) {
  const double damping = host_exp(-(attached ? 2.0 : 0.25) * dt);
  for (int i = 0; i < nodes * 3; ++i) { previous[i] = positions[i]; anchor_lambda[i] = 0; }
  for (int i = 0; i < nodes * 3; i += 3) {
    velocities[i + 1] -= gravity * dt;
    for (int axis = 0; axis < 3; ++axis) {
      const int j = i + axis;
      const double target = attached ? anchor_velocity[j] : 0;
      positions[j] += (target + (velocities[j] - target) * damping) * dt;
      incoming[j] = (positions[j] - previous[j]) / dt;
      anchor_velocity[j] = 0;
    }
  }
  for (int b = 0; b < beam_count; ++b) beams[b * 6 + 4] = 0;
}
void solve_constraints(double dt) {
  const double dt2 = dt * dt, inv = inverse_mass;
  for (int index = 0; index < beam_count; ++index) {
    double* b = beams + index * 6;
    const int a = int(b[0]) * 3, c = int(b[1]) * 3;
    const double dx = positions[a] - positions[c], dy = positions[a+1] - positions[c+1], dz = positions[a+2] - positions[c+2];
    const double length = __builtin_sqrt(dx*dx + dy*dy + dz*dz);
    if (length < 1e-10) continue;
    const double alpha = 1 / b[5] / dt2, dl = (-(length - b[3]) - alpha * b[4]) / (2 * inv + alpha), s = inv * dl / length;
    b[4] += dl;
    positions[a] += dx*s; positions[a+1] += dy*s; positions[a+2] += dz*s;
    positions[c] -= dx*s; positions[c+1] -= dy*s; positions[c+2] -= dz*s;
  }
  for (int index = 0; index < mount_count; ++index) {
    double* m = mounts + index * mount_stride;
    if (m[0]) continue;
    for (int node = 0; node < int(m[3]); ++node) for (int axis = 0; axis < 3; ++axis) {
      const int i = int(m[4 + node]) * 3 + axis;
      const double alpha = 1e-7 / dt2, dl = (-(positions[i] - rest[i]) - alpha * anchor_lambda[i]) / (inv + alpha);
      anchor_lambda[i] += dl; positions[i] += inv * dl;
    }
  }
}
void solve_contacts() {
  for (int n = 0; n < nodes; ++n) positions[n * 3 + 1] = max(ground[n], positions[n * 3 + 1]);
  for (int index = 0; index < box_count; ++index) for (int i = 0; i < nodes * 3; i += 3) {
    const double* box = boxes + index * 8;
    double enter = 0, exit = 1, boundary = 0;
    int normal = -1; bool rejected = false;
    for (int axis = 0; axis < 3; ++axis) {
      const double delta = positions[i+axis] - previous[i+axis], from = previous[i+axis];
      if (abs(delta) < 1e-12) {
        if (from < box[axis] || from > box[axis+3]) { rejected = true; break; }
        continue;
      }
      const double a = (box[axis] - from) / delta, b = (box[axis+3] - from) / delta;
      const double near = min(a, b), far = max(a, b);
      if (near >= enter) { enter = near; normal = axis; boundary = delta > 0 ? box[axis] : box[axis+3]; }
      exit = min(exit, far);
      if (enter > exit) { rejected = true; break; }
    }
    if (rejected) continue;
    if (!(normal >= 0 && enter >= 0 && enter <= 1 && exit >= 0)) {
      bool inside = true;
      for (int axis = 0; axis < 3; ++axis) if (positions[i+axis] < box[axis] || positions[i+axis] > box[axis+3]) inside = false;
      if (!inside) continue;
      double distance = __builtin_inf();
      for (int axis = 0; axis < 3; ++axis) for (int side = 0; side < 2; ++side) {
        const double face = box[axis + side*3], d = abs(positions[i+axis] - face);
        if (d < distance) { distance = d; normal = axis; boundary = face; }
      }
    }
    positions[i+normal] = boundary;
    host_box_contact(i, normal, boundary == box[normal] ? -1 : 1, box[6], box[7]);
  }
}
void solve(double dt) { solve_constraints(dt); solve_contacts(); }
int release_mounts(double dt, double strength) {
  bool release = false;
  for (int index = 0; index < mount_count; ++index) {
    double* m = mounts + index * mount_stride;
    if (m[0]) continue;
    double force = 0;
    for (int node = 0; node < int(m[3]); ++node) {
      const int i = int(m[4 + node]) * 3;
      force += norm(anchor_lambda[i], anchor_lambda[i+1], anchor_lambda[i+2]) / (dt*dt);
    }
    m[1] = force; m[2] = force > strength ? m[2] + dt : 0;
    if (m[2] >= 2.0 / 240.0) release = true;
  }
  if (release) for (int index = 0; index < mount_count; ++index) mounts[index * mount_stride] = 1;
  return release;
}
int finish(double dt, double yield_strain) {
  for (int index = 0; index < beam_count; ++index) {
    double* b = beams + index * 6;
    const int a = int(b[0]) * 3, c = int(b[1]) * 3;
    const double dx = positions[a] - positions[c], dy = positions[a+1] - positions[c+1], dz = positions[a+2] - positions[c+2];
    const double length = __builtin_sqrt(dx*dx + dy*dy + dz*dz), strain = (length - b[3]) / b[2];
    if (abs(strain) > yield_strain) b[3] = max(b[2] * 0.5, min(b[2] * 1.5, b[3] + (strain < 0 ? -1 : 1) * (abs(strain) - yield_strain) * b[2] * min(1, 120 * dt)));
  }
  for (int i = 0; i < nodes * 3; ++i) {
    velocities[i] = (positions[i] - previous[i]) / dt;
    if (!__builtin_isfinite(positions[i])) return 0;
  }
  return 1;
}

// Rigs of Rods normal-beam force/plastic-yield equations and semi-implicit
// node integration, adapted from ActorForcesEuler.cpp at ebf31a2187bbc31a38331a86b233dfa7e60c52fb.
// Copyright 2005-2012 Pierre-Michel Ricordel, 2007-2012 Thomas Fischer,
// and the Rigs of Rods contributors. GPL-3.0-only; see ror/COPYING.
// SLRR supplies CFG mounts/contact planes instead of RoR rig cab definitions.
int ror_advance(double dt,double gravity,int attached,double yield_strain,double mount_strength) {
  if(!(dt>0) || dt>.1)return 0;
  const double mass=1/inverse_mass;
  for(int n=0;n<nodes;++n){ror_node_k[n]=0;ror_node_d[n]=0;}
  for(int i=0;i<beam_count;++i){const double* beam=beams+i*6;const int a=int(beam[0]),b=int(beam[1]);const double d=.1*__builtin_sqrt(beam[5]*mass);ror_damping[i]=d;ror_node_k[a]+=beam[5];ror_node_k[b]+=beam[5];ror_node_d[a]+=d;ror_node_d[b]+=d;}
  double maximum_h=.0005;
  // Generated cages can have more beams per node than authored RoR rigs.
  // Bound the explicit integration step by the combined elastic/damping load.
  for(int n=0;n<nodes;++n){const double a=2*ror_node_k[n]*inverse_mass,b=4*ror_node_d[n]*inverse_mass;if(a+b>0)maximum_h=min(maximum_h,.85*4/(b+__builtin_sqrt(b*b+8*a)));}
  int steps=int(dt/maximum_h);if(steps*maximum_h<dt-1e-12)++steps;if(steps<1)steps=1;
  const double h=dt/steps,drag=host_exp(-12*h);
  const double anchor_k=min(1e7,.4*mass/(.0005*.0005)),anchor_d=__builtin_sqrt(anchor_k*mass);
  const double origin[3]={rest[0],rest[1],rest[2]};
  // RoR integrates actor-relative positions. Keep nanometre precision here,
  // well beyond authored SCX precision, to avoid contact/yield branch flapping
  // when the same rig is translated to a different world elevation.
  for(int i=0;i<nodes*3;++i){previous[i]=positions[i];incoming[i]=velocities[i];anchor_lambda[i]=0;positions[i]=__builtin_nearbyint((positions[i]-origin[i%3])*1e10)*1e-10;ror_rest[i]=__builtin_nearbyint((rest[i]-origin[i%3])*1e10)*1e-10;}
  for(int n=0;n<nodes;++n){ror_ground[n]=__builtin_nearbyint((ground[n]-origin[1])*1e10)*1e-10;const double* q=ror_planes+n*8;ror_plane_offset[n]=__builtin_nearbyint((q[3]-q[0]*origin[0]-q[1]*origin[1]-q[2]*origin[2])*1e10)*1e-10;}

  for(int i=0;i<mount_count;++i)ror_mount_load[i]=0;
  for(int sub=0;sub<steps;++sub){
    for(int i=0;i<nodes*3;i+=3){ror_forces[i]=0;ror_forces[i+1]=-mass*gravity;ror_forces[i+2]=0;}
    for(int index=0;index<beam_count;++index){
      double* b=beams+index*6;const int a=int(b[0])*3,c=int(b[1])*3;
      const double x=positions[a]-positions[c],y=positions[a+1]-positions[c+1],z=positions[a+2]-positions[c+2];
      const double length=__builtin_sqrt(x*x+y*y+z*z);if(length<1e-10)continue;
      const double inverse_length=1/length,extension=length-b[3],k=b[5];
      const double speed=((velocities[a]-velocities[c])*x+(velocities[a+1]-velocities[c+1])*y+(velocities[a+2]-velocities[c+2])*z)*inverse_length;
      const double damping=ror_damping[index];
      double stress=-k*extension-damping*speed;
      const double yield=k*b[2]*yield_strain;
      // RoR adjusts the stress-free length at material yield, rather than
      // spending iterative position projections to impose a rigid shape.
      if(stress>yield&&extension < -yield/k){const double old=b[3];b[3]=max(b[2]*.2,b[3]+extension+yield/k);stress+=k*(b[3]-old)*.5;}
      else if(stress < -yield&&extension>yield/k){const double old=b[3];b[3]=min(b[2]*3,b[3]+extension-yield/k);stress+=k*(b[3]-old)*.5;}
      b[4]=stress;const double factor=stress*inverse_length;
      ror_forces[a]+=x*factor;ror_forces[a+1]+=y*factor;ror_forces[a+2]+=z*factor;
      ror_forces[c]-=x*factor;ror_forces[c+1]-=y*factor;ror_forces[c+2]-=z*factor;
    }
    if(attached)for(int index=0;index<mount_count;++index){
      double* m=mounts+index*mount_stride;if(m[0])continue;double load=0;
      for(int n=0;n<int(m[3]);++n){double nf[3];for(int axis=0;axis<3;++axis){
        const int i=int(m[4+n])*3+axis;
        const double target=ror_rest[i]-anchor_velocity[i]*(dt-(sub+1)*h);
        const double force=(target-positions[i])*anchor_k+(anchor_velocity[i]-velocities[i])*anchor_d;
        ror_forces[i]+=force;anchor_lambda[i]+=force/steps;nf[axis]=force;
      }load+=norm(nf[0],nf[1],nf[2]);}ror_mount_load[index]=max(ror_mount_load[index],load);
    }
    for(int i=0;i<nodes*3;i+=3){
      for(int axis=0;axis<3;++axis){velocities[i+axis]+=ror_forces[i+axis]*inverse_mass*h;if(attached)velocities[i+axis]=anchor_velocity[i+axis]+(velocities[i+axis]-anchor_velocity[i+axis])*drag;positions[i+axis]+=velocities[i+axis]*h;}
      if(positions[i+1]<=ror_ground[i/3]+1e-9){positions[i+1]=max(positions[i+1],ror_ground[i/3]);if(velocities[i+1]<0)velocities[i+1]=0;}
      const double* plane=ror_planes+(i/3)*8;
      if(plane[7]){
        const double offset=ror_plane_offset[i/3]-(plane[7]==2?(plane[0]*plane[4]+plane[1]*plane[5]+plane[2]*plane[6])*(dt-(sub+1)*h):0);
        const double depth=offset-plane[0]*positions[i]-plane[1]*positions[i+1]-plane[2]*positions[i+2];
        if(depth>=-1e-9){
          const double vn=(velocities[i]-plane[4])*plane[0]+(velocities[i+1]-plane[5])*plane[1]+(velocities[i+2]-plane[6])*plane[2];
          for(int axis=0;axis<3;++axis){positions[i+axis]+=plane[axis]*max(0,depth);if(vn<0)velocities[i+axis]-=plane[axis]*vn;}
        }
      }
    }
  }
  bool release=false;
  // Use the mean transmitted load for sustained failure, not one microstep spike.
  // Keep a peak overload path for a genuinely severe impulse.
  for(int index=0;index<mount_count;++index){double* m=mounts+index*mount_stride;if(m[0])continue;double force=0;
    for(int n=0;n<int(m[3]);++n){const int i=int(m[4+n])*3;force+=norm(anchor_lambda[i],anchor_lambda[i+1],anchor_lambda[i+2]);}
    m[1]=ror_mount_load[index];m[2]=force>mount_strength?m[2]+dt:max(0,m[2]-2*dt);if((m[1]>mount_strength*3&&force>mount_strength*.5)||m[2]>=.04)release=true;
  }
  if(release)for(int index=0;index<mount_count;++index)mounts[index*mount_stride]=1;
  for(int i=0;i<nodes*3;++i){if(!__builtin_isfinite(positions[i])||!__builtin_isfinite(velocities[i]))return 0;}
  for(int i=0;i<nodes*3;++i){positions[i]+=origin[i%3];ror_forces[i]=positions[i];}
  solve_contacts();
  for(int i=0;i<nodes*3;++i)velocities[i]+=(positions[i]-ror_forces[i])/dt;
  return steps;
}
}
