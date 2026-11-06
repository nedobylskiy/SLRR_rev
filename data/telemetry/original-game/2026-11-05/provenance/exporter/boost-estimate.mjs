// Numerical interpretation of the pinned sl-remastered 7aa574d car_hud.hpp
// FUN_004b6ad0 reconstruction. This is NOT a measured Steam-build boost getter.
// Plateau is assumed zero, consistent with the documented dyno reset block.
export function boostEstimate(engine, rpm) {
  const keys=['rpm_turbo_mul','rpm_turbo_opt','rpm_turbo_range','P_turbo_max','P_turbo_waste'];
  if(!keys.every(key=>engine[key]!==undefined&&Number.isFinite(Number(engine[key])))||!Number.isFinite(rpm))return null;
  const [multiplier,optimum,range,maximum,waste]=keys.map(key=>Number(engine[key]));
  const enabled=multiplier>0&&range>0&&maximum>0;
  const envelope=enabled?Math.max(0,1-Math.abs(Math.abs(rpm)*multiplier-optimum)/range):0;
  const pressure=enabled&&waste>0?Math.min(envelope*maximum,waste):0;
  const normalization=Math.sqrt(Math.max(0,Math.min(maximum,waste)))-1;
  const hud=enabled&&waste>0&&Math.abs(normalization)>1e-10?(Math.sqrt(pressure+1)-1)/normalization:null;
  return{turbo_config_active:Number(enabled),turbo_envelope_estimate:envelope,
    turbo_pressure_estimate_raw:pressure,turbo_hud_estimate_raw:hud,
    boost_source:'derived_from_rpm_and_dyno_not_measured',turbo_plateau_assumed:0};
}
