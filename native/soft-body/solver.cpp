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
    case 10: return boxes;
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
}
