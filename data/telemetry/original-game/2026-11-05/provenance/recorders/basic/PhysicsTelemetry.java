package java.game;

import java.util.*;
import java.game.parts.*;
import java.game.parts.bodypart.*;
import java.game.parts.enginepart.*;

// Local capture candidate: short field records, shallow string expressions.
public class PhysicsTelemetry
{
    static Vehicle active;
    static int run = 0;
    static int sequence = 0;
    static int transmission = -1;
    static float interval = 0.1;
    static float nextSample = 0.0;
    static float lastTime = -1.0;
    static String prefix = "";

    public static void begin(String kind, int number)
    {
        prefix = "SLRR_PHYSICS|v=2";
        prefix = prefix + "|run=" + run;
        prefix = prefix + "|seq=" + number;
        prefix = prefix + "|kind=" + kind;
    }

    public static void field(String key, String value)
    {
        String line = prefix + "|key=" + key;
        line = line + "|value=" + value;
        System.log(line);
    }

    public static void text(String key, String value)
    {
        if(value == null) return;
        int[] values = value.getASCII();
        field(key + "_length", "" + values.length);
        for(int i=0; i<values.length; i++)
            field(key + "_code_" + i, "" + values[i]);
    }

    public static void describe(Vehicle car)
    {
        Chassis c = car.chassis;
        begin("meta", 0);
        field("status", "begin");
        field("chassis_type", "" + c.getInfo(GameType.GII_TYPE));
        text("vehicle", c.vehicleName);
        text("model", c.modelName);
        text("vendor", c.vendorName);
        field("mass_native_raw", "" + c.getMass());
        field("mass_source", "Chassis.getMass_unqualified");
        field("transmission_config", "" + transmission);
        field("interval_s", "" + interval);
        field("idle_rpm", "" + c.engine_rpm_idle);
        field("redline_rpm", "" + c.RPM_limit);
        field("engine_inertia", "" + c.engine_inertia);
        field("engine_mass", "" + c.engine_mass);
        field("gears", "" + c.gears);
        field("final_drive", "" + c.rearend_ratio);
        field("clutch_force", "" + c.ClutchF);
        for(int gear=0; gear<c.ratio.length; gear++)
            field("ratio_" + gear, "" + c.ratio[gear]);
        field("status", "end");

        Part part = c.partOnSlot(Chassis.ENGINE_SLOT);
        if(part instanceof Block)
        {
            Block block = part;
            DynoData d = block.dynodata;
            begin("engine", 0);
            field("status", "begin");
            field("engine_type", "" + block.getInfo(GameType.GII_TYPE));
            text("engine", block.name);
            field("wear", "" + block.getWear());
            field("tear", "" + block.getTear());
            if(d != null)
            {
                field("displacement_raw", "" + d.Displacement);
                field("compression", "" + d.Compression);
                field("max_torque_raw", "" + d.maxTorque);
                field("max_hp_raw", "" + d.maxHP);
                field("peak_torque_rpm", "" + d.RPM_maxTorque);
                field("peak_power_rpm", "" + d.RPM_maxHP);
                field("bore_m", "" + d.bore);
                field("stroke_m", "" + d.stroke);
                field("cylinders", "" + d.cylinders);
            }
            field("status", "end");
            if(d != null)
            {
                for(int rpm=0; rpm<=c.RPM_limit && rpm<=20000; rpm+=500)
                {
                    begin("curve", rpm);
                    field("status", "begin");
                    field("rpm", "" + rpm);
                    field("torque_nm", "" + d.getTorque(rpm,0.0));
                    field("power_native_raw", "" + d.getHP(rpm,0.0));
                    field("status", "end");
                }
            }
        }
    }

    public static void stop()
    {
        if(active != null)
        {
            begin("end", sequence);
            field("status", "end");
        }
        active = null;
        lastTime = -1.0;
    }

    public static void sample(Vehicle car)
    {
        if(car == null) { stop(); return; }
        if(car.chassis == null) { stop(); return; }
        float now = System.currentTime();
        if(active != car || now < lastTime)
        {
            stop();
            active = car;
            run++;
            sequence = 0;
            transmission = Config.player_transmission;
            nextSample = now;
            describe(car);
        }
        if(now < nextSample) return;
        if(transmission != Config.player_transmission)
        {
            stop();
            return;
        }
        nextSample = now + interval;
        Chassis c = car.chassis;
        begin("sample", sequence);
        field("status", "begin");
        field("t", "" + now);
        field("rpm", "" + c.getRPM());
        field("speed_mps", "" + car.getSpeed());
        field("gear_param6", "" + c.getAIparam_int(6));
        field("shifting", "" + c.getShifting());
        field("throttle_param0", "" + c.getAIparam_float(0));
        field("brake_param1", "" + c.getAIparam_float(1));
        field("clutch_param4", "" + c.getAIparam_float(4));
        field("steer_param3", "" + c.getAIparam_float(3));
        field("temperature_raw", "" + c.getEngineTemp());
        field("status", "end");
        lastTime = now;
        sequence++;
    }
}
