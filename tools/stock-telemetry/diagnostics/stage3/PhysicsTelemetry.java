package java.game;

// Diagnostic stage 3: qualified RPM read, then one speed read. No other getters.
public class PhysicsTelemetry
{
    static int printed = 0;

    public static void sample(Vehicle car)
    {
        if(printed == 0)
        {
            printed = 1;
            System.log("SLRR_TELEMETRY_PROBE stage=3 before=car_check");
            if(car == null)
            {
                System.log("SLRR_TELEMETRY_PROBE stage=3 skip=car_null");
                printed = 0;
                return;
            }
            if(car.chassis == null)
            {
                System.log("SLRR_TELEMETRY_PROBE stage=3 skip=chassis_null");
                printed = 0;
                return;
            }
            System.log("SLRR_TELEMETRY_PROBE stage=3 before=getRPM");
            float rpm = car.chassis.getRPM();
            System.log("SLRR_TELEMETRY_PROBE stage=3 after=getRPM rpm=" + rpm);
            System.log("SLRR_TELEMETRY_PROBE stage=3 before=getSpeed");
            float speed = car.getSpeed();
            System.log("SLRR_TELEMETRY_PROBE stage=3 after=getSpeed speed_mps=" + speed);
        }
    }

    public static void stop()
    {
        printed = 0;
    }
}
