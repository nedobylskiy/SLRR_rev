package java.game;

import java.util.*;
import java.game.parts.*;
import java.game.parts.bodypart.*;
import java.game.parts.enginepart.*;

// Passive logger for the installed Steam/build-940 script API.
// Call sample(player.car) from Track.animate(), stop() from Track.exit().
public class PhysicsTelemetry
{
    static float interval = 0.1;
    static int enabled = 1;
    static Vehicle active;
    static int run = 0;
    static int sequence = 0;
    static float nextSample = 0;
    static float lastTime = -1;
    static float lastRPM = 0;
    static float lastSpeed = 0;
    static int lastGear = 0;
    static int transmissionConfig = -1;

    // Stock String has getASCII(), not Java SE replace()/charAt(). Store text
    // as numeric codes so model names cannot corrupt the pipe-delimited log.
    public static String codes(String value)
    {
        if(value == null) return "";
        int[] values = value.getASCII();
        String result = "";
        for(int i=0; i<values.length; i++)
        {
            if(i>0) result = result + ",";
            result = result + values[i];
        }
        return result;
    }

    public static void stop()
    {
        if(active != null)
            System.log("SLRR_PHYSICS|v=1|kind=end|run=" + run + "|seq=" + sequence);
        active = null;
        lastTime = -1;
    }

    public static void describe(Vehicle car)
    {
        Chassis c = car.chassis;
        System.log("SLRR_PHYSICS|v=1|kind=meta|run=" + run
            + "|chassis_type=" + c.getInfo(GameType.GII_TYPE)
            + "|vehicle_codes=" + codes(c.vehicleName)
            + "|model_codes=" + codes(c.modelName)
            + "|vendor_codes=" + codes(c.vendorName)
            + "|mass_kg=" + c.getMassPatch()
            + "|transmission_config=" + Config.player_transmission
            + "|idle_rpm=" + c.engine_rpm_idle + "|redline_rpm=" + c.RPM_limit
            + "|engine_inertia=" + c.engine_inertia + "|engine_mass=" + c.engine_mass
            + "|gears=" + c.gears + "|final_drive=" + c.rearend_ratio
            + "|clutch_force=" + c.ClutchF + "|interval_s=" + interval);
        for(int gear=0; gear<c.ratio.length; gear++)
            System.log("SLRR_PHYSICS|v=1|kind=ratio|run=" + run + "|index=" + gear + "|ratio=" + c.ratio[gear]);
        Part part = c.partOnSlot(Chassis.ENGINE_SLOT);
        if(part instanceof Block)
        {
            Block block = part;
            DynoData d = block.dynodata;
            if(d != null)
            {
                System.log("SLRR_PHYSICS|v=1|kind=engine|run=" + run
                    + "|engine_type=" + block.getInfo(GameType.GII_TYPE)
                    + "|engine_codes=" + codes(block.name)
                    + "|wear=" + block.getWear() + "|tear=" + block.getTear()
                    + "|displacement_raw=" + d.Displacement + "|compression=" + d.Compression
                    + "|max_torque_raw=" + d.maxTorque + "|max_hp_raw=" + d.maxHP
                    + "|peak_torque_rpm=" + d.RPM_maxTorque + "|peak_power_rpm=" + d.RPM_maxHP
                    + "|bore_m=" + d.bore + "|stroke_m=" + d.stroke + "|cylinders=" + d.cylinders);
                // Read the existing native table; never call calcDyno/updatevariables.
                for(int rpm=0; rpm<=c.RPM_limit && rpm<=20000; rpm+=500)
                    System.log("SLRR_PHYSICS|v=1|kind=curve|run=" + run + "|rpm=" + rpm
                        + "|torque_nm=" + d.getTorque(rpm,0.0) + "|power_w=" + d.getHP(rpm,0.0));
            }
        }
    }

    public static void sample(Vehicle car)
    {
        if(enabled == 0 || car == null)
        {
            stop();
            return;
        }
        if(car.chassis == null)
        {
            stop();
            return;
        }
        float now = System.currentTime();
        if(active != car || now < lastTime || transmissionConfig != Config.player_transmission)
        {
            stop();
            active = car;
            run++;
            sequence = 0;
            transmissionConfig = Config.player_transmission;
            nextSample = now;
            describe(car);
        }
        if(now < nextSample) return;
        nextSample = now + interval;
        Chassis c = car.chassis;
        float rpm = c.getRPM();
        float speed = car.getSpeed();
        // Preserve the documented raw AI parameter identity. Verify gear encoding
        // against the original HUD before treating it as an engaged gear.
        int gear = c.getAIparam_int(6);
        if(lastTime >= 0 && gear != lastGear)
            System.log("SLRR_PHYSICS|v=1|kind=shift|run=" + run + "|seq=" + sequence
                + "|from=" + lastGear + "|to=" + gear
                + "|t_before=" + lastTime + "|t_after=" + now
                + "|rpm_before=" + lastRPM + "|rpm_after=" + rpm
                + "|speed_before_mps=" + lastSpeed + "|speed_after_mps=" + speed);
        System.log("SLRR_PHYSICS|v=1|kind=sample|run=" + run + "|seq=" + sequence
            + "|t=" + now + "|rpm=" + rpm + "|gear_param6=" + gear
            + "|shifting=" + c.getShifting() + "|speed_mps=" + speed
            + "|throttle_param0=" + c.getAIparam_float(0)
            + "|brake_param1=" + c.getAIparam_float(1)
            + "|clutch_param4=" + c.getAIparam_float(4)
            + "|steer_param3=" + c.getAIparam_float(3)
            + "|temperature_raw=" + c.getEngineTemp());
        lastTime = now;
        lastRPM = rpm;
        lastSpeed = speed;
        lastGear = gear;
        sequence++;
    }
}
