package java.game;

// Diagnostic stage 2: one RPM read; no clock, config, metadata or other getters.
public class PhysicsTelemetry
{
    static int printed = 0;

    public static void sample(Vehicle car)
    {
        if(printed == 0)
        {
            printed = 1;
            System.log("SLRR_TELEMETRY_PROBE stage=2 before=car_check");
            if(car == null)
            {
                System.log("SLRR_TELEMETRY_PROBE stage=2 skip=car_null");
                printed = 0;
                return;
            }
            if(car.chassis == null)
            {
                System.log("SLRR_TELEMETRY_PROBE stage=2 skip=chassis_null");
                printed = 0;
                return;
            }
            System.log("SLRR_TELEMETRY_PROBE stage=2 before=getRPM");
            float rpm = car.chassis.getRPM();
            System.log("SLRR_TELEMETRY_PROBE stage=2 after=getRPM rpm=" + rpm);
        }
    }

    public static void stop()
    {
        printed = 0;
    }
}
